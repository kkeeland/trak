import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

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
  autonomy: string;
  budget_usd: number | null;
  retry_count: number;
  max_retries: number;
  last_failure_reason: string;
  retry_after: string | null;
  timeout_seconds: number | null;
  tokens_in: number;
  tokens_out: number;
  model_used: string;
  duration_seconds: number;
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

function getGlobalDbPath(): string {
  return path.join(os.homedir(), TRAK_DIR, DB_FILE);
}

function getGitRoot(): string | null {
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

function findDbPath(): string | null {
  // 1. TRAK_DB env var takes priority
  if (process.env.TRAK_DB) {
    if (fs.existsSync(process.env.TRAK_DB)) return process.env.TRAK_DB;
    return null;
  }

  // 2. Walk up from cwd looking for project-local .trak/trak.db (stop at git root)
  const gitRoot = getGitRoot();
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, TRAK_DIR, DB_FILE);
    if (fs.existsSync(candidate)) return candidate;
    // Stop at git root boundary (don't leak into parent repos)
    if (gitRoot && path.resolve(dir) === path.resolve(gitRoot)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 3. Fall back to global ~/.trak/trak.db
  const globalPath = getGlobalDbPath();
  if (fs.existsSync(globalPath)) return globalPath;

  return null;
}

/**
 * Find the .trak/ directory (not just DB file) — used for checking local project setup.
 * Walks up to git root, same as findDbPath.
 */
export function findTrakDir(): string | null {
  if (process.env.TRAK_DB) {
    const dir = path.dirname(process.env.TRAK_DB);
    if (fs.existsSync(dir)) return dir;
    return null;
  }

  const gitRoot = getGitRoot();
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, TRAK_DIR);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
    if (gitRoot && path.resolve(dir) === path.resolve(gitRoot)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export function getDbPath(): string {
  return path.join(process.cwd(), TRAK_DIR, DB_FILE);
}

export function getGlobalDbDir(): string {
  return path.join(os.homedir(), TRAK_DIR);
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
  if (!colNames.includes('autonomy')) {
    db.exec("ALTER TABLE tasks ADD COLUMN autonomy TEXT DEFAULT 'manual'");
  }
  if (!colNames.includes('budget_usd')) {
    db.exec("ALTER TABLE tasks ADD COLUMN budget_usd REAL DEFAULT NULL");
  }
  // Update status CHECK constraint to include 'failed' — SQLite doesn't support ALTER CHECK,
  // but the constraint is only enforced on INSERT/UPDATE. For existing DBs, the new status
  // is handled by the migrated schema on next init. We rely on the app-level VALID_STATUSES check.
  if (!colNames.includes('retry_count')) {
    db.exec("ALTER TABLE tasks ADD COLUMN retry_count INTEGER DEFAULT 0");
  }
  if (!colNames.includes('max_retries')) {
    db.exec("ALTER TABLE tasks ADD COLUMN max_retries INTEGER DEFAULT 3");
  }
  if (!colNames.includes('last_failure_reason')) {
    db.exec("ALTER TABLE tasks ADD COLUMN last_failure_reason TEXT DEFAULT ''");
  }
  if (!colNames.includes('retry_after')) {
    db.exec("ALTER TABLE tasks ADD COLUMN retry_after TEXT DEFAULT NULL");
  }
  if (!colNames.includes('timeout_seconds')) {
    db.exec("ALTER TABLE tasks ADD COLUMN timeout_seconds INTEGER DEFAULT NULL");
  }
  if (!colNames.includes('tokens_in')) {
    db.exec("ALTER TABLE tasks ADD COLUMN tokens_in INTEGER DEFAULT 0");
  }
  if (!colNames.includes('tokens_out')) {
    db.exec("ALTER TABLE tasks ADD COLUMN tokens_out INTEGER DEFAULT 0");
  }
  if (!colNames.includes('model_used')) {
    db.exec("ALTER TABLE tasks ADD COLUMN model_used TEXT DEFAULT ''");
  }
  if (!colNames.includes('duration_seconds')) {
    db.exec("ALTER TABLE tasks ADD COLUMN duration_seconds REAL DEFAULT 0");
  }
}

export function getDb(): Database.Database {
  const dbPath = findDbPath();
  if (!dbPath) {
    console.error('Error: No trak database found. Run `trak init` first.');
    process.exit(1);
  }
  _currentDbPath = dbPath;
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrateColumns(db);
  return db;
}

export function initDb(global?: boolean): Database.Database {
  const dir = global ? getGlobalDbDir() : path.join(process.cwd(), TRAK_DIR);
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
      status TEXT DEFAULT 'open' CHECK(status IN ('open','wip','blocked','review','done','archived','failed')),
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
      autonomy TEXT DEFAULT 'manual',
      budget_usd REAL DEFAULT NULL,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      last_failure_reason TEXT DEFAULT '',
      retry_after TEXT DEFAULT NULL,
      timeout_seconds INTEGER DEFAULT NULL,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      model_used TEXT DEFAULT '',
      duration_seconds REAL DEFAULT 0,
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

// ─── Config helpers (stored in trak_config table) ──────────
export function getConfigValue(key: string): any {
  const db = getDb();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS trak_config (key TEXT PRIMARY KEY, value TEXT)`);
    const row = db.prepare('SELECT value FROM trak_config WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  } catch {
    return undefined;
  }
}

export function setConfigValue(key: string, value: any): void {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS trak_config (key TEXT PRIMARY KEY, value TEXT)`);
  db.prepare('INSERT OR REPLACE INTO trak_config (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

export function loadConfig(): Record<string, any> {
  const db = getDb();
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS trak_config (key TEXT PRIMARY KEY, value TEXT)`);
    const rows = db.prepare('SELECT key, value FROM trak_config').all() as { key: string; value: string }[];
    const config: Record<string, any> = {};
    for (const row of rows) {
      try { config[row.key] = JSON.parse(row.value); } catch { config[row.key] = row.value; }
    }
    return config;
  } catch {
    return {};
  }
}

// ─── Timeout resolution ──────────────────────────────────
// Priority: CLI flag (passed as cliTimeout) → task.timeout_seconds → config "agent.timeout" → default (900s = 15min)
const DEFAULT_TIMEOUT_SECONDS = 900; // 15 minutes

/**
 * Parse a human-friendly duration string into seconds.
 * Supports: "30m", "1h", "90s", "1h30m", or plain number (treated as seconds).
 */
export function parseDuration(input: string): number {
  // Plain number = seconds
  if (/^\d+$/.test(input.trim())) return parseInt(input.trim(), 10);

  let total = 0;
  const hourMatch = input.match(/(\d+)\s*h/i);
  const minMatch = input.match(/(\d+)\s*m(?!s)/i);
  const secMatch = input.match(/(\d+)\s*s/i);

  if (hourMatch) total += parseInt(hourMatch[1], 10) * 3600;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);

  return total > 0 ? total : parseInt(input, 10) || DEFAULT_TIMEOUT_SECONDS;
}

/**
 * Resolve the effective timeout for a task in seconds.
 * Priority: cliTimeout → task.timeout_seconds → project timeout → timeout profile → config "agent.timeout" → 900s default
 */
export function resolveTimeout(opts: { cliTimeout?: string; task?: { timeout_seconds?: number | null; project?: string; tags?: string } }): number {
  // 1. CLI flag (highest priority)
  if (opts.cliTimeout) {
    return parseDuration(opts.cliTimeout);
  }

  // 2. Per-task timeout
  if (opts.task?.timeout_seconds && opts.task.timeout_seconds > 0) {
    return opts.task.timeout_seconds;
  }

  // 3. Per-project timeout
  if (opts.task?.project) {
    const projectTimeout = getConfigValue(`project.${opts.task.project}.timeout`);
    if (projectTimeout !== undefined) {
      if (typeof projectTimeout === 'number') return projectTimeout;
      if (typeof projectTimeout === 'string') return parseDuration(projectTimeout);
    }
  }

  // 4. Timeout profile (matched by task tags)
  if (opts.task?.tags) {
    const tags = opts.task.tags.split(',').map(t => t.trim().toLowerCase());
    for (const tag of tags) {
      const profileTimeout = getConfigValue(`timeout.profile.${tag}`);
      if (profileTimeout !== undefined) {
        if (typeof profileTimeout === 'number') return profileTimeout;
        if (typeof profileTimeout === 'string') return parseDuration(profileTimeout);
      }
    }
  }

  // 5. Global config
  const configVal = getConfigValue('agent.timeout');
  if (configVal !== undefined) {
    if (typeof configVal === 'number') return configVal;
    if (typeof configVal === 'string') return parseDuration(configVal);
  }

  // 6. Default
  return DEFAULT_TIMEOUT_SECONDS;
}

// Track the current DB path for afterWrite
let _currentDbPath: string | null = null;

export function getCurrentDbPath(): string | null {
  return _currentDbPath;
}

/**
 * After-write hook: append events to JSONL for git sync.
 * Must be called with the db instance and change context after any mutation.
 * Dynamically imports jsonl to avoid circular deps.
 * If sync.autocommit is enabled, also runs sync (git add + commit).
 */
export function afterWrite(db: Database.Database, eventData?: { op: string; id: string; data?: Record<string, any> }): void {
  try {
    const dbPath = _currentDbPath || findDbPath();
    if (!dbPath) return;
    
    // Dynamic require to avoid circular import
    const jsonl = require('./jsonl.js');
    
    if (eventData) {
      // Append event to log
      const event = {
        op: eventData.op,
        id: eventData.id,
        ts: new Date().toISOString().replace('T', ' ').slice(0, 19),
        data: eventData.data || {}
      };
      jsonl.appendEvent(dbPath, event);
    } else {
      // Fallback to full export (for backward compatibility)
      jsonl.exportToJsonl(db, dbPath);
    }

    // Check for autocommit config
    try {
      db.exec(`CREATE TABLE IF NOT EXISTS trak_config (key TEXT PRIMARY KEY, value TEXT)`);
      const row = db.prepare('SELECT value FROM trak_config WHERE key = ?').get('sync.autocommit') as { value: string } | undefined;
      if (row && JSON.parse(row.value) === true) {
        // Dynamic require to avoid circular deps
        const { syncCommand } = require('./commands/sync.js');
        syncCommand({ push: false });
      }
    } catch {
      // Autocommit is best-effort
    }
  } catch {
    // JSONL export is best-effort
  }
}

/**
 * Default backoff schedule for retries (in minutes).
 * Each entry corresponds to the delay before retry N.
 * If retry_count exceeds the array length, the last entry is used.
 *
 * Configurable via: trak config set retry.backoff "1,5,15,30,60"
 */
const DEFAULT_RETRY_BACKOFF_MINUTES = [1, 5, 15, 30, 60];

function getRetryBackoffMinutes(): number[] {
  try {
    const configured = getConfigValue('retry.backoff');
    if (configured) {
      if (Array.isArray(configured)) return configured.map(Number);
      if (typeof configured === 'string') return configured.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    }
  } catch { /* use default */ }
  return DEFAULT_RETRY_BACKOFF_MINUTES;
}

/**
 * Get the default max retries from config, or 3.
 */
export function getDefaultMaxRetries(): number {
  try {
    const configured = getConfigValue('retry.max-retries');
    if (configured !== undefined) {
      const n = typeof configured === 'number' ? configured : parseInt(String(configured), 10);
      if (!isNaN(n) && n >= 0) return n;
    }
  } catch { /* use default */ }
  return 3;
}

/**
 * Handle task failure with auto-retry logic.
 * If retry_count < max_retries, re-queues with exponential backoff.
 * If max_retries exceeded, marks as "failed" permanently.
 * Returns true if task was re-queued, false if permanently failed.
 */
export function taskFailed(db: Database.Database, taskId: string, reason: string): { requeued: boolean; retryCount: number; maxRetries: number } {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(taskId, `%${taskId}%`) as Task | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const newRetryCount = (task.retry_count || 0) + 1;
  const maxRetries = task.max_retries ?? 3;

  if (maxRetries > 0 && newRetryCount < maxRetries) {
    // Re-queue with backoff
    const backoffSchedule = getRetryBackoffMinutes();
    const backoffIdx = Math.min(newRetryCount - 1, backoffSchedule.length - 1);
    const backoffMinutes = backoffSchedule[backoffIdx];
    const retryAfter = new Date(Date.now() + backoffMinutes * 60000).toISOString().replace('T', ' ').slice(0, 19);

    db.prepare(`
      UPDATE tasks SET
        status = 'open',
        retry_count = ?,
        last_failure_reason = ?,
        retry_after = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(newRetryCount, reason, retryAfter, task.id);

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id,
      `Failed (retry ${newRetryCount}/${maxRetries}): ${reason}\nRe-queued with ${backoffMinutes}m backoff (retry after ${retryAfter})`
    );

    afterWrite(db, { op: 'update', id: task.id, data: { status: 'open', retry_count: newRetryCount, retry_after: retryAfter } });
    return { requeued: true, retryCount: newRetryCount, maxRetries };
  } else {
    // Permanently failed
    db.prepare(`
      UPDATE tasks SET
        status = 'failed',
        retry_count = ?,
        last_failure_reason = ?,
        retry_after = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(newRetryCount, reason, task.id);

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id,
      `Permanently failed after ${newRetryCount} attempts: ${reason}`
    );

    afterWrite(db, { op: 'update', id: task.id, data: { status: 'failed', retry_count: newRetryCount } });
    return { requeued: false, retryCount: newRetryCount, maxRetries };
  }
}

/**
 * Manually retry a failed task — resets retry_count and re-queues.
 */
export function manualRetry(db: Database.Database, taskId: string, resetCount: boolean = true): Task {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(taskId, `%${taskId}%`) as Task | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const newRetryCount = resetCount ? 0 : task.retry_count;

  db.prepare(`
    UPDATE tasks SET
      status = 'open',
      retry_count = ?,
      last_failure_reason = '',
      retry_after = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(newRetryCount, task.id);

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id,
    `Manually retried${resetCount ? ' (retry count reset)' : ''} — was: ${task.status}${task.last_failure_reason ? `, last failure: ${task.last_failure_reason}` : ''}`
  );

  afterWrite(db, { op: 'update', id: task.id, data: { status: 'open', retry_count: newRetryCount } });
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Task;
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
