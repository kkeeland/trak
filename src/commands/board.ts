import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, truncate, getBrandColor } from '../utils.js';

export function boardCommand(brand?: string): void {
  const db = getDb();

  let sql = "SELECT * FROM tasks WHERE status NOT IN ('done', 'archived')";
  const params: any[] = [];

  if (brand) {
    sql += ' AND brand = ?';
    params.push(brand);
  }

  sql += ' ORDER BY priority DESC, updated_at DESC';
  const tasks = db.prepare(sql).all(...params) as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No active tasks${c.reset}`);
    return;
  }

  // Group by brand
  const byBrand = new Map<string, Task[]>();
  for (const t of tasks) {
    const b = t.brand || '(no brand)';
    if (!byBrand.has(b)) byBrand.set(b, []);
    byBrand.get(b)!.push(t);
  }

  for (const [brandName, brandTasks] of byBrand) {
    const bc = getBrandColor(brandName);
    console.log(`\n${bc}${c.bold}━━━ ${brandName.toUpperCase()} ━━━${c.reset} ${c.dim}(${brandTasks.length})${c.reset}`);

    // Group by status within brand
    const statusOrder = ['wip', 'blocked', 'review', 'open'];
    for (const status of statusOrder) {
      const statusTasks = brandTasks.filter(t => t.status === status);
      if (statusTasks.length === 0) continue;

      const sc = statusColor(status);
      const emoji = STATUS_EMOJI[status];
      console.log(`  ${sc}${emoji} ${status.toUpperCase()}${c.reset}`);

      for (const t of statusTasks) {
        const prio = priorityLabel(t.priority);
        const title = truncate(t.title, 45);
        console.log(`    ${c.dim}${t.id}${c.reset} ${prio} ${title}`);
        if (t.blocked_by) {
          console.log(`      ${c.red}↳ ${t.blocked_by}${c.reset}`);
        }
      }
    }
  }
  console.log();
}
