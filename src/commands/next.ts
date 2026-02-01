import { getDb, Task } from '../db.js';

export interface NextOptions {
  project?: string;
  json?: boolean;
}

export function nextCommand(opts: NextOptions): void {
  const db = getDb();

  let sql = `
    SELECT t.* FROM tasks t
    WHERE t.status IN ('open', 'wip')
    AND t.autonomy = 'auto'
    AND t.blocked_by = ''
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d
      JOIN tasks dep ON dep.id = d.parent_id
      WHERE d.child_id = t.id
      AND dep.status NOT IN ('done', 'archived')
    )
    AND (t.budget_usd IS NULL OR t.cost_usd <= t.budget_usd)
  `;
  const params: any[] = [];

  if (opts.project) {
    sql += ' AND t.project = ?';
    params.push(opts.project);
  }

  sql += ' ORDER BY t.priority DESC, t.created_at ASC LIMIT 1';

  const task = db.prepare(sql).get(...params) as Task | undefined;

  if (!task) {
    if (opts.json) {
      console.log(JSON.stringify({ found: false }));
    }
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify({
      found: true,
      id: task.id,
      title: task.title,
      project: task.project,
      priority: task.priority,
      autonomy: task.autonomy,
      budget_usd: task.budget_usd,
      cost_usd: task.cost_usd,
    }));
  } else {
    console.log(`${task.id} ${task.title}`);
  }
}
