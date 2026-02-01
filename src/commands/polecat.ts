import { getDb, Task, afterWrite } from '../db.js';
import { c, STATUS_EMOJI } from '../utils.js';
import { execSync } from 'child_process';

export interface PolecatOptions {
  timeout?: string;
  model?: string;
  dryRun?: boolean;
}

/**
 * Polecat — the ephemeral worker agent pattern.
 *
 * `trak sling` = "give this to someone" (dispatcher)
 * `trak polecat` = "I AM the someone, doing the work" (worker)
 *
 * A polecat reads a task, executes its work instruction, logs progress,
 * and either closes the task (success) or resets it (failure). Then it dies.
 */
export async function polecatCommand(taskId: string, opts: PolecatOptions): Promise<void> {
  const timeoutSec = parseInt(opts.timeout || '300', 10);
  const startTime = Date.now();

  // Self-destruct timer
  const timer = setTimeout(() => {
    console.error(`\n${c.red}✗ TIMEOUT${c.reset} — polecat killed after ${timeoutSec}s`);
    logToTask(taskId, `Polecat timed out after ${timeoutSec}s`);
    resetTask(taskId);
    process.exit(2);
  }, timeoutSec * 1000);

  // Clean exit on signals
  const cleanup = () => {
    clearTimeout(timer);
    console.error(`\n${c.yellow}⚠ INTERRUPTED${c.reset} — polecat caught signal`);
    logToTask(taskId, 'Polecat interrupted by signal');
    resetTask(taskId);
    process.exit(130);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const db = getDb();

  // --- Resolve task ---
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(taskId, `%${taskId}%`) as Task | undefined;

  if (!task) {
    clearTimeout(timer);
    console.error(`${c.red}✗ Task not found: ${taskId}${c.reset}`);
    process.exit(1);
  }

  if (task.status === 'done') {
    clearTimeout(timer);
    console.log(`${c.yellow}⚠${c.reset} Task already done: ${task.id}`);
    process.exit(0);
  }

  // --- Announce ---
  console.log(`\n${c.bold}🐾 polecat${c.reset} — ephemeral worker agent`);
  console.log(`${c.dim}${'─'.repeat(50)}${c.reset}`);
  console.log(`  ${c.bold}Task:${c.reset}    ${task.id} — ${task.title}`);
  console.log(`  ${c.bold}Project:${c.reset} ${task.project || '(none)'}`);
  console.log(`  ${c.bold}Status:${c.reset}  ${task.status}`);
  console.log(`  ${c.bold}Timeout:${c.reset} ${timeoutSec}s`);
  if (task.description) {
    console.log(`  ${c.bold}Details:${c.reset} ${task.description}`);
  }
  console.log(`${c.dim}${'─'.repeat(50)}${c.reset}\n`);

  // --- Claim task as WIP ---
  if (task.status !== 'wip') {
    db.prepare("UPDATE tasks SET status = 'wip', assigned_to = 'polecat', updated_at = datetime('now') WHERE id = ?").run(task.id);
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'polecat')").run(
      task.id, 'Polecat agent started'
    );
    afterWrite(db);
  }

  // --- Build work instruction ---
  const instruction = buildInstruction(task);

  if (opts.dryRun) {
    clearTimeout(timer);
    console.log(`${c.yellow}[dry-run]${c.reset} Would execute:\n`);
    console.log(instruction);
    console.log(`\n${c.dim}No work performed.${c.reset}`);
    return;
  }

  // --- Execute work ---
  let success = false;
  let errorMsg = '';

  try {
    logToTask(task.id, 'Polecat executing work instruction');

    // The polecat spawns a sub-process that runs the task via clawdbot or a shell.
    // Strategy: try clawdbot session spawn (synchronous wait), fall back to shell exec.
    success = await executeWork(task, instruction, opts);

    if (success) {
      logToTask(task.id, 'Polecat work completed successfully');
    }
  } catch (err: any) {
    errorMsg = err.message || String(err);
    logToTask(task.id, `Polecat error: ${errorMsg}`);
  }

  clearTimeout(timer);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // --- Report ---
  console.log(`\n${c.dim}${'─'.repeat(50)}${c.reset}`);
  console.log(`${c.bold}🐾 polecat summary${c.reset}`);
  console.log(`  ${c.bold}Task:${c.reset}    ${task.id} — ${task.title}`);
  console.log(`  ${c.bold}Elapsed:${c.reset} ${elapsed}s`);

  if (success) {
    // Close the task — this triggers auto-dispatch of unblocked tasks
    try {
      execSync(`trak close ${task.id}`, {
        encoding: 'utf-8',
        stdio: 'inherit',
        timeout: 30000,
      });
      console.log(`  ${c.bold}Result:${c.reset}  ${c.green}✓ SUCCESS${c.reset}`);
    } catch {
      console.log(`  ${c.bold}Result:${c.reset}  ${c.yellow}⚠ Work done but close failed${c.reset}`);
      process.exit(1);
    }
  } else {
    // Reset to open so another agent can pick it up
    resetTask(task.id);
    console.log(`  ${c.bold}Result:${c.reset}  ${c.red}✗ FAILED${c.reset}`);
    if (errorMsg) {
      console.log(`  ${c.bold}Error:${c.reset}  ${errorMsg}`);
    }
    process.exit(1);
  }

  // Cost summary if tracked
  const updatedTask = db.prepare('SELECT cost_usd, tokens_used FROM tasks WHERE id = ?').get(task.id) as { cost_usd: number; tokens_used: number } | undefined;
  if (updatedTask && (updatedTask.cost_usd > 0 || updatedTask.tokens_used > 0)) {
    const parts: string[] = [];
    if (updatedTask.cost_usd > 0) parts.push(`$${updatedTask.cost_usd.toFixed(4)}`);
    if (updatedTask.tokens_used > 0) parts.push(`${updatedTask.tokens_used} tokens`);
    console.log(`  ${c.bold}Cost:${c.reset}    ${parts.join(', ')}`);
  }

  console.log('');
}

