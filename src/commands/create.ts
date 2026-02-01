import { getDb, Task } from '../db.js';
import { generateId, c, STATUS_EMOJI } from '../utils.js';

export interface CreateOptions {
  brand?: string;
  priority?: string;
  description?: string;
  parent?: string;
  tags?: string;
  session?: string;
}

export function createCommand(title: string, opts: CreateOptions): void {
  const db = getDb();
  const id = generateId();
  const priority = opts.priority ? parseInt(opts.priority, 10) : 1;

  if (priority < 0 || priority > 3) {
    console.error(`${c.red}Error: Priority must be 0-3${c.reset}`);
    process.exit(1);
  }

  db.prepare(`
    INSERT INTO tasks (id, title, description, priority, brand, parent_id, tags, agent_session)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    opts.description || '',
    priority,
    opts.brand || '',
    opts.parent || null,
    opts.tags || '',
    opts.session || ''
  );

  // Add creation log entry
  db.prepare(`
    INSERT INTO task_log (task_id, entry, author)
    VALUES (?, ?, ?)
  `).run(id, `Created: ${title}`, opts.session || 'human');

  console.log(`${c.green}✓${c.reset} Created ${c.bold}${id}${c.reset} ${STATUS_EMOJI.open} ${title}`);
  if (opts.brand) console.log(`  ${c.dim}brand:${c.reset} ${opts.brand}`);
  if (opts.tags) console.log(`  ${c.dim}tags:${c.reset} ${opts.tags}`);
}
