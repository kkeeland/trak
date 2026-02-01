import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI, priorityLabel, formatDate, truncate, statusColor } from '../utils.js';

export interface ReadyOptions {
  project?: string;
  priority?: string;
  all?: boolean;
}

export function readyCommand(opts: ReadyOptions): void {
  const db = getDb();

  // Tasks that are open/wip AND have no unfinished dependencies
  let sql = `
    SELECT t.* FROM tasks t
    WHERE t.status IN ('open', 'wip')
    AND t.blocked_by = ''
    AND (t.retry_after IS NULL OR t.retry_after <= datetime('now'))
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d
      JOIN tasks dep ON dep.id = d.parent_id
      WHERE d.child_id = t.id
      AND dep.status NOT IN ('done', 'archived')
    )
  `;
  const params: any[] = [];

  if (opts.project) {
    sql += ' AND t.project = ?';
    params.push(opts.project);
  }

  // Priority filtering: default shows P0-P1 only, --all shows everything
  // Note: priority 0 = P0 (critical), 3 = P3 (low). Lower number = higher priority.
  if (!opts.all) {
    const maxPriority = opts.priority ? parseInt(opts.priority, 10) : 1;  // Default: show P0 and P1
    sql += ' AND t.priority <= ?';
    params.push(maxPriority);
  }

  sql += ' ORDER BY t.priority DESC, t.updated_at DESC';

  const tasks = db.prepare(sql).all(...params) as Task[];
  
  // Count total ready (without priority filter) for context
  const totalSql = `
    SELECT COUNT(*) as cnt FROM tasks t
    WHERE t.status IN ('open', 'wip')
    AND t.blocked_by = ''
    AND (t.retry_after IS NULL OR t.retry_after <= datetime('now'))
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d
      JOIN tasks dep ON dep.id = d.parent_id
      WHERE d.child_id = t.id
      AND dep.status NOT IN ('done', 'archived')
    )
  `;
  const totalReady = (db.prepare(totalSql).get() as any).cnt;

  if (tasks.length === 0) {
    if (totalReady > 0) {
      console.log(`${c.dim}No ready tasks at P${opts.priority || '0-1'} (${totalReady} lower-priority tasks hidden — use --all to show)${c.reset}`);
    } else {
      console.log(`${c.dim}No ready tasks${c.reset}`);
    }
    return;
  }

  const hiddenCount = totalReady - tasks.length;
  const hiddenNote = hiddenCount > 0 ? ` ${c.dim}(${hiddenCount} lower-priority hidden — use --all)${c.reset}` : '';
  console.log(`${c.green}${c.bold}${tasks.length} ready task${tasks.length === 1 ? '' : 's'}${c.reset}${hiddenNote}\n`);

  for (const t of tasks) {
    const emoji = STATUS_EMOJI[t.status] || '?';
    const sc = statusColor(t.status);
    const projectTag = t.project ? `${c.cyan}[${t.project}]${c.reset} ` : '';
    const prio = priorityLabel(t.priority);
    const age = formatDate(t.updated_at);

    console.log(`  ${emoji} ${c.dim}${t.id}${c.reset} ${prio} ${projectTag}${sc}${truncate(t.title, 50)}${c.reset} ${c.dim}${age}${c.reset}`);
  }
}
