#!/usr/bin/env node
/**
 * trak benchmark suite
 * Creates 500 tasks across 5 projects with dependencies,
 * then times each major operation.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { performance } = require('perf_hooks');

const BENCH_DIR = path.join(__dirname, '..', '.trak-bench');
const DB_PATH = path.join(BENCH_DIR, 'trak.db');

function setup() {
  if (fs.existsSync(BENCH_DIR)) {
    fs.rmSync(BENCH_DIR, { recursive: true });
  }
  fs.mkdirSync(BENCH_DIR, { recursive: true });

  const db = new Database(DB_PATH);
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

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_task_log_task_id ON task_log(task_id);
    CREATE INDEX IF NOT EXISTS idx_dependencies_child ON dependencies(child_id);
    CREATE INDEX IF NOT EXISTS idx_dependencies_parent ON dependencies(parent_id);
  `);

  return db;
}

function seedData(db) {
  const projects = ['api', 'web', 'mobile', 'infra', 'docs'];
  const statuses = ['open', 'wip', 'blocked', 'review'];
  const ids = [];

  const insertTask = db.prepare(`
    INSERT INTO tasks (id, title, description, status, priority, project, created_at, updated_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now', ?), datetime('now'), ?)
  `);

  const insertDep = db.prepare(`
    INSERT OR IGNORE INTO dependencies (child_id, parent_id) VALUES (?, ?)
  `);

  const insertLog = db.prepare(`
    INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (let i = 0; i < 500; i++) {
      const project = projects[i % 5];
      const id = `trak-${project}-${String(i).padStart(3, '0')}`;
      const status = statuses[i % 4];
      const priority = i % 4;
      const ageOffset = `-${Math.floor(Math.random() * 30)} days`;

      insertTask.run(
        id, `Task ${i}: ${project} work item`, `Description for task ${i}`,
        status, priority, project, ageOffset, `bench,${project}`
      );
      ids.push(id);
      insertLog.run(id, `Initial work on task ${i}`, 'bench-agent');
    }

    // ~495 dependencies (each task depends on one 5 positions earlier = same project)
    for (let i = 5; i < 500; i++) {
      const project = projects[i % 5];
      const childId = `trak-${project}-${String(i).padStart(3, '0')}`;
      const parentIdx = i - 5;
      const parentId = `trak-${project}-${String(parentIdx).padStart(3, '0')}`;
      insertDep.run(childId, parentId);
    }
  });

  insertAll();
  return ids;
}

function benchList(db) {
  const start = performance.now();
  db.prepare(`SELECT * FROM tasks WHERE status NOT IN ('done', 'archived') ORDER BY priority ASC, updated_at DESC`).all();
  return performance.now() - start;
}

function benchBoard(db) {
  const start = performance.now();
  const tasks = db.prepare(`SELECT * FROM tasks WHERE status NOT IN ('done', 'archived') ORDER BY project, status, priority ASC`).all();
  const grouped = {};
  for (const t of tasks) {
    if (!grouped[t.project]) grouped[t.project] = [];
    grouped[t.project].push(t);
  }
  return performance.now() - start;
}

function benchReady(db) {
  const start = performance.now();
  const tasks = db.prepare(`SELECT * FROM tasks WHERE status = 'open' ORDER BY priority ASC`).all();
  const checkDeps = db.prepare(`
    SELECT d.parent_id, t.status FROM dependencies d
    JOIN tasks t ON t.id = d.parent_id WHERE d.child_id = ?
  `);
  const ready = tasks.filter(task => {
    const deps = checkDeps.all(task.id);
    return deps.every(d => d.status === 'done');
  });
  return performance.now() - start;
}

function benchHeat(db) {
  const start = performance.now();
  const tasks = db.prepare(`SELECT * FROM tasks WHERE status NOT IN ('done', 'archived')`).all();
  const getDependents = db.prepare('SELECT COUNT(*) as cnt FROM dependencies WHERE parent_id = ?');
  const getLastLog = db.prepare('SELECT timestamp FROM task_log WHERE task_id = ? ORDER BY timestamp DESC LIMIT 1');

  const scored = tasks.map(task => {
    let heat = 0;
    const dependents = getDependents.get(task.id);
    heat += dependents.cnt * 2;
    const ageMs = Date.now() - new Date(task.created_at).getTime();
    heat += Math.min(Math.floor((ageMs / 86400000) / 7), 3);
    const lastLog = getLastLog.get(task.id);
    if (lastLog) {
      const logAge = (Date.now() - new Date(lastLog.timestamp).getTime()) / 86400000;
      if (logAge < 1) heat += 2;
      else if (logAge < 3) heat += 1;
    }
    heat += task.priority;
    if (task.status === 'blocked') heat = Math.max(heat - 2, 0);
    return { ...task, heat };
  });
  scored.sort((a, b) => b.heat - a.heat);
  return performance.now() - start;
}

function benchCreate(db) {
  const id = `trak-bench-new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const start = performance.now();
  db.prepare(`INSERT INTO tasks (id, title, description, status, priority, project, tags) VALUES (?, ?, ?, 'open', 1, 'bench', 'bench')`).run(id, 'Benchmark new task', 'Created during benchmark');
  return performance.now() - start;
}

function benchShow(db, taskId) {
  const start = performance.now();
  db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  db.prepare('SELECT * FROM task_log WHERE task_id = ? ORDER BY timestamp').all(taskId);
  db.prepare(`SELECT d.parent_id, t.title, t.status FROM dependencies d JOIN tasks t ON t.id = d.parent_id WHERE d.child_id = ?`).all(taskId);
  return performance.now() - start;
}

function benchClose(db, taskId) {
  const start = performance.now();
  db.prepare(`UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?`).run(taskId);
  db.prepare(`INSERT INTO task_log (task_id, entry, author) VALUES (?, 'Closed', 'bench')`).run(taskId);
  return performance.now() - start;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// --- Run ---
console.log('🏁 trak benchmark suite\n');
console.log('Setting up: fresh DB, 500 tasks, 5 projects, ~495 dependencies...\n');

const db = setup();
const ids = seedData(db);

// Warm SQLite caches
db.prepare('SELECT COUNT(*) FROM tasks').get();
db.prepare('SELECT COUNT(*) FROM dependencies').get();

const RUNS = 5;
const results = {};
const benchmarks = [
  ['trak create', () => benchCreate(db)],
  ['trak list', () => benchList(db)],
  ['trak board', () => benchBoard(db)],
  ['trak ready', () => benchReady(db)],
  ['trak heat', () => benchHeat(db)],
  ['trak show', () => benchShow(db, ids[42])],
  ['trak close', () => benchClose(db, ids[499])],
];

for (const [name, fn] of benchmarks) {
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    times.push(fn());
  }
  results[name] = median(times);
}

db.close();
if (fs.existsSync(BENCH_DIR)) fs.rmSync(BENCH_DIR, { recursive: true });

// Print
console.log('┌─────────────────┬───────┬──────────┐');
console.log('│ Operation       │ Tasks │ Time     │');
console.log('├─────────────────┼───────┼──────────┤');

const taskCounts = {
  'trak create': '—',
  'trak list': '500',
  'trak board': '500',
  'trak ready': '500',
  'trak heat': '500',
  'trak show': '1',
  'trak close': '1',
};

for (const [name, ms] of Object.entries(results)) {
  const tasks = (taskCounts[name] || '—').padStart(5);
  const op = name.padEnd(15);
  const t = `${ms.toFixed(1)}ms`.padStart(8);
  console.log(`│ ${op} │ ${tasks} │ ${t} │`);
}

console.log('└─────────────────┴───────┴──────────┘');
console.log('\n✅ All benchmarks complete.');
