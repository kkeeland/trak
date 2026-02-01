import { getDb, Task, LogEntry } from '../db.js';
import { c, STATUS_EMOJI, statusColor } from '../utils.js';

function resolveTask(db: ReturnType<typeof getDb>, id: string): Task {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }
  return task;
}

interface TimelineEvent {
  timestamp: string;
  type: 'created' | 'log' | 'status_change';
  author: string;
  text: string;
}

function parseStatusChanges(logs: LogEntry[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const log of logs) {
    // Detect status change patterns in log entries
    const statusMatch = log.entry.match(/^Status changed?:?\s*(\w+)\s*→\s*(\w+)/i)
      || log.entry.match(/^status:\s*(\w+)\s*→\s*(\w+)/i);

    if (statusMatch) {
      events.push({
        timestamp: log.timestamp,
        type: 'status_change',
        author: log.author,
        text: `Status: ${statusMatch[1]} → ${statusMatch[2]}`,
      });
    } else {
      events.push({
        timestamp: log.timestamp,
        type: 'log',
        author: log.author,
        text: log.entry,
      });
    }
  }

  return events;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getUTCMonth()];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  return `${month} ${day} ${hours}:${mins}`;
}

function formatDuration(ms: number): string {
  if (ms < 0) return '0m';
  const totalMins = Math.floor(ms / 60000);
  const totalHours = Math.floor(totalMins / 60);
  const totalDays = Math.floor(totalHours / 24);
  const mins = totalMins % 60;
  const hours = totalHours % 24;

  if (totalDays > 0) return `${totalDays}d ${hours}h ${mins}m`;
  if (totalHours > 0) return `${totalHours}h ${mins}m`;
  return `${mins}m`;
}

export function historyCommand(id: string): void {
  const db = getDb();
  const task = resolveTask(db, id);

  const emoji = STATUS_EMOJI[task.status] || '?';
  const sc = statusColor(task.status);

  console.log(`\n${c.bold}📖 History: ${task.title} (${task.id})${c.reset}`);
  console.log(`   ${sc}${task.status.toUpperCase()}${c.reset} ${emoji}`);
  console.log();

  // Build timeline
  const timeline: TimelineEvent[] = [];

  // Created event
  timeline.push({
    timestamp: task.created_at,
    type: 'created',
    author: 'system',
    text: task.agent_session
      ? `Created (session: ${task.agent_session})`
      : 'Created',
  });

  // All log entries
  const logs = db.prepare('SELECT * FROM task_log WHERE task_id = ? ORDER BY timestamp ASC').all(task.id) as LogEntry[];
  const parsedEvents = parseStatusChanges(logs);
  timeline.push(...parsedEvents);

  // Sort by timestamp
  timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Render timeline
  for (const event of timeline) {
    const ts = formatTimestamp(event.timestamp);
    let line: string;

    switch (event.type) {
      case 'created':
        line = `${c.green}${event.text}${c.reset}`;
        break;
      case 'status_change':
        line = `${c.yellow}${event.text}${c.reset}`;
        break;
      case 'log':
        line = `${c.cyan}${event.author}:${c.reset} "${event.text}"`;
        break;
      default:
        line = event.text;
    }

    console.log(`  ${c.dim}${ts}${c.reset}  ${line}`);
  }

  // Summary footer
  console.log();

  if (task.cost_usd > 0 || task.tokens_used > 0) {
    console.log(`  ${c.dim}Cost:${c.reset} $${task.cost_usd.toFixed(2)} (${task.tokens_used.toLocaleString()} tokens)`);
  }

  // Duration: created → last event (or done)
  if (timeline.length > 1) {
    const start = new Date(timeline[0].timestamp).getTime();
    const end = new Date(timeline[timeline.length - 1].timestamp).getTime();
    const duration = end - start;
    if (duration > 0) {
      const statusLabel = task.status === 'done' ? 'created → done' : 'created → last activity';
      console.log(`  ${c.dim}Duration:${c.reset} ${formatDuration(duration)} (${statusLabel})`);
    }
  }

  if (timeline.length <= 1) {
    console.log(`  ${c.dim}No activity recorded yet.${c.reset}`);
  }

  console.log();
}
