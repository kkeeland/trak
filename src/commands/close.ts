import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI } from '../utils.js';

export function closeCommand(id: string): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  if (task.status === 'done') {
    console.log(`${c.yellow}Already done${c.reset}`);
    return;
  }

  db.prepare("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?").run(task.id);
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id, `Closed (was: ${task.status})`
  );

  console.log(`${c.green}✓${c.reset} ${STATUS_EMOJI.done} ${c.dim}${task.id}${c.reset} ${task.title}`);
}
