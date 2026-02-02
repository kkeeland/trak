import { getDb, Task, afterWrite, getConfigValue, parseDuration, resolveTimeout, getDefaultMaxRetries } from '../db.js';
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
  timeout?: string;
  noRetry?: boolean;
  maxRetries?: string;
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

  // Parse timeout — CLI flag takes priority, then fall back to project default
  let timeoutSeconds: number | null = null;
  if (opts.timeout) {
    timeoutSeconds = parseDuration(opts.timeout);
  } else if (opts.project) {
    const projectTimeout = getConfigValue(`project.${opts.project}.timeout`);
    if (projectTimeout !== undefined) {
      timeoutSeconds = typeof projectTimeout === 'number' ? projectTimeout : parseDuration(String(projectTimeout));
    }
  }

  // Determine max retries: --no-retry sets 0, --max-retries N, or config default
  let maxRetries = getDefaultMaxRetries();
  if (opts.noRetry) {
    maxRetries = 0;
  } else if (opts.maxRetries !== undefined) {
    maxRetries = parseInt(opts.maxRetries, 10);
    if (isNaN(maxRetries) || maxRetries < 0) maxRetries = getDefaultMaxRetries();
  }

  db.prepare(`
    INSERT INTO tasks (id, title, description, priority, project, parent_id, tags, agent_session, epic_id, is_epic, autonomy, budget_usd, timeout_seconds, max_retries)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    budgetUsd,
    timeoutSeconds,
    maxRetries
  );

  // Add creation log entry
  db.prepare(`
    INSERT INTO task_log (task_id, entry, author)
    VALUES (?, ?, ?)
  `).run(id, `Created: ${title}`, opts.session || 'human');

  afterWrite(db, {
    op: 'create',
    id: id,
    data: {
      title,
      description: opts.description || '',
      priority,
      project: opts.project || '',
      parent_id: opts.parent || null,
      tags: opts.tags || '',
      agent_session: opts.session || '',
      epic_id: opts.epic || null,
      is_epic: opts.isEpic ? 1 : 0,
      autonomy,
      budget_usd: budgetUsd,
      timeout_seconds: timeoutSeconds
    }
  });

  // Fire webhook
  const createdTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task;
  if (createdTask) hookTaskCreated(createdTask);

  console.log(`${c.green}✓${c.reset} Created ${c.bold}${id}${c.reset} ${STATUS_EMOJI.open} ${title}`);
  if (opts.project) console.log(`  ${c.dim}project:${c.reset} ${opts.project}`);
  if (opts.tags) console.log(`  ${c.dim}tags:${c.reset} ${opts.tags}`);
  if (autonomy !== 'manual') console.log(`  ${c.dim}autonomy:${c.reset} ${autonomy}`);
  if (budgetUsd !== null) console.log(`  ${c.dim}budget:${c.reset} $${budgetUsd.toFixed(2)}`);
  if (timeoutSeconds !== null) {
    const durStr = timeoutSeconds < 60 ? `${timeoutSeconds}s` : timeoutSeconds < 3600 ? `${(timeoutSeconds / 60).toFixed(0)}m` : `${(timeoutSeconds / 3600).toFixed(1)}h`;
    console.log(`  ${c.dim}timeout:${c.reset} ${durStr}`);
  }
}
