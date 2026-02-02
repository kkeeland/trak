import { getDb, Task } from '../db.js';
import { c, padRight, truncate } from '../utils.js';
import {
  getCostSummary,
  getDailyTrend,
  getModelBreakdown,
  getTopExpensiveTasks,
  getTaskCostEvents,
  getBudgetAlerts,
  getBudgetStatus,
  exportCostData,
  findModelPricing,
  MODEL_PRICES,
  type CostEvent,
  type BudgetStatus,
} from '../cost-engine.js';

export interface CostOptions {
  project?: string;
  label?: string;
  week?: boolean;
  month?: boolean;
  agent?: string;
}

export interface CostTrendOptions {
  project?: string;
  days?: string;
}

export interface CostModelsOptions {
  project?: string;
}

export interface CostBudgetOptions {
  set?: string;
  project?: string;
}

export interface CostExportOptions {
  project?: string;
  since?: string;
  csv?: boolean;
}

export interface CostTopOptions {
  project?: string;
  limit?: string;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

function budgetBar(pct: number): string {
  const width = 20;
  const filled = Math.min(Math.round((pct / 100) * width), width);
  const empty = width - filled;
  const color = pct >= 100 ? c.red : pct >= 80 ? c.yellow : c.green;
  return `${color}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const chars = '▁▂▃▄▅▆▇█';
  return values.map(v => {
    const idx = Math.round(((v - min) / range) * (chars.length - 1));
    return chars[idx];
  }).join('');
}

// ─── Main cost command (overview/per-task) ────────────────

/**
 * Show cost for a specific task by ID
 */
function showTaskCost(id: string): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  console.log(`\n${c.bold}💰 Cost Detail — ${task.id}${c.reset}`);
  console.log(`  ${c.dim}${task.title}${c.reset}`);
  console.log(`${'─'.repeat(50)}\n`);

  console.log(`  ${c.dim}Status:${c.reset}     ${task.status}`);
  console.log(`  ${c.dim}Cost:${c.reset}       ${c.yellow}${formatCost(task.cost_usd)}${c.reset}`);
  console.log(`  ${c.dim}Tokens:${c.reset}     ${formatTokens(task.tokens_used)} total`);
  if (task.tokens_in || task.tokens_out) {
    console.log(`  ${c.dim}  In:${c.reset}       ${formatTokens(task.tokens_in)}`);
    console.log(`  ${c.dim}  Out:${c.reset}      ${formatTokens(task.tokens_out)}`);
  }
  if (task.model_used) {
    console.log(`  ${c.dim}Model:${c.reset}      ${c.cyan}${task.model_used}${c.reset}`);
    const pricing = findModelPricing(task.model_used);
    if (pricing) {
      console.log(`  ${c.dim}  Rate:${c.reset}     $${pricing.inputPer1M}/M in, $${pricing.outputPer1M}/M out`);
    }
  }
  if (task.duration_seconds > 0) {
    console.log(`  ${c.dim}Duration:${c.reset}   ${formatDuration(task.duration_seconds)}`);
  }
  if (task.budget_usd !== null && task.budget_usd !== undefined && task.budget_usd > 0) {
    const status = getBudgetStatus(db, task.id);
    const budgetColor = status.status === 'exceeded' ? c.red : status.status === 'warning' ? c.yellow : c.green;
    console.log(`  ${c.dim}Budget:${c.reset}     ${budgetColor}${formatCost(task.budget_usd)} (${status.percentUsed!.toFixed(0)}% used)${c.reset}`);
    console.log(`  ${c.dim}Remaining:${c.reset}  ${budgetColor}${formatCost(status.remainingUsd!)}${c.reset}`);
    console.log(`  ${budgetBar(status.percentUsed!)}`);
  }

  // Show granular cost events if available
  const events = getTaskCostEvents(task.id);
  if (events.length > 0) {
    console.log(`\n  ${c.bold}Cost Events (${events.length})${c.reset}`);
    console.log(`  ${'─'.repeat(46)}`);
    for (const evt of events.slice(-20)) {  // Show last 20
      const ts = evt.timestamp.slice(0, 16);
      const parts: string[] = [];
      if (evt.cost_usd > 0) parts.push(`${c.yellow}${formatCost(evt.cost_usd)}${c.reset}`);
      if (evt.tokens_in || evt.tokens_out) parts.push(`${formatTokens(evt.tokens_in)}→${formatTokens(evt.tokens_out)}`);
      if (evt.model) parts.push(`${c.cyan}${evt.model}${c.reset}`);
      if (evt.operation !== 'chat') parts.push(`${c.dim}${evt.operation}${c.reset}`);
      console.log(`  ${c.dim}${ts}${c.reset} ${parts.join(' ')}`);
    }
    if (events.length > 20) {
      console.log(`  ${c.dim}... and ${events.length - 20} more events${c.reset}`);
    }
  }

  // Show cost-related journal entries
  const costLogs = db.prepare(
    "SELECT timestamp, entry, author FROM task_log WHERE task_id = ? AND (entry LIKE '%cost%' OR entry LIKE '%budget%' OR entry LIKE '%💰%') ORDER BY timestamp ASC"
  ).all(task.id) as { timestamp: string; entry: string; author: string }[];

  if (costLogs.length > 0) {
    console.log(`\n  ${c.bold}Cost Journal${c.reset}`);
    console.log(`  ${'─'.repeat(46)}`);
    for (const log of costLogs) {
      console.log(`  ${c.dim}${log.timestamp}${c.reset} ${c.cyan}[${log.author}]${c.reset} ${log.entry.split('\n')[0]}`);
    }
  }

  console.log();
}

export function costCommand(idOrOpts?: string | CostOptions, maybeOpts?: CostOptions): void {
  let id: string | undefined;
  let opts: CostOptions;

  if (typeof idOrOpts === 'string') {
    id = idOrOpts;
    opts = maybeOpts || {};
  } else {
    opts = idOrOpts || {};
  }

  // If an ID was given, show per-task cost
  if (id) {
    showTaskCost(id);
    return;
  }

  // Overview report
  const since = opts.week ? new Date(Date.now() - 7 * 86400000).toISOString() :
                opts.month ? new Date(Date.now() - 30 * 86400000).toISOString() : undefined;

  const summary = getCostSummary({
    project: opts.project,
    label: opts.label,
    since,
    agent: opts.agent,
  });

  if (summary.taskCount === 0) {
    console.log(`${c.dim}No cost data found${c.reset}`);
    return;
  }

  const period = opts.week ? 'This Week' : opts.month ? 'This Month' : 'All Time';
  console.log(`\n${c.bold}💰 Cost Report — ${period}${c.reset}`);
  if (opts.project) console.log(`  ${c.dim}Project: ${opts.project}${c.reset}`);
  if (opts.label) console.log(`  ${c.dim}Label: ${opts.label}${c.reset}`);
  if (opts.agent) console.log(`  ${c.dim}Agent: ${opts.agent}${c.reset}`);
  console.log(`${'─'.repeat(60)}\n`);

  // Summary stats
  console.log(`  ${c.bold}Total Cost:${c.reset}    ${c.yellow}${c.bold}${formatCost(summary.totalCost)}${c.reset}`);
  console.log(`  ${c.bold}Tasks:${c.reset}         ${summary.taskCount}`);
  console.log(`  ${c.bold}Avg/Task:${c.reset}      ${formatCost(summary.avgCostPerTask)}`);
  console.log(`  ${c.bold}Tokens:${c.reset}        ${formatTokens(summary.totalTokens)} (${formatTokens(summary.totalTokensIn)} in / ${formatTokens(summary.totalTokensOut)} out)`);
  if (summary.totalDuration > 0) {
    console.log(`  ${c.bold}Duration:${c.reset}      ${formatDuration(summary.totalDuration)}`);
  }

  // Model breakdown inline
  if (summary.models.size > 0) {
    console.log(`\n  ${c.bold}By Model${c.reset}`);
    const sorted = [...summary.models.entries()].sort((a, b) => b[1].cost - a[1].cost);
    for (const [model, data] of sorted) {
      const pct = summary.totalCost > 0 ? ((data.cost / summary.totalCost) * 100).toFixed(0) : '0';
      console.log(`    ${c.cyan}${padRight(model, 28)}${c.reset} ${c.yellow}${padRight(formatCost(data.cost), 10)}${c.reset} ${c.dim}${pct}%${c.reset}  ${data.count} tasks  ${formatTokens(data.tokensIn + data.tokensOut)} tok`);
    }
  }

  // Budget alerts
  const alerts = getBudgetAlerts();
  if (alerts.length > 0) {
    console.log(`\n  ${c.bold}${c.red}⚠ Budget Alerts${c.reset}`);
    for (const alert of alerts) {
      const icon = alert.status === 'exceeded' ? '🔴' : '🟡';
      const task = getDb().prepare('SELECT title FROM tasks WHERE id = ?').get(alert.taskId) as { title: string } | undefined;
      console.log(`    ${icon} ${c.dim}${alert.taskId}${c.reset} ${task?.title || ''} — ${formatCost(alert.spentUsd)}/${formatCost(alert.budgetUsd!)} (${alert.percentUsed!.toFixed(0)}%)`);
    }
  }

  // Mini trend (last 7 days)
  const trend = getDailyTrend({ project: opts.project, days: 7 });
  if (trend.length > 1) {
    const costs = trend.map(d => d.cost);
    console.log(`\n  ${c.bold}7-day trend:${c.reset} ${sparkline(costs)} ${c.dim}(${formatCost(Math.min(...costs))}–${formatCost(Math.max(...costs))})${c.reset}`);
  }

  console.log();
}

// ─── Subcommands ──────────────────────────────────────────

/**
 * trak cost trend — Show daily cost trend with sparkline chart.
 */
export function costTrendCommand(opts: CostTrendOptions): void {
  const days = opts.days ? parseInt(opts.days, 10) : 30;
  const trend = getDailyTrend({ project: opts.project, days });

  if (trend.length === 0) {
    console.log(`${c.dim}No cost data in the last ${days} days${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}📈 Cost Trend — Last ${days} Days${c.reset}`);
  if (opts.project) console.log(`  ${c.dim}Project: ${opts.project}${c.reset}`);
  console.log(`${'─'.repeat(60)}\n`);

  const maxCost = Math.max(...trend.map(d => d.cost));
  const barWidth = 30;

  let runningTotal = 0;
  for (const day of trend) {
    runningTotal += day.cost;
    const barLen = maxCost > 0 ? Math.round((day.cost / maxCost) * barWidth) : 0;
    const bar = '█'.repeat(barLen);
    const dateStr = day.date.slice(5);  // MM-DD
    console.log(`  ${c.dim}${dateStr}${c.reset} ${c.yellow}${padRight(formatCost(day.cost), 10)}${c.reset} ${c.cyan}${bar}${c.reset}  ${c.dim}${day.tasks}t ${formatTokens(day.tokens)}tok${c.reset}`);
  }

  const totalCost = trend.reduce((s, d) => s + d.cost, 0);
  const totalTasks = trend.reduce((s, d) => s + d.tasks, 0);
  const avgDaily = totalCost / trend.length;

  console.log(`\n  ${c.bold}Total:${c.reset}     ${c.yellow}${formatCost(totalCost)}${c.reset} across ${totalTasks} tasks`);
  console.log(`  ${c.bold}Daily avg:${c.reset} ${formatCost(avgDaily)}`);

  // Projection
  const projectedMonthly = avgDaily * 30;
  console.log(`  ${c.bold}Projected:${c.reset} ${c.dim}~${formatCost(projectedMonthly)}/month${c.reset}`);
  console.log();
}

/**
 * trak cost models — Show cost breakdown by model.
 */
export function costModelsCommand(opts: CostModelsOptions): void {
  const breakdown = getModelBreakdown({ project: opts.project });

  if (breakdown.length === 0) {
    console.log(`${c.dim}No model cost data found${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}🤖 Cost by Model${c.reset}`);
  if (opts.project) console.log(`  ${c.dim}Project: ${opts.project}${c.reset}`);
  console.log(`${'─'.repeat(70)}\n`);

  const totalCost = breakdown.reduce((s, b) => s + b.cost, 0);

  console.log(`  ${c.dim}${padRight('Model', 28)} ${padRight('Cost', 12)} ${padRight('Share', 8)} ${padRight('Tasks', 8)} ${padRight('Tokens In', 12)} Tokens Out${c.reset}`);
  console.log(`  ${'─'.repeat(66)}`);

  for (const b of breakdown) {
    const pct = totalCost > 0 ? ((b.cost / totalCost) * 100).toFixed(0) + '%' : '0%';
    const pricing = findModelPricing(b.model);
    const rateNote = pricing ? `${c.dim} ($${pricing.inputPer1M}/$${pricing.outputPer1M}/M)${c.reset}` : '';

    console.log(`  ${c.cyan}${padRight(b.model, 28)}${c.reset} ${c.yellow}${padRight(formatCost(b.cost), 12)}${c.reset} ${padRight(pct, 8)} ${padRight(String(b.tasks), 8)} ${padRight(formatTokens(b.tokensIn), 12)} ${formatTokens(b.tokensOut)}${rateNote}`);
  }

  console.log(`\n  ${c.bold}Total: ${c.yellow}${formatCost(totalCost)}${c.reset}`);
  console.log();
}

/**
 * trak cost budget [task-id] — Show budget status or set budget.
 */
export function costBudgetCommand(id?: string, opts?: CostBudgetOptions): void {
  const db = getDb();

  // Set budget for a specific task
  if (id && opts?.set) {
    const amount = parseFloat(opts.set);
    if (isNaN(amount) || amount < 0) {
      console.error(`${c.red}Invalid budget amount: ${opts.set}${c.reset}`);
      process.exit(1);
    }

    const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
    if (!task) {
      console.error(`${c.red}Task not found: ${id}${c.reset}`);
      process.exit(1);
    }

    db.prepare("UPDATE tasks SET budget_usd = ?, updated_at = datetime('now') WHERE id = ?").run(amount, task.id);
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id, `Budget set: $${amount.toFixed(2)}`
    );

    console.log(`${c.green}✓${c.reset} Budget for ${c.dim}${task.id}${c.reset} set to ${c.yellow}$${amount.toFixed(2)}${c.reset}`);
    return;
  }

  // Show budget for a specific task
  if (id) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
    if (!task) {
      console.error(`${c.red}Task not found: ${id}${c.reset}`);
      process.exit(1);
    }

    const status = getBudgetStatus(db, task.id);
    console.log(`\n${c.bold}💰 Budget — ${task.id}${c.reset}`);
    console.log(`  ${c.dim}${task.title}${c.reset}\n`);

    if (status.status === 'no-budget') {
      console.log(`  ${c.dim}No budget set. Use: trak cost budget ${task.id} --set <amount>${c.reset}`);
    } else {
      console.log(`  ${c.dim}Budget:${c.reset}    ${formatCost(status.budgetUsd!)}`);
      console.log(`  ${c.dim}Spent:${c.reset}     ${formatCost(status.spentUsd)}`);
      console.log(`  ${c.dim}Remaining:${c.reset} ${formatCost(status.remainingUsd!)}`);
      console.log(`  ${budgetBar(status.percentUsed!)} ${status.percentUsed!.toFixed(0)}%`);
    }
    console.log();
    return;
  }

  // Show all budgets
  let sql = `
    SELECT * FROM tasks 
    WHERE budget_usd IS NOT NULL AND budget_usd > 0
    AND status NOT IN ('archived')
  `;
  const params: any[] = [];

  if (opts?.project) { sql += ' AND project = ?'; params.push(opts.project); }
  sql += ' ORDER BY (cost_usd / budget_usd) DESC';

  const tasks = db.prepare(sql).all(...params) as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No tasks with budgets. Set one: trak cost budget <task-id> --set <amount>${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}💰 Budget Overview${c.reset}`);
  if (opts?.project) console.log(`  ${c.dim}Project: ${opts.project}${c.reset}`);
  console.log(`${'─'.repeat(70)}\n`);

