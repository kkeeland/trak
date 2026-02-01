import { getDb, Task } from '../db.js';
import { generateId, c, STATUS_EMOJI, statusColor, priorityLabel, truncate } from '../utils.js';
import { CreateOptions, createCommand } from './create.js';

export interface EpicListOptions {
  project?: string;
}

function progressBar(done: number, total: number, width: number = 8): string {
  if (total === 0) return '░'.repeat(width);
  const filled = Math.round((done / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function epicCreateCommand(title: string, opts: CreateOptions): void {
  opts.isEpic = true;
  createCommand(title, opts);
}

export function epicListCommand(opts: EpicListOptions): void {
  const db = getDb();

  let sql = 'SELECT * FROM tasks WHERE is_epic = 1';
  const params: any[] = [];

  if (opts.project) {
    sql += ' AND project = ?';
    params.push(opts.project);
  }

  sql += ' ORDER BY project, priority DESC, updated_at DESC';
  const epics = db.prepare(sql).all(...params) as Task[];

  if (epics.length === 0) {
    console.log(`${c.dim}No epics found${c.reset}`);
    return;
  }

  console.log(`${c.bold}${epics.length} epic${epics.length === 1 ? '' : 's'}${c.reset}\n`);

  for (const epic of epics) {
    const children = db.prepare('SELECT status FROM tasks WHERE epic_id = ?').all(epic.id) as { status: string }[];
    const total = children.length;
    const done = children.filter(c => c.status === 'done').length;
    const bar = progressBar(done, total);
    const projectTag = epic.project ? `  [${epic.project}]` : '';
    const prio = priorityLabel(epic.priority);
    const emoji = STATUS_EMOJI[epic.status] || '○';

    console.log(`  📋 ${c.dim}${epic.id}${c.reset}  ${emoji} ${prio} [${bar}] ${done}/${total}  ${c.bold}${epic.title}${c.reset}${c.cyan}${projectTag}${c.reset}`);
  }
  console.log();
}

export function epicShowCommand(id: string): void {
  const db = getDb();

  const epic = db.prepare('SELECT * FROM tasks WHERE (id = ? OR id LIKE ?) AND is_epic = 1').get(id, `%${id}%`) as Task | undefined;
  if (!epic) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
    if (task && !task.is_epic) {
      console.error(`${c.red}${task.id} is not an epic. Use \`trak show ${task.id}\` instead.${c.reset}`);
    } else {
      console.error(`${c.red}Epic not found: ${id}${c.reset}`);
    }
    process.exit(1);
  }

  const children = db.prepare('SELECT * FROM tasks WHERE epic_id = ? ORDER BY status, priority DESC').all(epic.id) as Task[];
  const total = children.length;
  const done = children.filter(c => c.status === 'done').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = progressBar(done, total);
  const projectTag = epic.project ? `  [${epic.project}]` : '';

  console.log(`\n📋 ${c.bold}EPIC: ${epic.title}${c.reset}${c.cyan}${projectTag}${c.reset}  ${priorityLabel(epic.priority)}`);
  console.log(`Progress: [${bar}] ${done}/${total} (${pct}%)`);

  if (epic.description) {
    console.log(`\n${c.dim}${epic.description}${c.reset}`);
  }

  const statusGroups: [string, string, Task[]][] = [
    ['done', '✅ DONE', children.filter(c => c.status === 'done')],
    ['wip', '🔨 WIP', children.filter(c => c.status === 'wip')],
    ['review', '👀 REVIEW', children.filter(c => c.status === 'review')],
    ['blocked', '🚫 BLOCKED', children.filter(c => c.status === 'blocked')],
    ['open', '○ OPEN', children.filter(c => c.status === 'open')],
  ];

  for (const [_status, label, tasks] of statusGroups) {
    if (tasks.length === 0) continue;
    console.log(`\n${label} (${tasks.length})`);
    for (const t of tasks) {
      const prio = priorityLabel(t.priority);
      console.log(`  ${c.dim}${t.id}${c.reset}  ${prio}  ${truncate(t.title, 50)}`);
    }
  }

  console.log();
}