function buildInstruction(task: Task): string {
  const cwd = process.cwd();
  return `You are a polecat — an ephemeral worker agent. Do the task, report, die.

## Task: ${task.title} (${task.id})
${task.description ? `\n**Details:** ${task.description}\n` : ''}
**Project:** ${task.project || 'default'}
**Working directory:** ${cwd}

## Rules
1. Do the work described above
2. Log progress: \`trak log ${task.id} "what you did"\`
3. When done, exit cleanly (the polecat will close the task)
4. Do NOT work on anything else
5. Do NOT spawn sub-agents
6. If stuck, exit non-zero with an error message`;
}

async function executeWork(task: Task, instruction: string, opts: PolecatOptions): Promise<boolean> {
  // Strategy 1: Try clawdbot session spawn (blocking)
  try {
    execSync('which clawdbot', { stdio: 'ignore' });

    const fs = await import('fs');
    const tmpFile = `/tmp/polecat-${task.id}.json`;
    const payload = JSON.stringify({
      task: instruction,
      label: `polecat-${task.id}`,
      cleanup: 'delete',
      runTimeoutSeconds: parseInt(opts.timeout || '300', 10),
      model: opts.model,
    });
    fs.writeFileSync(tmpFile, payload);

    console.log(`${c.dim}Spawning via clawdbot...${c.reset}`);
    const result = execSync(
      `clawdbot session spawn --label "polecat-${task.id}" --task-file "${tmpFile}" --cleanup delete --timeout ${opts.timeout || '300'} 2>&1`,
      {
        encoding: 'utf-8',
        timeout: (parseInt(opts.timeout || '300', 10) + 30) * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    console.log(result);
    return true;
  } catch (clawdbotErr: any) {
    // If clawdbot isn't available, that's fine — try other strategies
    if (clawdbotErr.status === 127 || clawdbotErr.message?.includes('not found')) {
      // clawdbot not installed — fall through
    } else if (clawdbotErr.status) {
      // clawdbot ran but the agent failed
      console.error(`${c.red}Agent exited with code ${clawdbotErr.status}${c.reset}`);
      if (clawdbotErr.stdout) console.log(clawdbotErr.stdout);
      if (clawdbotErr.stderr) console.error(clawdbotErr.stderr);
      return false;
    }
  }

  // Strategy 2: Output the instruction for an external orchestrator to pick up
  // This is the "headless" mode — polecat prints its instruction and trusts
  // the calling process to execute it (e.g., piped into claude --print)
  console.log(`${c.yellow}⚠${c.reset} No agent runtime found (clawdbot not available)`);
  console.log(`${c.dim}Outputting work instruction for external execution:${c.reset}\n`);
  console.log(`POLECAT_INSTRUCTION:${task.id}:BEGIN`);
  console.log(instruction);
  console.log(`POLECAT_INSTRUCTION:${task.id}:END`);
  console.log(`\n${c.dim}Pipe to an agent: trak polecat ${task.id} 2>/dev/null | claude --print${c.reset}`);

  // In headless mode, we consider the work "not done" — the external orchestrator
  // should call `trak close` when finished
  return false;
}

function logToTask(taskId: string, entry: string): void {
  try {
    const db = getDb();
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'polecat')").run(taskId, entry);
    afterWrite(db);
  } catch {
    // Best-effort logging — don't crash the polecat
  }
}

function resetTask(taskId: string): void {
  try {
    const db = getDb();
    db.prepare("UPDATE tasks SET status = 'open', assigned_to = '', updated_at = datetime('now') WHERE id = ?").run(taskId);
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'polecat')").run(
      taskId, 'Polecat failed — task reset to open'
    );
    afterWrite(db);
  } catch {
    // Best-effort
  }
}
