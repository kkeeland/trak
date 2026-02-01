import { getDb, Task, TaskClaim } from '../db.js';
import { c, padRight, formatDate } from '../utils.js';

export interface ClaimsOptions {
  agent?: string;
}

export function claimsCommand(opts: ClaimsOptions): void {
  const db = getDb();

  let sql = `
    SELECT tc.*, t.title, t.id as tid
    FROM task_claims tc
    JOIN tasks t ON tc.task_id = t.id
    WHERE tc.status = 'claimed'
  `;
  const params: any[] = [];

  if (opts.agent) {
    sql += ' AND tc.agent = ?';
    params.push(opts.agent);
  }

  sql += ' ORDER BY tc.claimed_at ASC';
  const claims = db.prepare(sql).all(...params) as (TaskClaim & { title: string; tid: string })[];

  if (claims.length === 0) {
    console.log(`${c.dim}No active claims${opts.agent ? ` for ${opts.agent}` : ''}${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}Active Claims${c.reset} (${claims.length})\n`);
  console.log(`  ${c.dim}${padRight('AGENT', 16)} ${padRight('TASK', 14)} ${padRight('MODEL', 14)} DURATION${c.reset}`);
  console.log(`  ${c.dim}${'─'.repeat(60)}${c.reset}`);

  for (const claim of claims) {
    const duration = formatDate(claim.claimed_at);
    const agent = padRight(claim.agent, 16);
    const taskId = padRight(claim.tid, 14);
    const model = padRight(claim.model || '—', 14);
    console.log(`  ${c.bold}${agent}${c.reset} ${c.dim}${taskId}${c.reset} ${model} ${c.dim}${duration}${c.reset}`);
    console.log(`  ${' '.repeat(16)} ${c.cyan}${claim.title}${c.reset}`);
  }
  console.log();
}
