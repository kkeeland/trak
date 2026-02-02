/**
 * Cost Engine — Granular cost tracking, model pricing, budget enforcement, analytics
 *
 * This module provides:
 * - Model pricing lookup (auto-calculate cost from tokens)
 * - Cost event recording (per API call)
 * - Budget enforcement with alerts
 * - Time-series analytics
 * - Cost aggregation and reporting
 */

import type Database from 'better-sqlite3';
import { getDb, type Task, afterWrite } from './db.js';

// ─── Model Pricing ────────────────────────────────────────

export interface ModelPricing {
  model: string;
  inputPer1M: number;   // $ per 1M input tokens
  outputPer1M: number;  // $ per 1M output tokens
  cachePer1M?: number;  // $ per 1M cached input tokens (if applicable)
}

/**
 * Known model prices (updated periodically).
 * Prices in USD per 1M tokens.
 */
export const MODEL_PRICES: ModelPricing[] = [
  // Anthropic Claude
  { model: 'claude-opus-4-5', inputPer1M: 15.00, outputPer1M: 75.00, cachePer1M: 1.875 },
  { model: 'claude-sonnet-4', inputPer1M: 3.00, outputPer1M: 15.00, cachePer1M: 0.375 },
  { model: 'claude-haiku-3-5', inputPer1M: 0.80, outputPer1M: 4.00, cachePer1M: 0.08 },
  { model: 'claude-3.5-sonnet', inputPer1M: 3.00, outputPer1M: 15.00, cachePer1M: 0.375 },
  { model: 'claude-3-opus', inputPer1M: 15.00, outputPer1M: 75.00 },
  { model: 'claude-3-haiku', inputPer1M: 0.25, outputPer1M: 1.25 },
  // OpenAI
  { model: 'gpt-4o', inputPer1M: 2.50, outputPer1M: 10.00 },
  { model: 'gpt-4o-mini', inputPer1M: 0.15, outputPer1M: 0.60 },
  { model: 'gpt-4-turbo', inputPer1M: 10.00, outputPer1M: 30.00 },
  { model: 'gpt-4', inputPer1M: 30.00, outputPer1M: 60.00 },
  { model: 'o3', inputPer1M: 10.00, outputPer1M: 40.00 },
  { model: 'o3-mini', inputPer1M: 1.10, outputPer1M: 4.40 },
  { model: 'o4-mini', inputPer1M: 1.10, outputPer1M: 4.40 },
  // Google
  { model: 'gemini-2.5-pro', inputPer1M: 1.25, outputPer1M: 10.00 },
  { model: 'gemini-2.5-flash', inputPer1M: 0.15, outputPer1M: 0.60 },
  { model: 'gemini-2.0-flash', inputPer1M: 0.10, outputPer1M: 0.40 },
  { model: 'gemini-1.5-pro', inputPer1M: 1.25, outputPer1M: 5.00 },
  // DeepSeek
  { model: 'deepseek-v3', inputPer1M: 0.27, outputPer1M: 1.10 },
  { model: 'deepseek-r1', inputPer1M: 0.55, outputPer1M: 2.19 },
];

/**
 * Match a model string to pricing. Supports partial/fuzzy matching.
 * E.g. "anthropic/claude-opus-4-5" matches "claude-opus-4-5"
 */
export function findModelPricing(modelStr: string): ModelPricing | null {
  if (!modelStr) return null;
  const lower = modelStr.toLowerCase();

  // Exact match first
  const exact = MODEL_PRICES.find(p => lower === p.model);
  if (exact) return exact;

  // Contains match (e.g. "anthropic/claude-opus-4-5" contains "claude-opus-4-5")
  const contains = MODEL_PRICES.find(p => lower.includes(p.model));
  if (contains) return contains;

  // Reverse: price model is substring of input
  const reverse = MODEL_PRICES.find(p => p.model.includes(lower));
  if (reverse) return reverse;

  return null;
}

/**
 * Calculate cost from token counts and model.
 */
export function calculateCost(tokensIn: number, tokensOut: number, model: string): number {
  const pricing = findModelPricing(model);
  if (!pricing) return 0;

  return (tokensIn / 1_000_000) * pricing.inputPer1M +
         (tokensOut / 1_000_000) * pricing.outputPer1M;
}

// ─── Cost Events Table ────────────────────────────────────

