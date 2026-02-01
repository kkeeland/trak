import { getDb, Task } from '../db.js';
import { c } from '../utils.js';

export interface LogOptions {
  author?: string;
}

export function logCommand(id: string, entry: string, opts: LogOptions): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  const author = opts.author || 'human';

  db.prepare('INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)').run(task.id, entry, author);
  db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(task.id);

  console.log(`${c.green}✓${c.reset} Logged to ${c.dim}${task.id}${c.reset} ${c.cyan}[${author}]${c.reset} ${entry}`);
}
