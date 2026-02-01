import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI, priorityLabel, formatDate, truncate, statusColor } from '../utils.js';

export interface ReadyOptions {
  brand?: string;
}

export function readyCommand(opts: ReadyOptions): void {
  const db = getDb();

  // Tasks that are open/wip AND have no unfinished dependencies
  let sql = `
    SELECT t.* FROM tasks t
    WHERE t.status IN ('open', 'wip')
    AND t.blocked_by = ''
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d
      JOIN tasks dep ON dep.id = d.parent_id
      WHERE d.child_id = t.id
      AND dep.status NOT IN ('done', 'archived')
    )
  `;
  const params: any[] = [];

  if (opts.brand) {
    sql += ' AND t.brand = ?';
    params.push(opts.brand);
  }

  sql += ' ORDER BY t.priority DESC, t.updated_at DESC';

  const tasks = db.prepare(sql).all(...params) as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No ready tasks${c.reset}`);
    return;
  }

  console.log(`${c.green}${c.bold}${tasks.length} ready task${tasks.length === 1 ? '' : 's'}${c.reset}\n`);

  for (const t of tasks) {
    const emoji = STATUS_EMOJI[t.status] || '?';
    const sc = statusColor(t.status);
    const brandTag = t.brand ? `${c.cyan}[${t.brand}]${c.reset} ` : '';
    const prio = priorityLabel(t.priority);
    const age = formatDate(t.updated_at);

    console.log(`  ${emoji} ${c.dim}${t.id}${c.reset} ${prio} ${brandTag}${sc}${truncate(t.title, 50)}${c.reset} ${c.dim}${age}${c.reset}`);
  }
}