export interface CostEvent {
  id?: number;
  task_id: string;
  timestamp: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  duration_seconds: number;
  agent: string;
  operation: string;  // e.g. "chat", "completion", "embedding", "tool_call"
  metadata: string;   // JSON blob for extra data
}

/**
 * Ensure cost_events table exists. Called lazily on first use.
 */
export function ensureCostEventsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      model TEXT DEFAULT '',
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0.0,
      duration_seconds REAL DEFAULT 0,
      agent TEXT DEFAULT '',
      operation TEXT DEFAULT 'chat',
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cost_events_task ON cost_events(task_id);
    CREATE INDEX IF NOT EXISTS idx_cost_events_ts ON cost_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_cost_events_model ON cost_events(model);
  `);
}

/**
 * Record a cost event and update the task's aggregate cost fields.
 * If cost_usd is 0, auto-calculates from model pricing.
 */
export function recordCostEvent(opts: {
  taskId: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationSeconds?: number;
  agent?: string;
  operation?: string;
  metadata?: Record<string, unknown>;
}): CostEvent {
  const db = getDb();
  ensureCostEventsTable(db);

  const tokensIn = opts.tokensIn || 0;
  const tokensOut = opts.tokensOut || 0;
  const model = opts.model || '';
  let costUsd = opts.costUsd || 0;

  // Auto-calculate cost if not provided
  if (costUsd === 0 && (tokensIn > 0 || tokensOut > 0) && model) {
    costUsd = calculateCost(tokensIn, tokensOut, model);
  }

  const totalTokens = tokensIn + tokensOut;
  const duration = opts.durationSeconds || 0;
  const agent = opts.agent || '';
  const operation = opts.operation || 'chat';
  const metadata = JSON.stringify(opts.metadata || {});

  // Insert event
  const result = db.prepare(`
    INSERT INTO cost_events (task_id, model, tokens_in, tokens_out, cost_usd, duration_seconds, agent, operation, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(opts.taskId, model, tokensIn, tokensOut, costUsd, duration, agent, operation, metadata);

  // Update task aggregates
  db.prepare(`
    UPDATE tasks SET
      cost_usd = cost_usd + ?,
      tokens_used = tokens_used + ?,
      tokens_in = tokens_in + ?,
      tokens_out = tokens_out + ?,
      model_used = CASE WHEN ? != '' THEN ? ELSE model_used END,
      duration_seconds = duration_seconds + ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(costUsd, totalTokens, tokensIn, tokensOut, model, model, duration, opts.taskId);

  // Check budget
  checkBudget(db, opts.taskId);

  return {
    id: result.lastInsertRowid as number,
    task_id: opts.taskId,
    timestamp: new Date().toISOString(),
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cost_usd: costUsd,
    duration_seconds: duration,
    agent,
    operation,
    metadata,
  };
}

// ─── Budget Enforcement ───────────────────────────────────

export interface BudgetStatus {
  taskId: string;
  budgetUsd: number | null;
  spentUsd: number;
  remainingUsd: number | null;
  percentUsed: number | null;
  status: 'ok' | 'warning' | 'exceeded' | 'no-budget';
}

/**
 * Check budget status for a task. Returns status object.
 */
export function getBudgetStatus(db: Database.Database, taskId: string): BudgetStatus {
  const task = db.prepare('SELECT id, budget_usd, cost_usd FROM tasks WHERE id = ?').get(taskId) as
    { id: string; budget_usd: number | null; cost_usd: number } | undefined;

  if (!task) {
    return { taskId, budgetUsd: null, spentUsd: 0, remainingUsd: null, percentUsed: null, status: 'no-budget' };
  }

  if (task.budget_usd === null || task.budget_usd === undefined || task.budget_usd <= 0) {
    return { taskId, budgetUsd: null, spentUsd: task.cost_usd, remainingUsd: null, percentUsed: null, status: 'no-budget' };
  }

  const percentUsed = (task.cost_usd / task.budget_usd) * 100;
  const remaining = task.budget_usd - task.cost_usd;

  let status: BudgetStatus['status'] = 'ok';
  if (percentUsed >= 100) status = 'exceeded';
  else if (percentUsed >= 80) status = 'warning';

  return {
    taskId,
    budgetUsd: task.budget_usd,
    spentUsd: task.cost_usd,
    remainingUsd: remaining,
    percentUsed,
    status,
  };
}

/**
 * Check budget and log alerts. Called automatically after recording cost events.
 */
function checkBudget(db: Database.Database, taskId: string): void {
  const status = getBudgetStatus(db, taskId);
  if (status.status === 'no-budget') return;

  if (status.status === 'exceeded') {
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      taskId,
      `⚠️ BUDGET EXCEEDED: $${status.spentUsd.toFixed(4)} spent of $${status.budgetUsd!.toFixed(2)} budget (${status.percentUsed!.toFixed(0)}%)`
    );
  } else if (status.status === 'warning') {
    // Only log warning once (check if we already warned)
    const existing = db.prepare(
      "SELECT 1 FROM task_log WHERE task_id = ? AND entry LIKE '%BUDGET WARNING%' LIMIT 1"
    ).get(taskId);
    if (!existing) {
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
        taskId,
        `⚠️ BUDGET WARNING: $${status.spentUsd.toFixed(4)} spent of $${status.budgetUsd!.toFixed(2)} budget (${status.percentUsed!.toFixed(0)}%)`
      );
    }
  }
}

/**
 * Check if a task has exceeded its budget. Returns true if safe to proceed.
 * Used by agents to gate expensive operations.
 */
export function isBudgetAvailable(taskId: string): boolean {
  const db = getDb();
  const status = getBudgetStatus(db, taskId);
  return status.status !== 'exceeded';
}

// ─── Analytics ────────────────────────────────────────────

export interface CostSummary {
  totalCost: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalTokens: number;
  totalDuration: number;
  taskCount: number;
  avgCostPerTask: number;
  models: Map<string, { cost: number; tokensIn: number; tokensOut: number; count: number }>;
}

/**
 * Aggregate cost summary across tasks with optional filters.
 */
export function getCostSummary(opts?: {
  project?: string;
  label?: string;
  since?: string;  // ISO date
  until?: string;  // ISO date
  agent?: string;
  status?: string;
}): CostSummary {
  const db = getDb();

  let sql = 'SELECT * FROM tasks WHERE (tokens_used > 0 OR cost_usd > 0)';
  const params: any[] = [];

  if (opts?.project) { sql += ' AND project = ?'; params.push(opts.project); }
  if (opts?.label) { sql += " AND (tags LIKE ? OR project = ?)"; params.push(`%${opts.label}%`, opts.label); }
  if (opts?.since) { sql += " AND updated_at >= ?"; params.push(opts.since); }
  if (opts?.until) { sql += " AND updated_at <= ?"; params.push(opts.until); }
  if (opts?.agent) { sql += " AND assigned_to = ?"; params.push(opts.agent); }
  if (opts?.status) { sql += " AND status = ?"; params.push(opts.status); }

  const tasks = db.prepare(sql).all(...params) as Task[];

  const models = new Map<string, { cost: number; tokensIn: number; tokensOut: number; count: number }>();
  let totalCost = 0, totalTokensIn = 0, totalTokensOut = 0, totalDuration = 0;

  for (const t of tasks) {
    totalCost += t.cost_usd;
    totalTokensIn += t.tokens_in || 0;
    totalTokensOut += t.tokens_out || 0;
    totalDuration += t.duration_seconds || 0;

    if (t.model_used) {
      const m = models.get(t.model_used) || { cost: 0, tokensIn: 0, tokensOut: 0, count: 0 };
      m.cost += t.cost_usd;
      m.tokensIn += t.tokens_in || 0;
      m.tokensOut += t.tokens_out || 0;
      m.count++;
      models.set(t.model_used, m);
    }
  }

  return {
    totalCost,
    totalTokensIn,
    totalTokensOut,
    totalTokens: totalTokensIn + totalTokensOut,
    totalDuration,
    taskCount: tasks.length,
    avgCostPerTask: tasks.length > 0 ? totalCost / tasks.length : 0,
    models,
  };
}

/**
 * Get daily cost aggregation for trend analysis.
 */
export function getDailyTrend(opts?: {
  project?: string;
  days?: number;
}): { date: string; cost: number; tokens: number; tasks: number }[] {
  const db = getDb();
  const days = opts?.days || 30;

  let sql = `
    SELECT 
      date(updated_at) as date,
      COALESCE(SUM(cost_usd), 0) as cost,
      COALESCE(SUM(tokens_used), 0) as tokens,
      COUNT(*) as tasks
    FROM tasks
    WHERE (tokens_used > 0 OR cost_usd > 0)
      AND updated_at > datetime('now', '-${days} days')
  `;
  const params: any[] = [];

  if (opts?.project) { sql += ' AND project = ?'; params.push(opts.project); }

  sql += ' GROUP BY date(updated_at) ORDER BY date ASC';

  return db.prepare(sql).all(...params) as { date: string; cost: number; tokens: number; tasks: number }[];
}

/**
 * Get cost breakdown by model.
 */
export function getModelBreakdown(opts?: {
  project?: string;
  since?: string;
}): { model: string; cost: number; tokensIn: number; tokensOut: number; tasks: number }[] {
  const db = getDb();

  let sql = `
    SELECT 
      model_used as model,
      COALESCE(SUM(cost_usd), 0) as cost,
      COALESCE(SUM(tokens_in), 0) as tokensIn,
      COALESCE(SUM(tokens_out), 0) as tokensOut,
      COUNT(*) as tasks
    FROM tasks
    WHERE model_used != '' AND (tokens_used > 0 OR cost_usd > 0)
  `;
  const params: any[] = [];

  if (opts?.project) { sql += ' AND project = ?'; params.push(opts.project); }
  if (opts?.since) { sql += ' AND updated_at >= ?'; params.push(opts.since); }

  sql += ' GROUP BY model_used ORDER BY cost DESC';

  return db.prepare(sql).all(...params) as { model: string; cost: number; tokensIn: number; tokensOut: number; tasks: number }[];
}

/**
 * Get top N most expensive tasks.
 */
export function getTopExpensiveTasks(opts?: {
  project?: string;
  limit?: number;
}): Task[] {
  const db = getDb();
  const limit = opts?.limit || 10;

  let sql = 'SELECT * FROM tasks WHERE cost_usd > 0';
  const params: any[] = [];

  if (opts?.project) { sql += ' AND project = ?'; params.push(opts.project); }

  sql += ' ORDER BY cost_usd DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params) as Task[];
}

/**
 * Get granular cost events for a specific task.
 */
export function getTaskCostEvents(taskId: string): CostEvent[] {
  const db = getDb();
  ensureCostEventsTable(db);

  return db.prepare(
    'SELECT * FROM cost_events WHERE task_id = ? ORDER BY timestamp ASC'
  ).all(taskId) as CostEvent[];
}

/**
 * Get tasks approaching or exceeding their budgets.
 */
export function getBudgetAlerts(): BudgetStatus[] {
  const db = getDb();

  const tasks = db.prepare(`
    SELECT id, budget_usd, cost_usd FROM tasks
    WHERE budget_usd IS NOT NULL AND budget_usd > 0
    AND status NOT IN ('done', 'archived')
    ORDER BY (cost_usd / budget_usd) DESC
  `).all() as { id: string; budget_usd: number; cost_usd: number }[];

  return tasks
    .map(t => getBudgetStatus(db, t.id))
    .filter(s => s.status === 'warning' || s.status === 'exceeded');
}

/**
 * Export cost data as JSON for external analysis.
 */
export function exportCostData(opts?: {
  project?: string;
  since?: string;
  format?: 'json' | 'csv';
}): string {
  const db = getDb();

  let sql = `
    SELECT id, title, project, status, model_used, tokens_in, tokens_out, tokens_used,
           cost_usd, duration_seconds, budget_usd, assigned_to, created_at, updated_at
    FROM tasks WHERE (tokens_used > 0 OR cost_usd > 0)
  `;
  const params: any[] = [];

  if (opts?.project) { sql += ' AND project = ?'; params.push(opts.project); }
  if (opts?.since) { sql += ' AND updated_at >= ?'; params.push(opts.since); }

  sql += ' ORDER BY cost_usd DESC';

  const tasks = db.prepare(sql).all(...params) as any[];

  if (opts?.format === 'csv') {
    const headers = ['id', 'title', 'project', 'status', 'model', 'tokens_in', 'tokens_out', 'cost_usd', 'duration_s', 'budget_usd', 'agent', 'created', 'updated'];
    const rows = tasks.map(t => [
      t.id, `"${(t.title || '').replace(/"/g, '""')}"`, t.project, t.status, t.model_used,
      t.tokens_in, t.tokens_out, t.cost_usd.toFixed(6), t.duration_seconds.toFixed(1),
      t.budget_usd ?? '', t.assigned_to, t.created_at, t.updated_at
    ].join(','));
    return [headers.join(','), ...rows].join('\n');
  }

  return JSON.stringify(tasks, null, 2);
}
