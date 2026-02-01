import { getDb, Task, TaskClaim } from '../db.js';
import { c, truncate } from '../utils.js';

export function pipelineCommand(epicId: string): void {
  const db = getDb();

  const epic = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(epicId, `%${epicId}%`) as Task | undefined;
  if (!epic) {
    console.error(`${c.red}Epic not found: ${epicId}${c.reset}`);
    process.exit(1);
  }

  // Get children: subtasks via parent_id OR epic_id
  const subtasks = db.prepare(
    'SELECT * FROM tasks WHERE parent_id = ? OR epic_id = ? ORDER BY priority DESC, created_at ASC'
  ).all(epic.id, epic.id) as Task[];

  // Deduplicate
  const seen = new Set<string>();
  const unique: Task[] = [];
  for (const t of subtasks) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      unique.push(t);
    }
  }

  if (unique.length === 0) {
    console.log(`${c.dim}No subtasks found for epic ${epic.id}${c.reset}`);
    return;
  }

  const verified: Task[] = [];
  const needsVerify: Task[] = [];
  const inProgress: Task[] = [];
  const queued: Task[] = [];

  for (const t of unique) {
    if (t.verification_status === 'passed') {
      verified.push(t);
    } else if ((t.status === 'done' || t.status === 'review') && t.verification_status !== 'passed') {
      needsVerify.push(t);
    } else if (t.status === 'wip' || t.status === 'blocked') {
      inProgress.push(t);
    } else if (t.status !== 'archived') {
      queued.push(t);
    }
  }

  const total = unique.length;
  const done = verified.length;
  const barLen = 20;
  const filled = Math.round((done / total) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  console.log(`\n${c.bold}📋 EPIC: ${epic.title}${c.reset} [${bar}] ${done}/${total}\n`);

  if (verified.length > 0) {
    console.log(`  ${c.green}${c.bold}✅ VERIFIED${c.reset}`);
    for (const t of verified) {
      const built = t.assigned_to ? `built:${t.assigned_to}` : '';
      const verifiedBy = t.verified_by ? `verified:${t.verified_by} ✓` : '';
      console.log(`    ${c.dim}${t.id}${c.reset}  ${truncate(t.title, 30)}  ${c.dim}${built}  ${verifiedBy}${c.reset}`);
    }
    console.log();
  }

  if (needsVerify.length > 0) {
    console.log(`  ${c.magenta}${c.bold}👀 NEEDS VERIFICATION${c.reset}`);
    for (const t of needsVerify) {
      const built = t.assigned_to ? `built:${t.assigned_to}` : '';
      const vs = t.verification_status === 'failed' ? `${c.red}✗ failed${c.reset}` : `${c.yellow}⏳ awaiting verify${c.reset}`;
      console.log(`    ${c.dim}${t.id}${c.reset}  ${truncate(t.title, 30)}  ${c.dim}${built}${c.reset}  ${vs}`);
    }
    console.log();
  }

  if (inProgress.length > 0) {
    console.log(`  ${c.yellow}${c.bold}🔨 IN PROGRESS${c.reset}`);
    for (const t of inProgress) {
      const assigned = t.assigned_to ? `assigned:${t.assigned_to}` : '';
      const blocked = t.status === 'blocked' ? ` ${c.red}(blocked)${c.reset}` : '';
      console.log(`    ${c.dim}${t.id}${c.reset}  ${truncate(t.title, 30)}  ${c.dim}${assigned}${c.reset}${blocked}`);
    }
    console.log();
  }

  if (queued.length > 0) {
    console.log(`  ${c.dim}${c.bold}○ QUEUED${c.reset}`);
    for (const t of queued) {
      console.log(`    ${c.dim}${t.id}${c.reset}  ${truncate(t.title, 30)}`);
    }
    console.log();
  }
}
