import { getDb, Task, afterWrite } from '../db.js';
import { c, STATUS_EMOJI, statusColor, generateId } from '../utils.js';

export function ensureConvoyTable(db: ReturnType<typeof getDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS convoys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Add convoy column to tasks if missing
  const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  if (!cols.some(col => col.name === 'convoy')) {
    db.exec("ALTER TABLE tasks ADD COLUMN convoy TEXT DEFAULT NULL");
  }
}

export function convoyCreateCommand(name: string): string {
  const db = getDb();
  ensureConvoyTable(db);
  const id = `convoy-${generateId().split('-')[1]}`;
  db.prepare('INSERT INTO convoys (id, name) VALUES (?, ?)').run(id, name);
  afterWrite(db);
  console.log(`${c.green}✓${c.reset} Created convoy ${c.bold}${id}${c.reset} — "${name}"`);
  return id;
}

export function convoyAddCommand(convoyId: string, taskIds: string[]): void {
  const db = getDb();
  ensureConvoyTable(db);

  // Resolve convoy
  const convoy = db.prepare('SELECT * FROM convoys WHERE id = ? OR id LIKE ?').get(convoyId, `%${convoyId}%`) as any;
  if (!convoy) {
    console.error(`${c.red}Convoy not found: ${convoyId}${c.reset}`);
    process.exit(1);
  }

  for (const tid of taskIds) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(tid, `%${tid}%`) as Task | undefined;
    if (!task) {
      console.error(`${c.red}Task not found: ${tid}${c.reset}`);
      continue;
    }
    db.prepare('UPDATE tasks SET convoy = ? WHERE id = ?').run(convoy.id, task.id);
    console.log(`${c.green}✓${c.reset} Added ${c.dim}${task.id}${c.reset} to convoy ${c.dim}${convoy.id}${c.reset}`);
  }

  afterWrite(db);
}

export function convoyShowCommand(convoyId: string): void {
  const db = getDb();
  ensureConvoyTable(db);

  const convoy = db.prepare('SELECT * FROM convoys WHERE id = ? OR id LIKE ?').get(convoyId, `%${convoyId}%`) as any;
  if (!convoy) {
    console.error(`${c.red}Convoy not found: ${convoyId}${c.reset}`);
    process.exit(1);
  }

  const tasks = db.prepare('SELECT * FROM tasks WHERE convoy = ? ORDER BY created_at').all(convoy.id) as Task[];

  console.log(`\n${c.bold}🚛 ${convoy.name}${c.reset} ${c.dim}(${convoy.id})${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);

  if (tasks.length === 0) {
    console.log(`  ${c.dim}No tasks in this convoy${c.reset}`);
    return;
  }

  const done = tasks.filter(t => t.status === 'done').length;
  console.log(`  Progress: ${done}/${tasks.length} done\n`);

  for (const task of tasks) {
    const emoji = STATUS_EMOJI[task.status] || '?';
    const color = statusColor(task.status);
    console.log(`  ${emoji} ${color}${task.id}${c.reset} ${task.title} ${c.dim}[${task.status}]${c.reset}`);
  }
  console.log();
}

export function convoyReadyCommand(convoyId: string): void {
  const db = getDb();
  ensureConvoyTable(db);

  const convoy = db.prepare('SELECT * FROM convoys WHERE id = ? OR id LIKE ?').get(convoyId, `%${convoyId}%`) as any;
  if (!convoy) {
    console.error(`${c.red}Convoy not found: ${convoyId}${c.reset}`);
    process.exit(1);
  }

  // Tasks in this convoy that are open and have no unfinished dependencies
  const tasks = db.prepare(`
    SELECT t.* FROM tasks t
    WHERE t.convoy = ?
    AND t.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d
      JOIN tasks dep ON dep.id = d.parent_id
      WHERE d.child_id = t.id
      AND dep.status NOT IN ('done', 'archived')
    )
    ORDER BY t.priority DESC
  `).all(convoy.id) as Task[];

  console.log(`\n${c.bold}🚛 Ready tasks in "${convoy.name}"${c.reset}\n`);

  if (tasks.length === 0) {
    console.log(`  ${c.dim}No ready tasks${c.reset}`);
    return;
  }

  for (const task of tasks) {
    console.log(`  ${STATUS_EMOJI.open} ${c.bold}${task.id}${c.reset} ${task.title}`);
  }
  console.log();
}

export function convoyListCommand(): void {
  const db = getDb();
  ensureConvoyTable(db);

  const convoys = db.prepare('SELECT * FROM convoys ORDER BY created_at DESC').all() as any[];

  if (convoys.length === 0) {
    console.log(`${c.dim}No convoys yet. Create one with: trak convoy create "name"${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}🚛 Convoys${c.reset}\n`);

  for (const convoy of convoys) {
    const tasks = db.prepare('SELECT status FROM tasks WHERE convoy = ?').all(convoy.id) as { status: string }[];
    const done = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    console.log(`  ${c.bold}${convoy.id}${c.reset} ${convoy.name} ${c.dim}(${done}/${total} done)${c.reset}`);
  }
  console.log();
}
