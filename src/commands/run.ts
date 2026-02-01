import { getDb, Task, afterWrite, resolveTimeout } from '../db.js';
import { c } from '../utils.js';
import { discoverGateway, spawnAgent, probeGateway, type GatewayConfig, type SpawnResult } from '../gateway.js';
import { acquireLock } from '../locks.js';

export interface RunOptions {
  project?: string;
  dryRun?: boolean;
  maxAgents?: string;
  model?: string;
  watch?: boolean;
  timeout?: string;
  minPriority?: string;
}

interface ReadyTask {
  id: string;
  title: string;
  description: string;
  project: string;
  priority: number;
  tags: string;
  convoy: string | null;
  timeout_seconds: number | null;
}

function getReadyAutoTasks(project?: string, minPriority?: number): ReadyTask[] {
  const db = getDb();
  let sql = `
    SELECT t.* FROM tasks t
    WHERE t.status = 'open'
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
  if (project) {
    sql += ' AND t.project = ?';
    params.push(project);
  }
  // Default: only dispatch P0-P1 tasks (priority 0-1), use --min-priority 3 for all
  // Note: priority 0 = P0 (critical), 3 = P3 (low). Lower number = higher priority.
  const maxPrio = minPriority ?? 1;
  sql += ' AND t.priority <= ?';
  params.push(maxPrio);
  sql += ' ORDER BY t.priority DESC, t.created_at ASC';
  return db.prepare(sql).all(...params) as ReadyTask[];
}

function claimTask(taskId: string): void {
  const db = getDb();
  db.prepare("UPDATE tasks SET status = 'wip', assigned_to = 'agent', updated_at = datetime('now') WHERE id = ?").run(taskId);
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    taskId, 'Claimed by trak run orchestrator'
  );
  afterWrite(db);
}

function getConvoyName(convoyId: string | null): string {
  if (!convoyId) return '';
  const db = getDb();
  const convoy = db.prepare('SELECT name FROM convoys WHERE id = ?').get(convoyId) as { name: string } | undefined;
  return convoy?.name || convoyId;
}

function buildAgentTask(task: ReadyTask): string {
  const cwd = process.cwd();
  let instruction = `You are working on a task tracked by trak (task tracker CLI).

## Task: ${task.title}
- **ID:** ${task.id}
- **Project:** ${task.project || 'default'}
${task.description ? `- **Details:** ${task.description}` : ''}

## Working Directory
${cwd}

## Instructions
1. Complete the task described above
2. Log progress as you go: \`trak log ${task.id} "what you did"\`
3. When finished, close the task: \`trak close ${task.id}\`

The close command will automatically unblock dependent tasks in the chain.
Do NOT work on other tasks — focus only on this one.`;

  return instruction;
}

async function dispatchTask(
  gw: GatewayConfig,
  task: ReadyTask,
  opts: RunOptions,
): Promise<{ id: string; title: string; label: string; sessionKey?: string } | null> {
  // Check workspace lock before dispatching
  const cwd = process.cwd();
  const lockResult = acquireLock(cwd, task.id, 'trak-run');
  if (!lockResult.acquired) {
    const holder = lockResult.holder;
    console.log(`  ${c.red}🔒${c.reset} Workspace locked by task ${c.bold}${holder.taskId}${c.reset} (agent: ${holder.agent}, PID: ${holder.pid})`);
    console.log(`    ${c.dim}Skipping ${task.id} — use 'trak unlock ${cwd}' to force-release${c.reset}`);
    return null;
  }

  claimTask(task.id);

  const agentTask = buildAgentTask(task);
  const label = `trak-${task.id}`;

  const timeoutSec = resolveTimeout({ cliTimeout: opts.timeout, task });

  try {
    const result: SpawnResult = await spawnAgent(gw, {
      task: agentTask,
      label,
      cleanup: 'delete',
      runTimeoutSeconds: timeoutSec,
      ...(opts.model ? { model: opts.model } : {}),
    });

    if (result.ok) {
      console.log(`  ${c.green}✓${c.reset} Spawned agent for ${c.bold}${task.id}${c.reset} — ${task.title}`);
      console.log(`    ${c.dim}Label: ${label}${result.childSessionKey ? ` | Session: ${result.childSessionKey}` : ''}${c.reset}`);
      return { id: task.id, title: task.title, label, sessionKey: result.childSessionKey };
    } else {
      console.error(`  ${c.red}✗${c.reset} Gateway rejected ${c.bold}${task.id}${c.reset}: ${result.error}`);
      return null;
    }
  } catch (err: any) {
    console.error(`  ${c.red}✗${c.reset} Failed to dispatch ${task.id}: ${err.message}`);
    return null;
  }
}

