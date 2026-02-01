import { getDb, Task, afterWrite, getConfigValue } from '../db.js';
import { generateId, c, STATUS_EMOJI } from '../utils.js';
import { hookTaskCreated } from '../hooks.js';

export interface CreateOptions {
  project?: string;
  priority?: string;
  description?: string;
  parent?: string;
  tags?: string;
  session?: string;
  epic?: string;
  isEpic?: boolean;
  auto?: boolean;
  review?: boolean;
  approve?: boolean;
  budget?: string;
}

export function createCommand(title: string, opts: CreateOptions): void {
  const db = getDb();
  const id = generateId();
  const priority = opts.priority ? parseInt(opts.priority, 10) : 1;

  if (priority < 0 || priority > 3) {
    console.error(`${c.red}Error: Priority must be 0-3${c.reset}`);
    process.exit(1);
  }

  // Determine autonomy level
  let autonomy = 'manual';
  if (opts.auto) autonomy = 'auto';
  else if (opts.review) autonomy = 'review';
  else if (opts.approve) autonomy = 'approve';
  else if (opts.project) {
    // Inherit from project default if set
    const projectDefault = getConfigValue(`project.${opts.project}.default-autonomy`);
    if (projectDefault && ['auto', 'review', 'approve', 'manual'].includes(projectDefault)) {
      autonomy = projectDefault;
    }
  }

  // Parse budget
  const budgetUsd = opts.budget ? parseFloat(opts.budget) : null;

  db.prepare(`
    INSERT INTO tasks (id, title, description, priority, project, parent_id, tags, agent_session, epic_id, is_epic, autonomy, budget_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    opts.description || '',
    priority,
    opts.project || '',
    opts.parent || null,
    opts.tags || '',
    opts.session || '',
    opts.epic || null,
    opts.isEpic ? 1 : 0,
    autonomy,
    budgetUsd
  );

  // Add creation log entry
  db.prepare(`
    INSERT INTO task_log (task_id, entry, author)
    VALUES (?, ?, ?)
  `).run(id, `Created: ${title}`, opts.session || 'human');

  afterWrite(db);

  // Fire webhook
  const createdTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task;
  if (createdTask) hookTaskCreated(createdTask);

  console.log(`${c.green}✓${c.reset} Created ${c.bold}${id}${c.reset} ${STATUS_EMOJI.open} ${title}`);
  if (opts.project) console.log(`  ${c.dim}project:${c.reset} ${opts.project}`);
  if (opts.tags) console.log(`  ${c.dim}tags:${c.reset} ${opts.tags}`);
  if (autonomy !== 'manual') console.log(`  ${c.dim}autonomy:${c.reset} ${autonomy}`);
  if (budgetUsd !== null) console.log(`  ${c.dim}budget:${c.reset} $${budgetUsd.toFixed(2)}`);
}
