import { getDb, Task, afterWrite } from '../db.js';
import { c } from '../utils.js';

export function helpCommand(taskId: string, message: string): void {
  const db = getDb();

  // Resolve task
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(taskId, `%${taskId}%`) as Task | undefined;
  if (!task) {
    console.error(`${c.red}Task not found: ${taskId}${c.reset}`);
    process.exit(1);
  }

  // Log the help request
  const entry = `[HELP] ${message}`;
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'agent')").run(task.id, entry);
  afterWrite(db);

  // Print event for orchestrators
  console.log(`TRAK_EVENT:HELP:${task.id}:${message}`);
  console.log(`${c.yellow}🆘${c.reset} Help requested on ${c.bold}${task.id}${c.reset} — ${task.title}`);
  console.log(`  ${c.dim}Message: ${message}${c.reset}`);
}
