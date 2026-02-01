import { getDb, Task } from '../db.js';
import { c } from '../utils.js';

export interface CostOptions {
  project?: string;
  label?: string;
  week?: boolean;
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
  console.log(`  ${c.dim}Cost:${c.reset}       ${c.yellow}$${task.cost_usd.toFixed(4)}${c.reset}`);
  console.log(`  ${c.dim}Tokens:${c.reset}     ${formatTokens(task.tokens_used)} total`);
  if (task.tokens_in || task.tokens_out) {
    console.log(`  ${c.dim}  In:${c.reset}       ${formatTokens(task.tokens_in)}`);
    console.log(`  ${c.dim}  Out:${c.reset}      ${formatTokens(task.tokens_out)}`);
  }
  if (task.model_used) {
    console.log(`  ${c.dim}Model:${c.reset}      ${c.cyan}${task.model_used}${c.reset}`);
  }
  if (task.duration_seconds > 0) {
    console.log(`  ${c.dim}Duration:${c.reset}   ${formatDuration(task.duration_seconds)}`);
  }
  if (task.budget_usd !== null && task.budget_usd !== undefined) {
    const pct = task.budget_usd > 0 ? ((task.cost_usd / task.budget_usd) * 100).toFixed(0) : '∞';
    const budgetColor = task.cost_usd > task.budget_usd ? c.red : c.green;
    console.log(`  ${c.dim}Budget:${c.reset}     ${budgetColor}$${task.budget_usd.toFixed(2)} (${pct}% used)${c.reset}`);
  }

  // Show cost-related journal entries
  const costLogs = db.prepare(
    "SELECT timestamp, entry, author FROM task_log WHERE task_id = ? AND entry LIKE '%cost%' ORDER BY timestamp ASC"
  ).all(task.id) as { timestamp: string; entry: string; author: string }[];

  if (costLogs.length > 0) {
    console.log(`\n  ${c.bold}Cost Journal${c.reset}`);
    console.log(`  ${'─'.repeat(46)}`);
    for (const log of costLogs) {
      console.log(`  ${c.dim}${log.timestamp}${c.reset} ${c.cyan}[${log.author}]${c.reset} ${log.entry}`);
    }
  }

  console.log();
}

export function costCommand(idOrOpts?: string | CostOptions, maybeOpts?: CostOptions): void {
  // Handle: trak cost <id> vs trak cost [options]
  // Commander passes: costCommand(opts) for no positional, costCommand(id, opts) for positional
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

  const db = getDb();

  let sql = 'SELECT * FROM tasks WHERE (tokens_used > 0 OR cost_usd > 0)';
  const params: any[] = [];

  // --project or --label (label checks tags column)
  if (opts.project) {
    sql += ' AND project = ?';
    params.push(opts.project);
  }

  if (opts.label) {
    sql += " AND (tags LIKE ? OR project = ?)";
    params.push(`%${opts.label}%`, opts.label);
  }

  if (opts.week) {
    sql += " AND updated_at > datetime('now', '-7 days')";
  }

  sql += ' ORDER BY cost_usd DESC';

  const tasks = db.prepare(sql).all(...params) as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No cost data found${c.reset}`);
    return;
  }

  const period = opts.week ? 'This Week' : 'All Time';
  console.log(`\n${c.bold}💰 Cost Report — ${period}${c.reset}`);
  if (opts.project) console.log(`  ${c.dim}Project: ${opts.project}${c.reset}`);
  if (opts.label) console.log(`  ${c.dim}Label: ${opts.label}${c.reset}`);
  console.log(`${'─'.repeat(60)}\n`);

  // Group by project
  const byProject = new Map<string, {
    tokens: number; tokensIn: number; tokensOut: number;
    cost: number; count: number; duration: number;
    models: Set<string>;
  }>();
  let totalTokens = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCost = 0;
  let totalDuration = 0;
  const allModels = new Set<string>();

  for (const t of tasks) {
    const b = t.project || '(none)';
    if (!byProject.has(b)) byProject.set(b, { tokens: 0, tokensIn: 0, tokensOut: 0, cost: 0, count: 0, duration: 0, models: new Set() });
    const entry = byProject.get(b)!;
    entry.tokens += t.tokens_used;
    entry.tokensIn += (t.tokens_in || 0);
    entry.tokensOut += (t.tokens_out || 0);
    entry.cost += t.cost_usd;
    entry.count++;
    entry.duration += (t.duration_seconds || 0);
    if (t.model_used) { entry.models.add(t.model_used); allModels.add(t.model_used); }
    totalTokens += t.tokens_used;
    totalTokensIn += (t.tokens_in || 0);
    totalTokensOut += (t.tokens_out || 0);
    totalCost += t.cost_usd;
    totalDuration += (t.duration_seconds || 0);
  }

  for (const [project, data] of byProject) {
    console.log(`  ${c.cyan}${project}${c.reset}`);
    let line = `    Tasks: ${data.count}  Tokens: ${formatTokens(data.tokens)}`;
    if (data.tokensIn || data.tokensOut) {
      line += ` (${formatTokens(data.tokensIn)} in / ${formatTokens(data.tokensOut)} out)`;
    }
    line += `  Cost: ${c.yellow}$${data.cost.toFixed(4)}${c.reset}`;
    if (data.duration > 0) line += `  Time: ${formatDuration(data.duration)}`;
    console.log(line);
    if (data.models.size > 0) {
      console.log(`    ${c.dim}Models: ${[...data.models].join(', ')}${c.reset}`);
    }
  }

  console.log(`\n  ${c.bold}Total${c.reset}`);
  let totalLine = `    Tasks: ${tasks.length}  Tokens: ${formatTokens(totalTokens)}`;
  if (totalTokensIn || totalTokensOut) {
    totalLine += ` (${formatTokens(totalTokensIn)} in / ${formatTokens(totalTokensOut)} out)`;
  }
  totalLine += `  Cost: ${c.yellow}${c.bold}$${totalCost.toFixed(4)}${c.reset}`;
  if (totalDuration > 0) totalLine += `  Time: ${formatDuration(totalDuration)}`;
  console.log(totalLine);
  if (allModels.size > 0) {
    console.log(`    ${c.dim}Models: ${[...allModels].join(', ')}${c.reset}`);
  }
  console.log();
}
