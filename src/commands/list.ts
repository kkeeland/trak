import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, formatDate, truncate, padRight } from '../utils.js';

export interface ListOptions {
  project?: string;
  status?: string;
  tags?: string;
  verbose?: boolean;
  all?: boolean;
  epic?: string;
  failed?: boolean;
}

export function listCommand(opts: ListOptions): void {
  const db = getDb();
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params: any[] = [];

  if (opts.project) {
    sql += ' AND project = ?';
    params.push(opts.project);
  }
  if (opts.status) {
    sql += ' AND status = ?';
    params.push(opts.status);
  }
  if (opts.failed) {
    sql += " AND status = 'failed'";
  }
  if (opts.tags) {
    sql += ' AND tags LIKE ?';
    params.push(`%${opts.tags}%`);
  }
  if (opts.epic) {
    const epic = db.prepare('SELECT id FROM tasks WHERE (id = ? OR id LIKE ?) AND is_epic = 1').get(opts.epic, `%${opts.epic}%`) as { id: string } | undefined;
    if (!epic) {
      console.error(`Epic not found: ${opts.epic}`);
      process.exit(1);
    }
    sql += ' AND epic_id = ?';
    params.push(epic.id);
  }
  if (!opts.all) {
    sql += " AND status NOT IN ('done', 'archived')";
  }

  sql += ' ORDER BY priority DESC, updated_at DESC';

  const tasks = db.prepare(sql).all(...params) as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No tasks found${c.reset}`);
    return;
  }

  console.log(`${c.bold}${tasks.length} task${tasks.length === 1 ? '' : 's'}${c.reset}\n`);

  for (const t of tasks) {
    const emoji = STATUS_EMOJI[t.status] || '?';
    const sc = statusColor(t.status);
    const projectTag = t.project ? `${c.cyan}[${t.project}]${c.reset} ` : '';
    const id = `${c.dim}${t.id}${c.reset}`;
    const prio = priorityLabel(t.priority);
    const title = truncate(t.title, 50);
    const age = formatDate(t.updated_at);
    const epicTag = t.is_epic ? '📋 ' : '';
    const agent = t.assigned_to ? ` ${c.cyan}→ ${t.assigned_to}${c.reset}` : '';
    const retryTag = (t as any).retry_count > 0 ? ` ${c.yellow}⟳ ${(t as any).retry_count}/${(t as any).max_retries ?? 3}${c.reset}` : '';

    console.log(`  ${emoji} ${id} ${prio} ${epicTag}${projectTag}${sc}${title}${c.reset}${agent}${retryTag} ${c.dim}${age}${c.reset}`);

    if (opts.verbose) {
      if (t.description) console.log(`    ${c.dim}${truncate(t.description, 70)}${c.reset}`);
      if (t.blocked_by) console.log(`    ${c.red}blocked by: ${t.blocked_by}${c.reset}`);
      if (t.tags) console.log(`    ${c.dim}tags: ${t.tags}${c.reset}`);
      if (t.epic_id) console.log(`    ${c.dim}epic: ${t.epic_id}${c.reset}`);
      if (t.verification_status) console.log(`    ${c.dim}verified: ${t.verification_status}${c.reset}`);
    }
  }
}
