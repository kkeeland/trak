import { getDb, Task, afterWrite } from '../db.js';
import { c } from '../utils.js';
import { execSync, spawn } from 'child_process';

export interface RunOptions {
  project?: string;
  dryRun?: boolean;
  maxAgents?: string;
  model?: string;
  watch?: boolean;
}

interface ReadyTask {
  id: string;
  title: string;
  description: string;
  project: string;
  priority: number;
  tags: string;
  convoy: string | null;
}

function getReadyAutoTasks(project?: string): ReadyTask[] {
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

export async function runCommand(opts: RunOptions): Promise<void> {
  const maxAgents = parseInt(opts.maxAgents || '3', 10);
  const readyTasks = getReadyAutoTasks(opts.project);

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

  console.log(`\n${c.dim}${'─'.repeat(50)}${c.reset}\n`);

  if (opts.dryRun) {
    for (const task of tasksToRun) {
      console.log(`  ${c.yellow}[dry-run]${c.reset} Would dispatch: ${c.bold}${task.id}${c.reset} — ${task.title}`);
    }
    console.log(`\n${c.dim}No agents spawned (dry run)${c.reset}`);
    return;
  }

  // Dispatch each task
  const dispatched: { id: string; title: string; label: string }[] = [];

  for (const task of tasksToRun) {
    // Claim the task
    claimTask(task.id);

    const agentTask = buildAgentTask(task);
    const label = `trak-${task.id}`;

    try {
      // Use clawdbot gateway API to spawn sub-agent
      // This calls the Clawdbot sessions_spawn equivalent via CLI
      const payload = JSON.stringify({
        task: agentTask,
        label,
        cleanup: 'delete',
        runTimeoutSeconds: 300,
      });

      // Write payload to temp file to avoid shell escaping issues
      const tmpFile = `/tmp/trak-run-${task.id}.json`;
      const fs = await import('fs');
      fs.writeFileSync(tmpFile, payload);

      // Use the clawdbot CLI to spawn if available, otherwise output instructions
      try {
        execSync('which clawdbot', { stdio: 'ignore' });
        // Spawn via clawdbot gateway
        const result = execSync(
          `clawdbot session spawn --label "${label}" --task-file "${tmpFile}" --cleanup delete --timeout 300 2>&1`,
          { encoding: 'utf-8', timeout: 10000 }
        ).trim();
        console.log(`  ${c.green}✓${c.reset} Spawned agent for ${c.bold}${task.id}${c.reset} — ${task.title}`);
        console.log(`    ${c.dim}Label: ${label}${c.reset}`);
        dispatched.push({ id: task.id, title: task.title, label });
      } catch {
        // Clawdbot not available or spawn failed — output the task for manual dispatch
        console.log(`  ${c.yellow}⚠${c.reset} Claimed ${c.bold}${task.id}${c.reset} — ${task.title}`);
        console.log(`    ${c.dim}Agent spawn not available. Run manually or pipe to orchestrator.${c.reset}`);
        // Output machine-readable dispatch event
        console.log(`TRAK_DISPATCH:${task.id}:${label}:${tmpFile}`);
        dispatched.push({ id: task.id, title: task.title, label });
      }
    } catch (err: any) {
      console.error(`  ${c.red}✗${c.reset} Failed to dispatch ${task.id}: ${err.message}`);
    }
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

        const newReady = getReadyAutoTasks(opts.project)
          .filter(t => !alreadyDispatched.has(t.id));

        const now = new Date().toLocaleTimeString();
        if (newReady.length === 0) {
          process.stdout.write(`\r${c.dim}[${now}] Watching... no new ready tasks${c.reset}  `);
          continue;
        }

        console.log(`\n${c.green}[${now}]${c.reset} ${newReady.length} new task(s) ready`);

        const maxAgents = parseInt(opts.maxAgents || '3', 10);
        const batch = newReady.slice(0, maxAgents - alreadyDispatched.size);

        for (const task of batch) {
          claimTask(task.id);
          alreadyDispatched.add(task.id);

          const agentTask = buildAgentTask(task);
          const label = `trak-${task.id}`;

          try {
            const fs = await import('fs');
            const tmpFile = `/tmp/trak-run-${task.id}.json`;
            fs.writeFileSync(tmpFile, JSON.stringify({
              task: agentTask, label, cleanup: 'delete', runTimeoutSeconds: 300,
            }));

            try {
              execSync('which clawdbot', { stdio: 'ignore' });
              execSync(
                `clawdbot session spawn --label "${label}" --task-file "${tmpFile}" --cleanup delete --timeout 300 2>&1`,
                { encoding: 'utf-8', timeout: 10000 }
              );
              console.log(`  ${c.green}✓${c.reset} Spawned agent for ${c.bold}${task.id}${c.reset} — ${task.title}`);
            } catch {
              console.log(`  ${c.yellow}⚠${c.reset} Claimed ${c.bold}${task.id}${c.reset} — ${task.title}`);
              console.log(`TRAK_DISPATCH:${task.id}:${label}:${tmpFile}`);
            }
          } catch (err: any) {
            console.error(`  ${c.red}✗${c.reset} Failed to dispatch ${task.id}: ${err.message}`);
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