export async function runCommand(opts: RunOptions): Promise<void> {
  const maxAgents = parseInt(opts.maxAgents || '3', 10);
  const minPriority = opts.minPriority !== undefined ? parseInt(opts.minPriority, 10) : undefined;
  const readyTasks = getReadyAutoTasks(opts.project, minPriority);

  if (readyTasks.length === 0) {
    console.log(`${c.dim}No ready auto tasks to run.${c.reset}`);
    return;
  }

  // Limit to maxAgents
  const tasksToRun = readyTasks.slice(0, maxAgents);

  console.log(`\n${c.bold}🚀 trak run${c.reset} — dispatching ${tasksToRun.length} task(s)\n`);

  if (opts.project) {
    console.log(`  ${c.dim}Project:${c.reset} ${opts.project}`);
  }
  console.log(`  ${c.dim}Max agents:${c.reset} ${maxAgents}`);
  console.log(`  ${c.dim}Ready tasks:${c.reset} ${readyTasks.length} total, running ${tasksToRun.length}`);

  const convoyName = getConvoyName(tasksToRun[0]?.convoy);
  if (convoyName) {
    console.log(`  ${c.dim}Convoy:${c.reset} ${convoyName}`);
  }

  // Discover gateway
  const gw = discoverGateway();
  console.log(`  ${c.dim}Gateway:${c.reset} ${gw.url}`);
  console.log(`  ${c.dim}Auth:${c.reset} ${gw.token ? 'token ✓' : 'none'}`);

  console.log(`\n${c.dim}${'─'.repeat(50)}${c.reset}\n`);

  if (opts.dryRun) {
    for (const task of tasksToRun) {
      const label = `trak-${task.id}`;
      const timeoutSec = resolveTimeout({ cliTimeout: opts.timeout, task });
      console.log(`  ${c.yellow}[dry-run]${c.reset} Would dispatch: ${c.bold}${task.id}${c.reset} — ${task.title}`);
      console.log(`    ${c.dim}Label: ${label} | Timeout: ${timeoutSec}s | Cleanup: delete${c.reset}`);
    }

    // Probe gateway connectivity
    const reachable = await probeGateway(gw);
    console.log(`\n  ${c.dim}Gateway reachable:${c.reset} ${reachable ? `${c.green}yes${c.reset}` : `${c.red}no${c.reset}`}`);
    console.log(`\n${c.dim}No agents spawned (dry run)${c.reset}`);
    return;
  }

  // Probe gateway before dispatching
  const gwReachable = await probeGateway(gw);
  if (!gwReachable) {
    console.error(`\n${c.red}✗${c.reset} Cannot reach Clawdbot gateway at ${gw.url}`);
    console.error(`  ${c.dim}Check: clawdbot gateway status${c.reset}`);
    console.error(`  ${c.dim}Or set CLAWDBOT_GATEWAY_URL / CLAWDBOT_GATEWAY_TOKEN env vars${c.reset}`);
    process.exit(1);
  }

  console.log(`  ${c.dim}Gateway connected${c.reset} ${c.green}✓${c.reset}\n`);

  // Dispatch each task
  const dispatched: { id: string; title: string; label: string; sessionKey?: string }[] = [];

  for (const task of tasksToRun) {
    const result = await dispatchTask(gw, task, opts);
    if (result) dispatched.push(result);
  }

  console.log(`\n${c.dim}${'─'.repeat(50)}${c.reset}`);
  console.log(`\n${c.green}✓${c.reset} Dispatched ${dispatched.length}/${tasksToRun.length} tasks`);

  if (readyTasks.length > tasksToRun.length) {
    console.log(`${c.dim}  ${readyTasks.length - tasksToRun.length} more ready tasks waiting (increase --max-agents)${c.reset}`);
  }

  // Show the watch hint or enter watch mode
  if (opts.watch && !opts.dryRun) {
    console.log(`\n${c.bold}👀 Watch mode active${c.reset} — polling every 5s for newly ready tasks`);
    console.log(`${c.dim}Press Ctrl-C to exit${c.reset}\n`);

    const alreadyDispatched = new Set(dispatched.map(d => d.id));
    let running = true;

    const cleanup = () => {
      running = false;
      console.log(`\n${c.dim}Watch mode stopped.${c.reset}`);
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    const poll = async () => {
      while (running) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        if (!running) break;

        const newReady = getReadyAutoTasks(opts.project, minPriority)
          .filter(t => !alreadyDispatched.has(t.id));

        const now = new Date().toLocaleTimeString();
        if (newReady.length === 0) {
          process.stdout.write(`\r${c.dim}[${now}] Watching... no new ready tasks${c.reset}  `);
          continue;
        }

        console.log(`\n${c.green}[${now}]${c.reset} ${newReady.length} new task(s) ready`);

        const currentMax = parseInt(opts.maxAgents || '3', 10);
        const batch = newReady.slice(0, currentMax - alreadyDispatched.size);

        for (const task of batch) {
          alreadyDispatched.add(task.id);
          const result = await dispatchTask(gw, task, opts);
          if (result) {
            dispatched.push(result);
          }
        }
      }
    };

    await poll();
  } else {
    console.log(`\n${c.dim}Monitor progress: trak list --status wip${c.reset}`);
    console.log(`${c.dim}When agents close tasks, blocked tasks auto-unblock.${c.reset}`);
    console.log(`${c.dim}Run 'trak run --watch' to auto-dispatch newly unblocked work.${c.reset}\n`);
  }
}
