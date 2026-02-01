import { execSync } from 'child_process';
import { getDb, Task, resolveTimeout } from '../db.js';
import { c } from '../utils.js';

export interface VerifyOptions {
  pass?: boolean;
  fail?: boolean;
  agent?: string;
  reason?: string;
  run?: string;
  diff?: boolean;
  checklist?: string;
  auto?: boolean;
}

function findTask(db: ReturnType<typeof getDb>, id: string): Task {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }
  return task;
}

function truncOutput(s: string, max: number = 1000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n... (truncated)';
}

function getGitHead(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function runVerifyCommand(db: ReturnType<typeof getDb>, task: Task, command: string, agent: string): boolean {
  console.log(`${c.cyan}▶${c.reset} Running: ${c.bold}${command}${c.reset}`);
  const startTime = Date.now();
  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    stdout = execSync(command, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: resolveTimeout({}) * 1000, // configurable timeout (default 15min)
    });
    exitCode = 0;
  } catch (err: any) {
    exitCode = err.status ?? 1;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }

  const durationMs = Date.now() - startTime;
  const durationStr = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
  const passed = exitCode === 0;

  const output = truncOutput(passed ? stdout : (stderr || stdout));

  // Log to journal
  const logEntry = [
    `Verification ${passed ? 'PASSED' : 'FAILED'} via command`,
    `Command: ${command}`,
    `Exit code: ${exitCode}`,
    `Duration: ${durationStr}`,
    `Output:\n${output}`,
  ].join('\n');

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)").run(task.id, logEntry, agent);

  // Update verification status
  if (passed) {
    db.prepare(`UPDATE tasks SET verification_status = 'passed', verified_by = ?, updated_at = datetime('now') WHERE id = ?`).run(agent, task.id);
    console.log(`${c.green}✓ PASSED${c.reset} (exit 0, ${durationStr})`);
    if (stdout.trim()) {
      const lines = stdout.trim().split('\n');
      const preview = lines.slice(-5).join('\n');
      console.log(`${c.dim}${preview}${c.reset}`);
    }
  } else {
    db.prepare(`UPDATE tasks SET verification_status = 'failed', verified_by = ?, status = 'open', updated_at = datetime('now') WHERE id = ?`).run(agent, task.id);
    console.log(`${c.red}✗ FAILED${c.reset} (exit ${exitCode}, ${durationStr})`);
    const errOutput = (stderr || stdout).trim();
    if (errOutput) {
      const lines = errOutput.split('\n');
      const preview = lines.slice(-10).join('\n');
      console.log(`${c.red}${preview}${c.reset}`);
    }
    console.log(`  ${c.dim}status reverted to${c.reset} ${c.bold}open${c.reset}`);
  }

  return passed;
}

function showDiff(db: ReturnType<typeof getDb>, task: Task): void {
  if (!isGitRepo()) {
    console.error(`${c.red}Not in a git repository${c.reset}`);
    return;
  }

  const snapshot = (task as any).wip_snapshot;
  if (!snapshot) {
    console.error(`${c.yellow}No WIP snapshot recorded for this task${c.reset}`);
    console.error(`${c.dim}Set status to wip first: trak status ${task.id} wip${c.reset}`);
    return;
  }

  const head = getGitHead();
  console.log(`${c.cyan}📋 Diff since WIP started${c.reset}`);
  console.log(`${c.dim}Snapshot: ${snapshot.slice(0, 8)}  →  HEAD: ${(head || 'unknown').slice(0, 8)}${c.reset}\n`);

  try {
    const diffStat = execSync(`git diff --stat ${snapshot}..HEAD`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (diffStat.trim()) {
      console.log(diffStat);
    } else {
      console.log(`${c.dim}No changes since WIP snapshot${c.reset}`);
    }

    const diff = execSync(`git diff ${snapshot}..HEAD`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    // Log summary to journal
    const logEntry = [
      `Diff review: ${snapshot.slice(0, 8)}..${(head || 'HEAD').slice(0, 8)}`,
      `Summary:\n${truncOutput(diffStat)}`,
    ].join('\n');
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(task.id, logEntry);
  } catch (err: any) {
    console.error(`${c.red}Git diff failed: ${err.message}${c.reset}`);
  }
}

function runChecklist(db: ReturnType<typeof getDb>, task: Task, items: string, agent: string): void {
  const checkItems = items.split(',').map(s => s.trim()).filter(Boolean);
  if (checkItems.length === 0) {
    console.error(`${c.red}No checklist items provided${c.reset}`);
    return;
  }

  console.log(`${c.cyan}📝 Verification Checklist${c.reset} (${checkItems.length} items)\n`);

  const logLines: string[] = ['Verification checklist:'];

  for (const item of checkItems) {
    console.log(`  ${c.green}☑${c.reset} ${item}`);
    logLines.push(`  ☑ ${item}`);
  }

  logLines.push(`\nAll ${checkItems.length} items checked by ${agent}`);

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)").run(
    task.id,
    logLines.join('\n'),
    agent
  );

  console.log(`\n${c.green}✓${c.reset} All ${checkItems.length} items logged to journal`);
}