  for (const task of tasks) {
    const status = getBudgetStatus(db, task.id);
    const icon = status.status === 'exceeded' ? '🔴' : status.status === 'warning' ? '🟡' : '🟢';
    const pctStr = status.percentUsed !== null ? `${status.percentUsed.toFixed(0)}%` : '—';
    console.log(`  ${icon} ${c.dim}${task.id}${c.reset} ${truncate(task.title, 30)} ${c.yellow}${formatCost(task.cost_usd)}${c.reset}/${formatCost(task.budget_usd!)} ${budgetBar(status.percentUsed || 0)} ${pctStr}`);
  }

  const totalBudget = tasks.reduce((s, t) => s + (t.budget_usd || 0), 0);
  const totalSpent = tasks.reduce((s, t) => s + t.cost_usd, 0);
  console.log(`\n  ${c.bold}Total:${c.reset} ${c.yellow}${formatCost(totalSpent)}${c.reset} / ${formatCost(totalBudget)} (${(totalSpent / totalBudget * 100).toFixed(0)}%)`);
  console.log();
}

/**
 * trak cost top — Show most expensive tasks.
 */
export function costTopCommand(opts: CostTopOptions): void {
  const limit = opts.limit ? parseInt(opts.limit, 10) : 10;
  const tasks = getTopExpensiveTasks({ project: opts.project, limit });

  if (tasks.length === 0) {
    console.log(`${c.dim}No cost data found${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}🏆 Top ${limit} Most Expensive Tasks${c.reset}`);
  if (opts.project) console.log(`  ${c.dim}Project: ${opts.project}${c.reset}`);
  console.log(`${'─'.repeat(70)}\n`);

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const rank = `${i + 1}.`.padStart(3);
    const modelStr = t.model_used ? ` ${c.cyan}${t.model_used}${c.reset}` : '';
    const tokStr = t.tokens_used > 0 ? ` ${formatTokens(t.tokens_used)} tok` : '';
    console.log(`  ${c.dim}${rank}${c.reset} ${c.yellow}${padRight(formatCost(t.cost_usd), 10)}${c.reset} ${c.dim}${t.id}${c.reset} ${truncate(t.title, 35)}${modelStr}${c.dim}${tokStr}${c.reset}`);
  }
  console.log();
}

