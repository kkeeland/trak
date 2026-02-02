import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { initDb, getDb } from '../db.js';
import {
  calculateCost,
  findModelPricing,
  recordCostEvent,
  getBudgetStatus,
  getCostSummary,
  getModelBreakdown,
  getTopExpensiveTasks,
  getTaskCostEvents,
  getBudgetAlerts,
  isBudgetAvailable,
  exportCostData,
  ensureCostEventsTable,
} from '../cost-engine.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

function setupTestDb() {
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  const dir = fs.mkdtempSync(path.join(base, 'trak-cost-'));
  fs.mkdirSync(path.join(dir, '.trak'), { recursive: true });
  const dbPath = path.join(dir, '.trak', 'trak.db');
  process.env.TRAK_DB = dbPath;
  // initDb uses cwd(), so we need to chdir or use getDb after setting env
  // Instead, directly init by importing Database
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'open',
      priority INTEGER DEFAULT 1,
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
      duration_seconds REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS task_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      entry TEXT NOT NULL,
      author TEXT DEFAULT 'human',
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `);
  db.close();
  return getDb();
}

describe('Model Pricing', () => {
  test('findModelPricing — exact match', () => {
    const p = findModelPricing('claude-opus-4-5');
    expect(p).not.toBeNull();
    expect(p!.inputPer1M).toBe(15.00);
    expect(p!.outputPer1M).toBe(75.00);
  });

  test('findModelPricing — provider prefix match', () => {
    const p = findModelPricing('anthropic/claude-sonnet-4');
    expect(p).not.toBeNull();
    expect(p!.model).toBe('claude-sonnet-4');
  });

  test('findModelPricing — unknown model returns null', () => {
    expect(findModelPricing('unknown-model-xyz')).toBeNull();
  });

  test('calculateCost — basic calculation', () => {
    const cost = calculateCost(1_000_000, 500_000, 'claude-opus-4-5');
    expect(cost).toBeCloseTo(52.50, 2);
  });

  test('calculateCost — unknown model returns 0', () => {
    expect(calculateCost(1000, 500, 'nonexistent')).toBe(0);
  });
});

describe('Cost Events', () => {
  beforeEach(() => {
    const db = setupTestDb();
    ensureCostEventsTable(db);
    db.prepare(`INSERT INTO tasks (id, title) VALUES ('test-001', 'Test Task')`).run();
  });

  test('recordCostEvent — records and aggregates', () => {
    const evt = recordCostEvent({
      taskId: 'test-001',
      model: 'gpt-4o',
      tokensIn: 5000,
      tokensOut: 1000,
    });

    expect(evt.cost_usd).toBeGreaterThan(0);
    expect(evt.tokens_in).toBe(5000);
    expect(evt.tokens_out).toBe(1000);

    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get('test-001') as any;
    expect(task.tokens_in).toBe(5000);
    expect(task.tokens_out).toBe(1000);
    expect(task.cost_usd).toBeGreaterThan(0);
    expect(task.model_used).toBe('gpt-4o');
  });

  test('recordCostEvent — multiple events accumulate', () => {
    recordCostEvent({ taskId: 'test-001', model: 'gpt-4o', tokensIn: 1000, tokensOut: 500, costUsd: 0.05 });
    recordCostEvent({ taskId: 'test-001', model: 'gpt-4o', tokensIn: 2000, tokensOut: 800, costUsd: 0.10 });

    const db = getDb();
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get('test-001') as any;
    expect(task.cost_usd).toBeCloseTo(0.15, 4);
    expect(task.tokens_in).toBe(3000);
    expect(task.tokens_out).toBe(1300);

    const events = getTaskCostEvents('test-001');
    expect(events).toHaveLength(2);
  });

  test('recordCostEvent — auto-calculates cost from model', () => {
    const evt = recordCostEvent({
      taskId: 'test-001',
      model: 'gpt-4o-mini',
      tokensIn: 1_000_000,
      tokensOut: 100_000,
    });
    // 1M * $0.15/M + 0.1M * $0.60/M = $0.15 + $0.06 = $0.21
    expect(evt.cost_usd).toBeCloseTo(0.21, 2);
  });
});

describe('Budget', () => {
  beforeEach(() => {
    const db = setupTestDb();
    ensureCostEventsTable(db);
    db.prepare(`INSERT INTO tasks (id, title, budget_usd, cost_usd) VALUES ('budget-001', 'Budget Task', 1.00, 0.0)`).run();
  });

  test('getBudgetStatus — ok when under budget', () => {
    const db = getDb();
    const status = getBudgetStatus(db, 'budget-001');
    expect(status.status).toBe('ok');
    expect(status.percentUsed).toBe(0);
    expect(status.remainingUsd).toBe(1.0);
  });

  test('getBudgetStatus — warning at 80%', () => {
    const db = getDb();
    db.prepare('UPDATE tasks SET cost_usd = 0.85 WHERE id = ?').run('budget-001');
    const status = getBudgetStatus(db, 'budget-001');
    expect(status.status).toBe('warning');
    expect(status.percentUsed).toBeCloseTo(85, 0);
  });

  test('getBudgetStatus — exceeded at 100%+', () => {
    const db = getDb();
    db.prepare('UPDATE tasks SET cost_usd = 1.50 WHERE id = ?').run('budget-001');
    const status = getBudgetStatus(db, 'budget-001');
    expect(status.status).toBe('exceeded');
    expect(status.remainingUsd).toBeLessThan(0);
  });

  test('isBudgetAvailable — false when exceeded', () => {
    const db = getDb();
    db.prepare('UPDATE tasks SET cost_usd = 2.00 WHERE id = ?').run('budget-001');
    expect(isBudgetAvailable('budget-001')).toBe(false);
  });

  test('getBudgetAlerts — returns warning/exceeded tasks', () => {
    const db = getDb();
    db.prepare('UPDATE tasks SET cost_usd = 0.90 WHERE id = ?').run('budget-001');
    const alerts = getBudgetAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].status).toBe('warning');
  });
});

describe('Analytics', () => {
  beforeEach(() => {
    const db = setupTestDb();
    ensureCostEventsTable(db);
    db.prepare(`INSERT INTO tasks (id, title, project, cost_usd, tokens_used, tokens_in, tokens_out, model_used, duration_seconds) VALUES
      ('a-001', 'Task A', 'proj1', 0.50, 10000, 8000, 2000, 'gpt-4o', 30),
      ('a-002', 'Task B', 'proj1', 1.20, 25000, 20000, 5000, 'claude-opus-4-5', 60),
      ('a-003', 'Task C', 'proj2', 0.05, 5000, 4000, 1000, 'gpt-4o-mini', 10)
    `).run();
  });

  test('getCostSummary — aggregates all', () => {
    const summary = getCostSummary();
    expect(summary.taskCount).toBe(3);
    expect(summary.totalCost).toBeCloseTo(1.75, 2);
    expect(summary.totalTokensIn).toBe(32000);
    expect(summary.avgCostPerTask).toBeCloseTo(0.5833, 2);
    expect(summary.models.size).toBe(3);
  });

  test('getCostSummary — filter by project', () => {
    const summary = getCostSummary({ project: 'proj1' });
    expect(summary.taskCount).toBe(2);
    expect(summary.totalCost).toBeCloseTo(1.70, 2);
  });

  test('getModelBreakdown — groups by model', () => {
    const breakdown = getModelBreakdown();
    expect(breakdown.length).toBe(3);
    expect(breakdown[0].model).toBe('claude-opus-4-5');
  });

  test('getTopExpensiveTasks — ordered by cost desc', () => {
    const top = getTopExpensiveTasks({ limit: 2 });
    expect(top).toHaveLength(2);
    expect(top[0].cost_usd).toBeGreaterThanOrEqual(top[1].cost_usd);
  });

  test('exportCostData — JSON format', () => {
    const json = exportCostData({ format: 'json' });
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].cost_usd).toBeGreaterThanOrEqual(parsed[1].cost_usd);
  });

  test('exportCostData — CSV format', () => {
    const csv = exportCostData({ format: 'csv' });
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,');
    expect(lines.length).toBe(4);
  });
});
