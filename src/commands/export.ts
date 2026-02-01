import { getDb, Task, LogEntry, Dependency } from '../db.js';
import { c } from '../utils.js';

export function exportCommand(): void {
  const db = getDb();

  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all() as Task[];
  const dependencies = db.prepare('SELECT * FROM dependencies').all() as Dependency[];
  const logs = db.prepare('SELECT * FROM task_log ORDER BY timestamp ASC').all() as LogEntry[];

  const data = {
    version: '0.1.0',
    exported_at: new Date().toISOString(),
    tasks,
    dependencies,
    logs,
  };

  const json = JSON.stringify(data, null, 2);
  process.stdout.write(json + '\n');
}
