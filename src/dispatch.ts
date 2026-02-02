/**
 * Trak Native Dispatch — spawn Clawdbot sub-agents for tasks.
 *
 * This module provides the core dispatch logic used by:
 *   - `trak sling --dispatch` — dispatch a single task
 *   - `trak run` — batch dispatch ready auto tasks
 *   - `trak close` — auto-dispatch newly unblocked tasks
 *
 * Dispatch flow:
 *   1. Claim task (set status=wip, assigned_to=agent)
 *   2. Build agent instruction with task context
 *   3. Spawn sub-agent via Clawdbot gateway sessions_spawn
 *   4. Log spawn result to task journal
 */

import { getDb, Task, afterWrite, resolveTimeout } from './db.js';
import { c } from './utils.js';
import {
  discoverGateway,
  spawnAgent,
  probeGateway,
  ensureGateway,
  type GatewayConfig,
  type SpawnResult,
} from './gateway.js';

// ─── Types ────────────────────────────────────────────────

export interface DispatchOptions {
  model?: string;
  timeout?: string;
  dryRun?: boolean;
  quiet?: boolean;
}

export interface DispatchResult {
  ok: boolean;
  taskId: string;
  taskTitle: string;
  label: string;
  sessionKey?: string;
  error?: string;
}

// ─── Task Instruction Builder ─────────────────────────────

/**
 * Build the instruction prompt for a spawned agent.
 */
export function buildAgentInstruction(task: Task | { id: string; title: string; description?: string; project?: string }): string {
  const cwd = process.cwd();
  return `You are working on a task tracked by trak (task tracker CLI).

## Task: ${task.title}
- **ID:** ${task.id}
- **Project:** ${(task as any).project || 'default'}
${(task as any).description ? `- **Details:** ${(task as any).description}` : ''}

## Working Directory
${cwd}

## Instructions
1. Complete the task described above
2. Log progress as you go: \`trak log ${task.id} "what you did"\`
3. When finished, close the task: \`trak close ${task.id} --force\`

The close command will automatically unblock dependent tasks in the chain.
Do NOT work on other tasks — focus only on this one.`;
}

// ─── Claim ────────────────────────────────────────────────

/**
 * Claim a task for agent dispatch (set WIP + assigned).
 */
export function claimForDispatch(taskId: string, agent: string = 'agent'): void {
  const db = getDb();
  db.prepare("UPDATE tasks SET status = 'wip', assigned_to = ?, updated_at = datetime('now') WHERE id = ?")
    .run(agent, taskId);
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')")
    .run(taskId, `Claimed for native dispatch (agent: ${agent})`);
  afterWrite(db);
}

// ─── Single Task Dispatch ─────────────────────────────────

/**
 * Dispatch a single task to a Clawdbot sub-agent.
 * Claims the task, builds instruction, and spawns.
 */
export async function dispatchTask(
  task: Task | { id: string; title: string; description?: string; project?: string; timeout_seconds?: number },
  opts?: DispatchOptions,
  gw?: GatewayConfig,
): Promise<DispatchResult> {
  const label = `trak-${task.id}`;

  // Dry run — just report what would happen
  if (opts?.dryRun) {
    if (!opts.quiet) {
      console.log(`  ${c.yellow}[dry-run]${c.reset} Would dispatch: ${c.bold}${task.id}${c.reset} — ${task.title}`);
    }
    return { ok: true, taskId: task.id, taskTitle: task.title, label };
  }

  // Ensure gateway
  if (!gw) {
    gw = await ensureGateway() ?? undefined;
    if (!gw) {
      const error = 'Gateway not reachable';
      if (!opts?.quiet) {
        console.error(`  ${c.red}✗${c.reset} Cannot dispatch ${task.id}: ${error}`);
      }
      return { ok: false, taskId: task.id, taskTitle: task.title, label, error };
    }
  }

  // Claim
  claimForDispatch(task.id);

  // Build instruction
  const instruction = buildAgentInstruction(task);

  // Resolve timeout
  const timeoutSec = resolveTimeout({ cliTimeout: opts?.timeout, task: task as Task });

  // Spawn
  try {
    const result: SpawnResult = await spawnAgent(gw, {
      task: instruction,
      label,
      cleanup: 'delete',
      runTimeoutSeconds: timeoutSec,
      ...(opts?.model ? { model: opts.model } : {}),
    });

    if (result.ok) {
      // Log success to task journal
      const db = getDb();
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')")
        .run(task.id, `Native dispatch: spawned sub-agent (label: ${label}, session: ${result.childSessionKey || 'unknown'})`);
      afterWrite(db);

      if (!opts?.quiet) {
        console.log(`  ${c.green}✓${c.reset} Spawned ${c.bold}${task.id}${c.reset} — ${task.title}`);
        console.log(`    ${c.dim}Label: ${label}${result.childSessionKey ? ` | Session: ${result.childSessionKey}` : ''}${c.reset}`);
      }

      return {
        ok: true,
        taskId: task.id,
        taskTitle: task.title,
        label,
        sessionKey: result.childSessionKey,
      };
    } else {
      // Log failure
      const db = getDb();
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')")
        .run(task.id, `Native dispatch failed: ${result.error}`);
      afterWrite(db);

      if (!opts?.quiet) {
        console.error(`  ${c.red}✗${c.reset} Gateway rejected ${c.bold}${task.id}${c.reset}: ${result.error}`);
      }

      return { ok: false, taskId: task.id, taskTitle: task.title, label, error: result.error };
    }
  } catch (err: any) {
    const error = err.message || String(err);

    // Log failure
    try {
      const db = getDb();
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')")
        .run(task.id, `Native dispatch error: ${error}`);
      afterWrite(db);
    } catch {}

    if (!opts?.quiet) {
      console.error(`  ${c.red}✗${c.reset} Dispatch failed for ${task.id}: ${error}`);
    }

    return { ok: false, taskId: task.id, taskTitle: task.title, label, error };
  }
}

