import { getDb } from '../db.js';
import { c, padRight } from '../utils.js';

export interface StatsOptions {
  agent?: string;
  project?: string;
}

export function statsCommand(opts: StatsOptions): void {
  const db = getDb();

  let claimSql = `
    SELECT 
      tc.agent,
      COUNT(DISTINCT tc.task_id) as total_tasks,
      SUM(CASE WHEN t.verification_status = 'passed' THEN 1 ELSE 0 END) as verified,
      SUM(CASE WHEN t.verification_status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(
        CASE WHEN tc.released_at IS NOT NULL 
        THEN (julianday(tc.released_at) - julianday(tc.claimed_at)) * 1440
        ELSE NULL END
      ) as avg_minutes
    FROM task_claims tc
    JOIN tasks t ON tc.task_id = t.id
    WHERE tc.claimed_at > datetime('now', '-7 days')
  `;
  const params: any[] = [];

  if (opts.agent) {
    claimSql += ' AND tc.agent = ?';
    params.push(opts.agent);
  }
  if (opts.project) {
    claimSql += ' AND t.project = ?';
    params.push(opts.project);
  }

  claimSql += ' GROUP BY tc.agent ORDER BY total_tasks DESC';

  const agentStats = db.prepare(claimSql).all(...params) as {
    agent: string;
    total_tasks: number;
    verified: number;
    failed: number;
    avg_minutes: number | null;
  }[];

  // Also get stats from assigned_to for agents not using claims
  let assignSql = `
    SELECT 
      assigned_to as agent,
      COUNT(*) as total_tasks,
      SUM(CASE WHEN verification_status = 'passed' THEN 1 ELSE 0 END) as verified,
      SUM(CASE WHEN verification_status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM tasks
    WHERE assigned_to IS NOT NULL
      AND updated_at > datetime('now', '-7 days')
  `;
  const assignParams: any[] = [];

  if (opts.agent) {
    assignSql += ' AND assigned_to = ?';
    assignParams.push(opts.agent);
  }
  if (opts.project) {
    assignSql += ' AND project = ?';
    assignParams.push(opts.project);
  }

  assignSql += ' GROUP BY assigned_to ORDER BY total_tasks DESC';

  const assignStats = db.prepare(assignSql).all(...assignParams) as {
    agent: string;
    total_tasks: number;
    verified: number;
    failed: number;
  }[];

  const claimAgents = new Set(agentStats.map(a => a.agent));
  const merged = [...agentStats];
  for (const a of assignStats) {
    if (!claimAgents.has(a.agent)) {
      merged.push({ ...a, avg_minutes: null });
    }
  }

  if (merged.length === 0) {
    console.log(`${c.dim}No agent activity in the last 7 days${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}Agent Stats${c.reset} (last 7 days)\n`);

  let totalTasks = 0;

  for (const stat of merged) {
    totalTasks += stat.total_tasks;
    const avgStr = stat.avg_minutes != null ? `avg ${stat.avg_minutes.toFixed(1)}min` : '';
    console.log(`  ${c.bold}${padRight(stat.agent + ':', 18)}${c.reset} ${stat.total_tasks} tasks, ${stat.verified} verified ${c.green}✓${c.reset}, ${stat.failed} failed ${c.red}✗${c.reset}${avgStr ? `, ${c.dim}${avgStr}${c.reset}` : ''}`);
  }

  let costSql = `
    SELECT COALESCE(SUM(cost_usd), 0) as total 
    FROM tasks 
    WHERE updated_at > datetime('now', '-7 days')
  `;
  const costParams: any[] = [];
  if (opts.project) {
    costSql += ' AND project = ?';
    costParams.push(opts.project);
  }
  const costResult = db.prepare(costSql).get(...costParams) as { total: number };

  console.log(`\n  ${c.dim}Total: $${costResult.total.toFixed(2)} across ${totalTasks} tasks${c.reset}\n`);
}
