import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, formatDate, truncate, padRight } from '../utils.js';

export interface ListOptions {
  brand?: string;
  status?: string;
  tags?: string;
  verbose?: boolean;
  all?: boolean;
}

export function listCommand(opts: ListOptions): void {
  const db = getDb();
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params: any[] = [];

  if (opts.brand) {
    sql += ' AND brand = ?';
    params.push(opts.brand);
  }
  if (opts.status) {
    sql += ' AND status = ?';
    params.push(opts.status);
  }
  if (opts.tags) {
    sql += ' AND tags LIKE ?';
    params.push(`%${opts.tags}%`);
  }
  if (!opts.all) {
    sql += " AND status NOT IN ('done', 'archived')";
  }

  sql += ' ORDER BY priority DESC, updated_at DESC';

  const tasks = db.prepare(sql).all(...params) as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No tasks found${c.reset}`);
    return;
  }

  console.log(`${c.bold}${tasks.length} task${tasks.length === 1 ? '' : 's'}${c.reset}\n`);

  for (const t of tasks) {
    const emoji = STATUS_EMOJI[t.status] || '?';
    const sc = statusColor(t.status);
    const brandTag = t.brand ? `${c.cyan}[${t.brand}]${c.reset} ` : '';
    const id = `${c.dim}${t.id}${c.reset}`;
    const prio = priorityLabel(t.priority);
    const title = truncate(t.title, 50);
    const age = formatDate(t.updated_at);

    console.log(`  ${emoji} ${id} ${prio} ${brandTag}${sc}${title}${c.reset} ${c.dim}${age}${c.reset}`);

    if (opts.verbose) {
      if (t.description) console.log(`    ${c.dim}${truncate(t.description, 70)}${c.reset}`);
      if (t.blocked_by) console.log(`    ${c.red}blocked by: ${t.blocked_by}${c.reset}`);
      if (t.tags) console.log(`    ${c.dim}tags: ${t.tags}${c.reset}`);
    }
  }
}