/**
 * trak cost export — Export cost data as JSON or CSV.
 */
export function costExportCommand(opts: CostExportOptions): void {
  const format = opts.csv ? 'csv' : 'json';
  const output = exportCostData({
    project: opts.project,
    since: opts.since,
    format,
  });
  console.log(output);
}

/**
 * trak cost prices — Show known model prices.
 */
export function costPricesCommand(): void {
  console.log(`\n${c.bold}💲 Model Pricing Reference${c.reset}`);
  console.log(`${'─'.repeat(60)}\n`);
  console.log(`  ${c.dim}${padRight('Model', 28)} ${padRight('Input/1M', 12)} Output/1M${c.reset}`);
  console.log(`  ${'─'.repeat(56)}`);

  let lastPrefix = '';
  for (const p of MODEL_PRICES) {
    const prefix = p.model.split('-')[0];
    if (prefix !== lastPrefix && lastPrefix !== '') {
      console.log('');
    }
    lastPrefix = prefix;
    console.log(`  ${c.cyan}${padRight(p.model, 28)}${c.reset} ${c.yellow}${padRight('$' + p.inputPer1M.toFixed(2), 12)}${c.reset} $${p.outputPer1M.toFixed(2)}`);
  }

  console.log(`\n  ${c.dim}Prices auto-applied when model is specified with token counts.${c.reset}`);
  console.log(`  ${c.dim}Update: edit cost-engine.ts MODEL_PRICES array.${c.reset}\n`);
}
