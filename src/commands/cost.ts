import { getDb, Task } from '../db.js';
import { c } from '../utils.js';

export interface CostOptions {
  project?: string;
  week?: boolean;
}

export function costCommand(opts: CostOptions): void {
  const db = getDb();

  let sql = 'SELECT * FROM tasks WHERE (tokens_used > 0 OR cost_usd > 0)';
  const params: any[] = [];

  if (opts.project) {
    sql += ' AND project = ?';
    params.push(opts.project);
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
  console.log(`${'─'.repeat(50)}\n`);

  // Group by project
  const byProject = new Map<string, { tokens: number; cost: number; count: number }>();
  let totalTokens = 0;
  let totalCost = 0;

  for (const t of tasks) {
    const b = t.project || '(none)';
    if (!byProject.has(b)) byProject.set(b, { tokens: 0, cost: 0, count: 0 });
    const entry = byProject.get(b)!;
    entry.tokens += t.tokens_used;
    entry.cost += t.cost_usd;
    entry.count++;
    totalTokens += t.tokens_used;
    totalCost += t.cost_usd;
  }

  for (const [project, data] of byProject) {
    console.log(`  ${c.cyan}${project}${c.reset}`);
    console.log(`    Tasks: ${data.count}  Tokens: ${data.tokens.toLocaleString()}  Cost: ${c.yellow}$${data.cost.toFixed(4)}${c.reset}`);
  }

  console.log(`\n  ${c.bold}Total${c.reset}`);
  console.log(`    Tasks: ${tasks.length}  Tokens: ${totalTokens.toLocaleString()}  Cost: ${c.yellow}${c.bold}$${totalCost.toFixed(4)}${c.reset}`);
  console.log();
}
