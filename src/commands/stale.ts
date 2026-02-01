import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, formatDate, truncate } from '../utils.js';

export function staleCommand(days?: string): void {
  const d = days ? parseInt(days, 10) : 7;
  const db = getDb();

  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE status NOT IN ('done', 'archived')
    AND updated_at < datetime('now', '-' || ? || ' days')
    ORDER BY updated_at ASC
  `).all(d) as Task[];

  if (tasks.length === 0) {
    console.log(`${c.green}No stale tasks (threshold: ${d} days)${c.reset}`);
    return;
  }

  console.log(`\n${c.yellow}${c.bold}⚠ ${tasks.length} stale task${tasks.length === 1 ? '' : 's'}${c.reset} ${c.dim}(no activity > ${d} days)${c.reset}\n`);

  for (const t of tasks) {
    const emoji = STATUS_EMOJI[t.status] || '?';
    const sc = statusColor(t.status);
    const brandTag = t.brand ? `${c.cyan}[${t.brand}]${c.reset} ` : '';
    const prio = priorityLabel(t.priority);
    const age = formatDate(t.updated_at);

    console.log(`  ${emoji} ${c.dim}${t.id}${c.reset} ${prio} ${brandTag}${sc}${truncate(t.title, 45)}${c.reset} ${c.dim}last: ${age}${c.reset}`);
  }
  console.log();
}
