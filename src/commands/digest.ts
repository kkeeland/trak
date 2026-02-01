import { getDb, LogEntry, Task } from '../db.js';
import { c, STATUS_EMOJI, formatDate } from '../utils.js';

export function digestCommand(): void {
  const db = getDb();

  // Get all log entries from the last 24 hours
  const logs = db.prepare(`
    SELECT l.*, t.title, t.status, t.brand
    FROM task_log l
    JOIN tasks t ON t.id = l.task_id
    WHERE l.timestamp > datetime('now', '-1 day')
    ORDER BY l.timestamp DESC
  `).all() as (LogEntry & { title: string; status: string; brand: string })[];

  // Get tasks updated in last 24h
  const updatedTasks = db.prepare(`
    SELECT * FROM tasks WHERE updated_at > datetime('now', '-1 day')
    ORDER BY updated_at DESC
  `).all() as Task[];

  if (logs.length === 0 && updatedTasks.length === 0) {
    console.log(`${c.dim}Nothing happened in the last 24 hours${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}📋 Digest — Last 24 Hours${c.reset}`);
  console.log(`${'─'.repeat(40)}\n`);

  // Summary counts
  const created = updatedTasks.filter(t => {
    const age = Date.now() - new Date(t.created_at).getTime();
    return age < 86400000;
  });
  const closed = updatedTasks.filter(t => t.status === 'done');
  const active = updatedTasks.filter(t => t.status === 'wip');

  if (created.length) console.log(`  ${c.green}+${created.length} created${c.reset}`);
  if (closed.length) console.log(`  ${c.green}${STATUS_EMOJI.done} ${closed.length} completed${c.reset}`);
  if (active.length) console.log(`  ${c.yellow}${STATUS_EMOJI.wip} ${active.length} in progress${c.reset}`);

  console.log(`  ${c.dim}${logs.length} log entries${c.reset}\n`);

  // Group by task
  const byTask = new Map<string, typeof logs>();
  for (const log of logs) {
    if (!byTask.has(log.task_id)) byTask.set(log.task_id, []);
    byTask.get(log.task_id)!.push(log);
  }

  for (const [taskId, taskLogs] of byTask) {
    const first = taskLogs[0];
    const emoji = STATUS_EMOJI[first.status] || '?';
    const brandTag = first.brand ? `${c.cyan}[${first.brand}]${c.reset} ` : '';
    console.log(`  ${emoji} ${c.dim}${taskId}${c.reset} ${brandTag}${first.title}`);
    for (const log of taskLogs) {
      console.log(`    ${c.dim}${formatDate(log.timestamp)}${c.reset} ${c.cyan}[${log.author}]${c.reset} ${log.entry}`);
    }
  }
  console.log();
}
