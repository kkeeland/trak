import { getDb, Task, afterWrite } from '../db.js';
import { c, STATUS_EMOJI, generateId } from '../utils.js';
import { dispatchTask, buildAgentInstruction, type DispatchOptions, type DispatchResult } from '../dispatch.js';

export interface SlingOptions {
  execute?: boolean;  // Legacy alias for --dispatch
  dispatch?: boolean; // Actually spawn a Clawdbot sub-agent
  json?: boolean;     // Output JSON for piping
  project?: string;   // Filter by project when auto-picking
  goal?: string;      // Create a single task from a goal and dispatch it
  model?: string;     // Model for dispatched agent
  timeout?: string;   // Timeout for dispatched agent
  dryRun?: boolean;   // Preview dispatch without executing
}

export async function slingCommand(taskId?: string, opts?: SlingOptions): Promise<void> {
  const db = getDb();
  const shouldDispatch = opts?.dispatch || opts?.execute || false;

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
    afterWrite(db);

    // If --dispatch, spawn a real agent
    if (shouldDispatch) {
      const fakeTask = { id, title: opts.goal, description: opts.goal, project } as any;
      const result = await dispatchTask(fakeTask, {
        model: opts.model,
        timeout: opts.timeout,
        dryRun: opts.dryRun,
      });

      if (opts.json) {
        console.log(JSON.stringify({
          dispatched: result.ok,
          task: { id, title: opts.goal, project, priority: 1, tags: 'auto,goal' },
          label: result.label,
          sessionKey: result.sessionKey,
          error: result.error,
        }, null, 2));
      } else if (!result.ok) {
        console.error(`${c.red}✗${c.reset} Dispatch failed for ${id}: ${result.error}`);
      }
      return;
    }

    // Non-dispatch: mark WIP and output payload
    db.prepare("UPDATE tasks SET status = 'wip', assigned_to = 'agent', updated_at = datetime('now') WHERE id = ?").run(id);
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      id, 'Slung to agent for autonomous execution'
    );
    afterWrite(db);

    const payload = {
      dispatched: false,
      task: { id, title: opts.goal, description: opts.goal, project, priority: 1, tags: 'auto,goal', convoy: null },
      instruction: `Complete this goal: "${opts.goal}"\n\nWhen done, run: trak close ${id}\nIf you need to log progress: trak log ${id} "your update"`,
    };

    if (opts.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`${c.green}✓${c.reset} ⚡ Created & slung ${c.bold}${id}${c.reset} — ${opts.goal}`);
      console.log(`  ${c.dim}Status: wip | Assigned: agent${c.reset}`);
      if (shouldDispatch) {
        console.log(`  ${c.dim}Use --dispatch to spawn a Clawdbot agent${c.reset}`);
      }
    }
    return;
  }

  if (taskId) {
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
    sql += ' ORDER BY t.priority ASC, t.created_at ASC LIMIT 1';
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

  // Dispatch mode: spawn a real Clawdbot agent
  if (shouldDispatch) {
    const result = await dispatchTask(task, {
      model: opts?.model,
      timeout: opts?.timeout,
      dryRun: opts?.dryRun,
    });

    if (opts?.json) {
      console.log(JSON.stringify({
        dispatched: result.ok,
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          project: task.project,
          priority: task.priority,
          tags: task.tags,
          convoy: (task as any).convoy || null,
        },
        label: result.label,
        sessionKey: result.sessionKey,
        error: result.error,
      }, null, 2));
    }
    return;
  }

  // Non-dispatch: claim and output payload (legacy behavior)
  db.prepare("UPDATE tasks SET status = 'wip', assigned_to = 'agent', updated_at = datetime('now') WHERE id = ?").run(task.id);
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id, 'Slung to agent for autonomous execution'
  );
  afterWrite(db);

  const payload = {
    dispatched: false,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      project: task.project,
      priority: task.priority,
      tags: task.tags,
      convoy: (task as any).convoy || null,
    },
    instruction: buildAgentInstruction(task),
  };

  if (opts?.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`${c.green}✓${c.reset} ⚡ Slung ${c.bold}${task.id}${c.reset} — ${task.title}`);
    console.log(`  ${c.dim}Status: wip | Assigned: agent${c.reset}`);
    console.log(`  ${c.dim}Use --dispatch to spawn a Clawdbot agent${c.reset}`);
  }
}
