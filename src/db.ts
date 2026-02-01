import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const TRAK_DIR = '.trak';
const DB_FILE = 'trak.db';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  project: string;
  blocked_by: string;
  parent_id: string | null;
  epic_id: string | null;
  is_epic: number;
  created_at: string;
  updated_at: string;
  agent_session: string;
  tokens_used: number;
  cost_usd: number;
  tags: string;
  assigned_to: string;
  verified_by: string;
  verification_status: string;
  created_from: string;
  verify_command: string;
  wip_snapshot: string;
}

export interface Dependency {
  child_id: string;
  parent_id: string;
}

export interface TaskClaim {
  id: number;
  task_id: string;
  agent: string;
  model: string;
  status: string;
  claimed_at: string;
  released_at: string | null;
}

export interface LogEntry {
  id: number;
  task_id: string;
  timestamp: string;
  entry: string;
  author: string;
}

function findDbPath(): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, TRAK_DIR, DB_FILE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function getDbPath(): string {
  return path.join(process.cwd(), TRAK_DIR, DB_FILE);
}

export function dbExists(): boolean {
  return findDbPath() !== null;
}

function migrateColumns(db: Database.Database): void {
  const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('created_from')) {
    db.exec("ALTER TABLE tasks ADD COLUMN created_from TEXT DEFAULT ''");
  }
  if (!colNames.includes('verify_command')) {
    db.exec("ALTER TABLE tasks ADD COLUMN verify_command TEXT DEFAULT ''");
  }
  if (!colNames.includes('wip_snapshot')) {
    db.exec("ALTER TABLE tasks ADD COLUMN wip_snapshot TEXT DEFAULT ''");
  }
}

export function getDb(): Database.Database {
  const dbPath = findDbPath();
  if (!dbPath) {
    console.error('Error: No trak database found. Run `trak init` first.');
    process.exit(1);
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrateColumns(db);
  return db;
}

export function initDb(): Database.Database {
  const dir = path.join(process.cwd(), TRAK_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dbPath = path.join(dir, DB_FILE);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'open' CHECK(status IN ('open','wip','blocked','review','done','archived')),
      priority INTEGER DEFAULT 1 CHECK(priority BETWEEN 0 AND 3),
      project TEXT DEFAULT '',
      blocked_by TEXT DEFAULT '',
      parent_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      agent_session TEXT DEFAULT '',
      tokens_used INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0.0,
      tags TEXT DEFAULT '',
      epic_id TEXT,
      is_epic INTEGER DEFAULT 0,
      assigned_to TEXT DEFAULT '',
      verified_by TEXT DEFAULT '',
      verification_status TEXT DEFAULT '',
      created_from TEXT DEFAULT '',
      verify_command TEXT DEFAULT '',
      wip_snapshot TEXT DEFAULT '',
      FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE SET NULL,
      FOREIGN KEY (epic_id) REFERENCES tasks(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS dependencies (
      child_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      PRIMARY KEY (child_id, parent_id),
      FOREIGN KEY (child_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      entry TEXT NOT NULL,
      author TEXT DEFAULT 'human',
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      model TEXT DEFAULT '',
      status TEXT DEFAULT 'claimed',
      claimed_at TEXT DEFAULT (datetime('now')),
      released_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    -- Migrations for existing databases
    -- These are no-ops if columns already exist
    CREATE INDEX IF NOT EXISTS idx_tasks_epic_id ON tasks(epic_id);

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_task_log_task_id ON task_log(task_id);
    CREATE INDEX IF NOT EXISTS idx_dependencies_child ON dependencies(child_id);
    CREATE INDEX IF NOT EXISTS idx_dependencies_parent ON dependencies(parent_id);
  `);

  return db;
}

// Helper: calculate heat score for a task
export function calculateHeat(db: Database.Database, task: Task): number {
  let heat = 0;

  // Fan-out: number of tasks that depend on this one
  const dependents = db.prepare('SELECT COUNT(*) as cnt FROM dependencies WHERE parent_id = ?').get(task.id) as { cnt: number };
  heat += dependents.cnt * 2;

  // Age factor: older open tasks get hotter
  const ageMs = Date.now() - new Date(task.created_at).getTime();
  const ageDays = ageMs / 86400000;
  if (task.status !== 'done' && task.status !== 'archived') {
    heat += Math.min(Math.floor(ageDays / 7), 3); // +1 per week, max 3
  }

  // Recency of mention (last log entry)
  const lastLog = db.prepare('SELECT timestamp FROM task_log WHERE task_id = ? ORDER BY timestamp DESC LIMIT 1').get(task.id) as { timestamp: string } | undefined;
  if (lastLog) {
    const logAgeMs = Date.now() - new Date(lastLog.timestamp).getTime();
    const logAgeDays = logAgeMs / 86400000;
    if (logAgeDays < 1) heat += 2;
    else if (logAgeDays < 3) heat += 1;
  }

  // Priority boost
  heat += task.priority;

  // Blocked penalty (reduce heat for blocked tasks)
  if (task.status === 'blocked') heat = Math.max(heat - 2, 0);

  return heat;
}
