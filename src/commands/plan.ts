import { getDb, Task, Dependency } from '../db.js';
import { c } from '../utils.js';

export interface PlanOptions {
  project?: string;
  json?: boolean;
}

interface PlanTask {
  id: string;
  title: string;
  project: string;
  priority: number;
  convoy: string | null;
  blockedBy: string[];  // IDs of incomplete deps
}

export function planCommand(opts?: PlanOptions): void {
  const db = getDb();
  const project = opts?.project || '';

  // Get all open auto tasks
  let sql = `
    SELECT t.id, t.title, t.project, t.priority, t.convoy
    FROM tasks t
    WHERE t.status = 'open'
    AND t.autonomy = 'auto'
    AND t.blocked_by = ''
    AND (t.budget_usd IS NULL OR t.cost_usd <= t.budget_usd)
  `;
  const params: any[] = [];
  if (project) {
    sql += ' AND t.project = ?';
    params.push(project);
  }
  sql += ' ORDER BY t.priority DESC, t.created_at ASC';

  const openTasks = db.prepare(sql).all(...params) as Array<{
    id: string; title: string; project: string; priority: number; convoy: string | null;
  }>;

  if (openTasks.length === 0) {
    if (opts?.json) {
      console.log(JSON.stringify({ ready: [], waiting: [], total: 0, readyCount: 0, blockedCount: 0 }));
    } else {
      console.log(`${c.dim}No open auto tasks found.${c.reset}`);
    }
    return;
  }

  // Get all dependencies for these tasks
  const taskIds = openTasks.map(t => t.id);
  const placeholders = taskIds.map(() => '?').join(',');

  const deps = db.prepare(`
    SELECT d.child_id, d.parent_id, dep.status
    FROM dependencies d
    JOIN tasks dep ON dep.id = d.parent_id
    WHERE d.child_id IN (${placeholders})
  `).all(...taskIds) as Array<{ child_id: string; parent_id: string; status: string }>;

  // Build plan tasks with blocked-by info
  const planTasks: PlanTask[] = openTasks.map(t => {
    const taskDeps = deps.filter(d => d.child_id === t.id);
    const incompleteDeps = taskDeps
      .filter(d => !['done', 'archived'].includes(d.status))
      .map(d => d.parent_id);

    return {
      id: t.id,
      title: t.title,
      project: t.project,
      priority: t.priority,
      convoy: t.convoy,
      blockedBy: incompleteDeps,
    };
  });

  const ready = planTasks.filter(t => t.blockedBy.length === 0);
  const waiting = planTasks.filter(t => t.blockedBy.length > 0);

  // JSON output
  if (opts?.json) {
    console.log(JSON.stringify({
      ready: ready.map(t => ({ id: t.id, title: t.title, project: t.project, priority: t.priority })),
      waiting: waiting.map(t => ({ id: t.id, title: t.title, project: t.project, priority: t.priority, blockedBy: t.blockedBy })),
      total: planTasks.length,
      readyCount: ready.length,
      blockedCount: waiting.length,
    }, null, 2));
    return;
  }

  // Pretty output
  console.log(`\n${c.bold}📋 Execution Plan${c.reset}`);
  if (project) console.log(`  ${c.dim}Project:${c.reset} ${project}`);
  console.log(`${c.dim}${'─'.repeat(50)}${c.reset}\n`);

  if (ready.length > 0) {
    console.log(`${c.green}${c.bold}🚀 Ready now:${c.reset}`);
    for (const t of ready) {
      const proj = t.project ? ` ${c.dim}[${t.project}]${c.reset}` : '';
      console.log(`  ${c.bold}${t.id}${c.reset}  ${t.title}${proj}`);
    }
    console.log();
  }

  if (waiting.length > 0) {
    console.log(`${c.yellow}${c.bold}⏳ Waiting:${c.reset}`);

    // Build a title map for blockers (including tasks not in our set)
    const allBlockerIds = [...new Set(waiting.flatMap(t => t.blockedBy))];
    const blockerPlaceholders = allBlockerIds.map(() => '?').join(',');
    const blockerRows = allBlockerIds.length > 0
      ? db.prepare(`SELECT id, title FROM tasks WHERE id IN (${blockerPlaceholders})`).all(...allBlockerIds) as Array<{ id: string; title: string }>
      : [];
    const blockerTitles = new Map(blockerRows.map(r => [r.id, r.title]));

    for (const t of waiting) {
      const proj = t.project ? ` ${c.dim}[${t.project}]${c.reset}` : '';
      const blockers = t.blockedBy.map(bid => bid).join(', ');
      console.log(`  ${c.bold}${t.id}${c.reset}  ${t.title}${proj}  ${c.dim}← blocked by ${blockers}${c.reset}`);
    }
    console.log();
  }

  // Summary
  console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);
  console.log(`${c.bold}Total:${c.reset} ${planTasks.length} tasks, ${c.green}${ready.length} ready${c.reset}, ${c.yellow}${waiting.length} blocked${c.reset}\n`);
}