// ─── Batch Dispatch ───────────────────────────────────────

/**
 * Dispatch multiple tasks in sequence, respecting a max concurrency.
 */
export async function dispatchBatch(
  tasks: (Task | { id: string; title: string; description?: string; project?: string; timeout_seconds?: number })[],
  opts?: DispatchOptions,
): Promise<DispatchResult[]> {
  if (tasks.length === 0) return [];

  // Pre-check gateway
  const gw = await ensureGateway();
  if (!gw) {
    if (!opts?.quiet) {
      console.error(`${c.red}✗${c.reset} Cannot reach Clawdbot gateway`);
      console.error(`  ${c.dim}Check: clawdbot gateway status${c.reset}`);
    }
    return tasks.map(t => ({
      ok: false,
      taskId: t.id,
      taskTitle: t.title,
      label: `trak-${t.id}`,
      error: 'Gateway not reachable',
    }));
  }

  if (!opts?.quiet) {
    console.log(`  ${c.dim}Gateway:${c.reset} ${gw.url} ${c.green}✓${c.reset}`);
  }

  const results: DispatchResult[] = [];

  for (const task of tasks) {
    const result = await dispatchTask(task, opts, gw);
    results.push(result);
  }

  return results;
}

// ─── Auto-Dispatch (for close → unblock chain) ───────────

/**
 * Find tasks that became unblocked after closing a parent task,
 * and dispatch them if they're auto-eligible.
 *
 * Returns the list of dispatched results (empty if nothing to dispatch).
 */
export async function autoDispatchUnblocked(
  closedTaskId: string,
  opts?: DispatchOptions,
): Promise<DispatchResult[]> {
  const db = getDb();

  // Find auto tasks that were blocked by closedTaskId and are now fully unblocked
  const unblockedAutoTasks = db.prepare(`
    SELECT t.* FROM tasks t
    JOIN dependencies d ON d.child_id = t.id AND d.parent_id = ?
    WHERE t.status IN ('open', 'blocked')
    AND t.autonomy = 'auto'
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d2
      JOIN tasks dep ON dep.id = d2.parent_id
      WHERE d2.child_id = t.id
      AND dep.status NOT IN ('done', 'archived')
    )
  `).all(closedTaskId) as Task[];

  if (unblockedAutoTasks.length === 0) return [];

  if (!opts?.quiet) {
    const names = unblockedAutoTasks.map(t => `${t.id} (${t.title})`).join(', ');
    console.log(`⚡ ${unblockedAutoTasks.length} task(s) unblocked: ${names}`);
  }

  // Try to dispatch via gateway
  const gw = await ensureGateway();
  if (!gw) {
    // Gateway not available — just mark as slung (old behavior)
    if (!opts?.quiet) {
      console.log(`  ${c.dim}Gateway not available — tasks marked as ready${c.reset}`);
    }
    for (const t of unblockedAutoTasks) {
      console.log(`TRAK_EVENT:UNBLOCKED:${t.id}:${t.title}`);
    }
    return [];
  }

  // Dispatch each unblocked task
  const results: DispatchResult[] = [];
  for (const task of unblockedAutoTasks) {
    if (!opts?.quiet) {
      console.log(`⚡ Auto-dispatching: ${task.id} — ${task.title}`);
    }
    const result = await dispatchTask(task, { ...opts, quiet: false }, gw);
    results.push(result);
  }

  return results;
}