export function verifyCommand(id: string, opts: VerifyOptions): void {
  const db = getDb();
  const task = findTask(db, id);
  const agent = opts.agent || 'human';

  // --run: execute a command as verification
  if (opts.run) {
    runVerifyCommand(db, task, opts.run, agent);
    return;
  }

  // --diff: show git diff since WIP
  if (opts.diff) {
    showDiff(db, task);
    return;
  }

  // --checklist: log verification criteria
  if (opts.checklist) {
    runChecklist(db, task, opts.checklist, agent);
    return;
  }

  // --auto: run all configured verifications
  if (opts.auto) {
    console.log(`${c.cyan}🔄 Auto-verification for${c.reset} ${c.bold}${task.id}${c.reset} — ${task.title}\n`);
    let ranSomething = false;

    // Run verify_command if set
    const verifyCmd = (task as any).verify_command;
    if (verifyCmd) {
      ranSomething = true;
      const passed = runVerifyCommand(db, task, verifyCmd, agent);
      if (!passed) {
        console.log(`\n${c.red}Auto-verification stopped: command failed${c.reset}`);
        return;
      }
      console.log('');
    }

    // Show diff if in git repo and has snapshot
    if (isGitRepo() && (task as any).wip_snapshot) {
      ranSomething = true;
      showDiff(db, task);
      console.log('');
    }

    if (!ranSomething) {
      console.log(`${c.yellow}Nothing to auto-verify.${c.reset}`);
      console.log(`${c.dim}Set a verify_command on the task, or set status to wip for diff tracking.${c.reset}`);
    } else {
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)").run(
        task.id,
        'Auto-verification completed',
        agent
      );
      console.log(`${c.green}✓${c.reset} Auto-verification complete`);
    }
    return;
  }

  // Legacy: --pass / --fail
  if (!opts.pass && !opts.fail) {
    console.error(`${c.red}Specify a verification mode: --run, --diff, --checklist, --auto, --pass, or --fail${c.reset}`);
    process.exit(1);
  }

  const reason = opts.reason || (opts.pass ? 'Verification passed' : 'Verification failed');

  if (opts.pass) {
    db.prepare(`
      UPDATE tasks SET verification_status = 'passed', verified_by = ?, updated_at = datetime('now') WHERE id = ?
    `).run(agent, task.id);

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)").run(
      task.id,
      `Verification PASSED: ${reason}`,
      agent
    );

    console.log(`${c.green}✓${c.reset} ${c.dim}${task.id}${c.reset} verification ${c.green}PASSED${c.reset} by ${c.bold}${agent}${c.reset}`);
    if (opts.reason) console.log(`  ${c.dim}reason:${c.reset} ${reason}`);
  } else {
    db.prepare(`
      UPDATE tasks SET verification_status = 'failed', verified_by = ?, status = 'open', updated_at = datetime('now') WHERE id = ?
    `).run(agent, task.id);

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)").run(
      task.id,
      `Verification FAILED: ${reason}`,
      agent
    );

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id,
      `Status reverted to open after failed verification`
    );

    console.log(`${c.red}✗${c.reset} ${c.dim}${task.id}${c.reset} verification ${c.red}FAILED${c.reset} by ${c.bold}${agent}${c.reset}`);
    console.log(`  ${c.dim}reason:${c.reset} ${reason}`);
    console.log(`  ${c.dim}status reverted to${c.reset} ${c.bold}open${c.reset}`);
  }
}
