import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI } from '../utils.js';

export function assignCommand(id: string, agentName: string): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  const oldStatus = task.status;
  const newStatus = (oldStatus === 'open' || oldStatus === 'review') ? 'wip' : oldStatus;

  db.prepare(`
    UPDATE tasks SET assigned_to = ?, status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(agentName, newStatus, task.id);

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id,
    `${agentName} assigned to this task`
  );

  if (oldStatus !== newStatus) {
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id,
      `Status: ${oldStatus} → ${newStatus}`
    );
  }

  const emoji = STATUS_EMOJI[newStatus] || '?';
  console.log(`${c.green}✓${c.reset} ${c.dim}${task.id}${c.reset} ${emoji} assigned to ${c.bold}${agentName}${c.reset}`);
  if (oldStatus !== newStatus) {
    console.log(`  ${c.dim}status:${c.reset} ${oldStatus} → ${c.bold}${newStatus}${c.reset}`);
  }
}
