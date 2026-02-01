import { getDb, Task, LogEntry } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, formatDate, truncate } from '../utils.js';

export interface SearchOptions {
  project?: string;
  all?: boolean;
}

function highlightMatch(text: string, query: string, maxLen: number = 80): string {
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return truncate(text, maxLen);

  // Show context around the match
  const matchLen = query.length;
  const contextBefore = 20;
  const start = Math.max(0, idx - contextBefore);
  const end = Math.min(text.length, idx + matchLen + (maxLen - contextBefore - matchLen));

  let snippet = '';
  if (start > 0) snippet += '…';
  snippet += text.slice(start, idx);
  snippet += `${c.yellow}${c.bold}${text.slice(idx, idx + matchLen)}${c.reset}`;
  snippet += text.slice(idx + matchLen, end);
  if (end < text.length) snippet += '…';

  return snippet;
}

export function searchCommand(query: string, opts: SearchOptions): void {
  const db = getDb();
  const like = `%${query}%`;

  // Search tasks
  let taskSql = `SELECT * FROM tasks WHERE (title LIKE ? OR description LIKE ? OR tags LIKE ?)`;
  const taskParams: any[] = [like, like, like];

  if (opts.project) {
    taskSql += ' AND project = ?';
    taskParams.push(opts.project);
  }
  if (!opts.all) {
    taskSql += " AND status NOT IN ('done', 'archived')";
  }
  taskSql += ' ORDER BY priority DESC, updated_at DESC';

  const tasks = db.prepare(taskSql).all(...taskParams) as Task[];

  // Search journal entries
  let logSql = `SELECT tl.*, t.title as task_title, t.status as task_status, t.project as task_project, t.priority as task_priority
    FROM task_log tl
    JOIN tasks t ON tl.task_id = t.id
    WHERE tl.entry LIKE ?`;
  const logParams: any[] = [like];

  if (opts.project) {
    logSql += ' AND t.project = ?';
    logParams.push(opts.project);
  }
  if (!opts.all) {
    logSql += " AND t.status NOT IN ('done', 'archived')";
  }
  logSql += ' ORDER BY tl.timestamp DESC';

  const logs = db.prepare(logSql).all(...logParams) as (LogEntry & { task_title: string; task_status: string; task_project: string; task_priority: number })[];

  // Collect task IDs from log matches that aren't already in task results
  const taskIds = new Set(tasks.map(t => t.id));
  const logTaskIds = new Set<string>();
  for (const log of logs) {
    if (!taskIds.has(log.task_id)) {
      logTaskIds.add(log.task_id);
    }
  }

  const totalMatches = tasks.length + logTaskIds.size;

  if (totalMatches === 0 && logs.length === 0) {
    console.log(`${c.dim}No results for "${query}"${c.reset}`);
    return;
  }

  console.log(`${c.bold}Search: "${query}"${c.reset}`);
  console.log();

  // Display task matches
  if (tasks.length > 0) {
    console.log(`${c.bold}Tasks (${tasks.length} match${tasks.length === 1 ? '' : 'es'})${c.reset}`);
    for (const t of tasks) {
      const emoji = STATUS_EMOJI[t.status] || '?';
      const sc = statusColor(t.status);
      const projectTag = t.project ? `${c.cyan}[${t.project}]${c.reset} ` : '';
      const id = `${c.dim}${t.id}${c.reset}`;
      const prio = priorityLabel(t.priority);

      // Highlight in title if match is there
      const qLower = query.toLowerCase();
      const titleMatch = t.title.toLowerCase().includes(qLower);
      const title = titleMatch ? highlightMatch(t.title, query, 50) : truncate(t.title, 50);

      console.log(`  ${emoji} ${id} ${prio} ${projectTag}${sc}${title}${c.reset} ${c.dim}${formatDate(t.updated_at)}${c.reset}`);

      // Show matching context from description or tags
      if (!titleMatch) {
        if (t.description.toLowerCase().includes(qLower)) {
          console.log(`    ${c.dim}desc: ${highlightMatch(t.description, query, 70)}${c.reset}`);
        }
        if (t.tags.toLowerCase().includes(qLower)) {
          console.log(`    ${c.dim}tags: ${highlightMatch(t.tags, query, 70)}${c.reset}`);
        }
      }
    }
    console.log();
  }

  // Display journal matches grouped by task
  if (logs.length > 0) {
    const grouped = new Map<string, typeof logs>();
    for (const log of logs) {
      if (!grouped.has(log.task_id)) grouped.set(log.task_id, []);
      grouped.get(log.task_id)!.push(log);
    }

    console.log(`${c.bold}Journal entries (${logs.length} match${logs.length === 1 ? '' : 'es'} in ${grouped.size} task${grouped.size === 1 ? '' : 's'})${c.reset}`);
    for (const [taskId, entries] of grouped) {
      const first = entries[0];
      const emoji = STATUS_EMOJI[first.task_status] || '?';
      const projectTag = first.task_project ? `${c.cyan}[${first.task_project}]${c.reset} ` : '';
      const alreadyShown = taskIds.has(taskId) ? ` ${c.dim}(also matched above)${c.reset}` : '';

      console.log(`  ${emoji} ${c.dim}${taskId}${c.reset} ${projectTag}${truncate(first.task_title, 40)}${alreadyShown}`);
      for (const entry of entries.slice(0, 3)) {
        console.log(`    ${c.dim}${formatDate(entry.timestamp)}${c.reset} ${highlightMatch(entry.entry, query, 60)}`);
      }
      if (entries.length > 3) {
        console.log(`    ${c.dim}… and ${entries.length - 3} more${c.reset}`);
      }
    }
  }
}
