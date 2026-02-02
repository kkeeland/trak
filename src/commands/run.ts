import { getDb, Task, afterWrite, resolveTimeout } from '../db.js';
import { c } from '../utils.js';
import {
  discoverGateway,
  probeGateway,
  type GatewayConfig,
} from '../gateway.js';
import {
  dispatchTask,
  dispatchBatch,
  type DispatchResult,
  type DispatchOptions,
} from '../dispatch.js';

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
  // Default: only dispatch P0-P1 tasks (priority 0-1)
  const maxPrio = minPriority ?? 1;
  sql += ' AND t.priority <= ?';
  params.push(maxPrio);
  sql += ' ORDER BY t.priority ASC, t.created_at ASC';
  return db.prepare(sql).all(...params) as ReadyTask[];
}

function getConvoyName(convoyId: string | null): string {
  if (!convoyId) return '';
  const db = getDb();
  const convoy = db.prepare('SELECT name FROM convoys WHERE id = ?').get(convoyId) as { name: string } | undefined;
  return convoy?.name || convoyId;
}

export async function runCommand(opts: RunOptions): Promise<void> {
  const maxAgents = parseInt(opts.maxAgents || '3', 10);
  const minPriority = opts.minPriority !== undefined ? parseInt(opts.minPriority, 10) : undefined;
  const readyTasks = getReadyAutoTasks(opts.project, minPriority);

  if (readyTasks.length === 0) {
    console.log(`${c.dim}No ready auto tasks to run.${c.reset}`);
    return;
  }

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
      const timeoutSec = resolveTimeout({ cliTimeout: opts.timeout, task: task as any });
      console.log(`  ${c.yellow}[dry-run]${c.reset} Would dispatch: ${c.bold}${task.id}${c.reset} — ${task.title}`);
      console.log(`    ${c.dim}Label: ${label} | Timeout: ${timeoutSec}s | Cleanup: delete${c.reset}`);
    }

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

  // Dispatch each task via native dispatch
  const dispatchOpts: DispatchOptions = {
    model: opts.model,
    timeout: opts.timeout,
  };

  const results = await dispatchBatch(tasksToRun as any[], dispatchOpts);
  const dispatched = results.filter(r => r.ok);

  console.log(`\n${c.dim}${'─'.repeat(50)}${c.reset}`);
  console.log(`\n${c.green}✓${c.reset} Dispatched ${dispatched.length}/${tasksToRun.length} tasks`);

  if (readyTasks.length > tasksToRun.length) {
    console.log(`${c.dim}  ${readyTasks.length - tasksToRun.length} more ready tasks waiting (increase --max-agents)${c.reset}`);
  }

  // Watch mode
  if (opts.watch && !opts.dryRun) {
    console.log(`\n${c.bold}👀 Watch mode active${c.reset} — polling every 5s for newly ready tasks`);
    console.log(`${c.dim}Press Ctrl-C to exit${c.reset}\n`);

    const alreadyDispatched = new Set(dispatched.map(d => d.taskId));
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
          const result = await dispatchTask(task as any, dispatchOpts, gw);
          if (result.ok) {
            dispatched.push(result);
          }
        }
      }
    };

    await poll();
  } else {
    console.log(`\n${c.dim}Monitor progress: trak list --status wip${c.reset}`);
    console.log(`${c.dim}When agents close tasks, blocked tasks auto-unblock and dispatch.${c.reset}`);
    console.log(`${c.dim}Run 'trak run --watch' to auto-dispatch newly unblocked work.${c.reset}\n`);
  }
}
