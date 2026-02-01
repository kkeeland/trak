import { getDb, Task, calculateHeat } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, truncate, heatBar } from '../utils.js';

export function heatCommand(): void {
  const db = getDb();

  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE status NOT IN ('done', 'archived')
  `).all() as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No active tasks${c.reset}`);
    return;
  }

  // Calculate heat for each task
  const heated = tasks.map(t => ({
    task: t,
    heat: calculateHeat(db, t),
  })).sort((a, b) => b.heat - a.heat);

  const maxHeat = heated[0]?.heat || 1;

  console.log(`\n${c.bold}🔥 Heat Map${c.reset}\n`);

  for (const { task, heat } of heated) {
    const emoji = STATUS_EMOJI[task.status] || '?';
    const sc = statusColor(task.status);
    const projectTag = task.project ? `${c.cyan}[${task.project}]${c.reset} ` : '';
    const prio = priorityLabel(task.priority);
    const bar = heatBar(heat, Math.max(maxHeat, 5));

    console.log(`  ${bar} ${c.dim}(${heat.toString().padStart(2)})${c.reset} ${emoji} ${c.dim}${task.id}${c.reset} ${prio} ${projectTag}${sc}${truncate(task.title, 40)}${c.reset}`);
  }
  console.log();
}
