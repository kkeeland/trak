import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, truncate, getProjectColor } from '../utils.js';

export function boardCommand(project?: string): void {
  const db = getDb();

  let sql = "SELECT * FROM tasks WHERE status NOT IN ('done', 'archived')";
  const params: any[] = [];

  if (project) {
    sql += ' AND project = ?';
    params.push(project);
  }

  sql += ' ORDER BY priority DESC, updated_at DESC';
  const tasks = db.prepare(sql).all(...params) as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No active tasks${c.reset}`);
    return;
  }

  // Group by project
  const byProject = new Map<string, Task[]>();
  for (const t of tasks) {
    const b = t.project || '(no project)';
    if (!byProject.has(b)) byProject.set(b, []);
    byProject.get(b)!.push(t);
  }

  for (const [projectName, projectTasks] of byProject) {
    const bc = getProjectColor(projectName);
    console.log(`\n${bc}${c.bold}━━━ ${projectName.toUpperCase()} ━━━${c.reset} ${c.dim}(${projectTasks.length})${c.reset}`);

    // Group by status within project
    const statusOrder = ['wip', 'blocked', 'review', 'open'];
    for (const status of statusOrder) {
      const statusTasks = projectTasks.filter(t => t.status === status);
      if (statusTasks.length === 0) continue;

      const sc = statusColor(status);
      const emoji = STATUS_EMOJI[status];
      console.log(`  ${sc}${emoji} ${status.toUpperCase()}${c.reset}`);

      for (const t of statusTasks) {
        const prio = priorityLabel(t.priority);
        const title = truncate(t.title, 45);
        console.log(`    ${c.dim}${t.id}${c.reset} ${prio} ${title}`);
        if (t.blocked_by) {
          console.log(`      ${c.red}↳ ${t.blocked_by}${c.reset}`);
        }
      }
    }
  }
  console.log();
}
