import { getDb, Task, afterWrite } from '../db.js';
import { c, STATUS_EMOJI, generateId } from '../utils.js';

export interface SlingOptions {
  execute?: boolean;  // Actually spawn the agent (future)
  json?: boolean;     // Output JSON for piping
  project?: string;   // Filter by project when auto-picking
  goal?: string;      // Create a single task from a goal and dispatch it
}

export function slingCommand(taskId?: string, opts?: SlingOptions): void {
  const db = getDb();

  let task: Task | undefined;

  // --goal mode: create a single task from the goal and dispatch it
  if (opts?.goal) {
    const id = generateId();
    const project = opts.project || '';
    db.prepare(`
      INSERT INTO tasks (id, title, description, priority, project, autonomy, tags)
      VALUES (?, ?, ?, ?, ?, 'auto', 'auto,goal')
    `).run(id, opts.goal, opts.goal, 1, project);

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      id, `Created via trak sling --goal`
    );

    // Claim it
    db.prepare("UPDATE tasks SET status = 'wip', assigned_to = 'agent', updated_at = datetime('now') WHERE id = ?").run(id);
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      id, 'Slung to agent for autonomous execution'
    );
    afterWrite(db);

    const payload = {
      dispatched: true,
      task: {
        id,
        title: opts.goal,
        description: opts.goal,
        project,
        priority: 1,
        tags: 'auto,goal',
        convoy: null,
      },
      instruction: `Complete this goal: "${opts.goal}"\n\nWhen done, run: trak close ${id}\nIf you need to log progress: trak log ${id} "your update"`,
    };

    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`${c.green}✓${c.reset} ⚡ Created & slung ${c.bold}${id}${c.reset} — ${opts.goal}`);
      console.log(`  ${c.dim}Status: wip | Assigned: agent${c.reset}`);
      console.log(`  ${c.dim}Instruction: Complete and run 'trak close ${id}'${c.reset}`);
    }
    return;
  }

  if (taskId) {
    // Resolve task by ID
    task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(taskId, `%${taskId}%`) as Task | undefined;
  } else {
    // Auto-pick: highest priority ready auto task
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
    if (opts?.project) {
      sql += ' AND t.project = ?';
      params.push(opts.project);
    }
    sql += ' ORDER BY t.priority DESC, t.created_at ASC LIMIT 1';
    task = db.prepare(sql).get(...params) as Task | undefined;
  }

  if (!task) {
    if (opts?.json) {
      console.log(JSON.stringify({ dispatched: false, reason: 'no ready task found' }));
    } else {
      console.error(`${c.red}No ready task to sling${c.reset}`);
    }
    process.exit(1);
  }

  // Claim the task
  db.prepare("UPDATE tasks SET status = 'wip', assigned_to = 'agent', updated_at = datetime('now') WHERE id = ?").run(task.id);
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id, 'Slung to agent for autonomous execution'
  );
  afterWrite(db);

  // Build dispatch payload
  const payload = {
    dispatched: true,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      project: task.project,
      priority: task.priority,
      tags: task.tags,
      convoy: (task as any).convoy || null,
    },
    instruction: `Complete this task: "${task.title}"${task.description ? `\n\nDetails: ${task.description}` : ''}\n\nWhen done, run: trak close ${task.id}\nIf you need to log progress: trak log ${task.id} "your update"`,
  };

  if (opts?.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`${c.green}✓${c.reset} ⚡ Slung ${c.bold}${task.id}${c.reset} — ${task.title}`);
    console.log(`  ${c.dim}Status: wip | Assigned: agent${c.reset}`);
    console.log(`  ${c.dim}Instruction: Complete and run 'trak close ${task.id}'${c.reset}`);
  }
}
