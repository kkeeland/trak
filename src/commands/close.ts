import { execSync } from 'child_process';
import { getDb, Task, afterWrite } from '../db.js';
import { c, STATUS_EMOJI } from '../utils.js';
import { slingCommand } from './sling.js';
import { hookTaskClosed } from '../hooks.js';

export interface CloseOptions {
  cost?: string;
  tokens?: string;
  tokensIn?: string;
  tokensOut?: string;
  model?: string;
  duration?: string;
  verify?: boolean;
  force?: boolean;
}

/**
 * Run verification checks for a task before closing.
 * Returns true if all checks pass, false otherwise.
 * Stores results in the task journal.
 */
function runVerificationGate(db: ReturnType<typeof getDb>, task: Task): boolean {
  const checks: { name: string; passed: boolean; detail: string }[] = [];

  // 1. Run verify_command if configured on the task
  const verifyCmd = task.verify_command;
  if (verifyCmd) {
    try {
      const output = execSync(verifyCmd, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 300000,
      });
      checks.push({ name: 'verify_command', passed: true, detail: `Command: ${verifyCmd} — exit 0` });
    } catch (err: any) {
      const exitCode = err.status ?? 1;
      const stderr = (err.stderr || err.stdout || '').trim().slice(0, 500);
      checks.push({ name: 'verify_command', passed: false, detail: `Command: ${verifyCmd} — exit ${exitCode}\n${stderr}` });
    }
  }

  // 2. Check if build passes (look for common build commands)
  // Only if we're in a directory with package.json
  try {
    const pkg = execSync('cat package.json 2>/dev/null', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const parsed = JSON.parse(pkg);
    if (parsed.scripts?.build) {
      try {
        execSync('npm run build', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
        checks.push({ name: 'build', passed: true, detail: 'npm run build — exit 0' });
      } catch (err: any) {
        checks.push({ name: 'build', passed: false, detail: `npm run build — exit ${err.status ?? 1}` });
      }
    }
    if (parsed.scripts?.test) {
      try {
        execSync('npm test', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
        checks.push({ name: 'tests', passed: true, detail: 'npm test — exit 0' });
      } catch (err: any) {
        checks.push({ name: 'tests', passed: false, detail: `npm test — exit ${err.status ?? 1}` });
      }
    }
  } catch {
    // No package.json or not parseable — skip build/test checks
  }

  // 3. If no checks ran at all, that's a soft pass (nothing to verify)
  if (checks.length === 0) {
    checks.push({ name: 'no-checks', passed: true, detail: 'No verification checks configured or detected' });
  }

  const allPassed = checks.every(ch => ch.passed);

  // Log results to journal
  const lines = [
    `Verification gate ${allPassed ? 'PASSED' : 'FAILED'}`,
    ...checks.map(ch => `  ${ch.passed ? '✓' : '✗'} ${ch.name}: ${ch.detail}`),
  ];
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id, lines.join('\n')
  );

  // Update verification status
  db.prepare(`UPDATE tasks SET verification_status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(allPassed ? 'passed' : 'failed', task.id);

  // Print results
  for (const ch of checks) {
    const icon = ch.passed ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    console.log(`  ${icon} ${ch.name}: ${ch.detail.split('\n')[0]}`);
  }

  return allPassed;
}

export function closeCommand(id: string, opts?: CloseOptions): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  if (task.status === 'done') {
    console.log(`${c.yellow}Already done${c.reset}`);
    return;
  }

  // ── Verification gate ──────────────────────────────────
  // Without --verify or --force, task goes to review (pending-review) instead of done.
  // Agents can't self-close without proof.
  const hasExistingVerification = task.verification_status === 'passed';

  if (!opts?.force && !opts?.verify && !hasExistingVerification) {
    // Block close — move to review instead
    db.prepare("UPDATE tasks SET status = 'review', updated_at = datetime('now') WHERE id = ?").run(task.id);
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id, `Close blocked — no verification. Status set to review (was: ${task.status}). Use --verify to run checks or --force to bypass.`
    );
    afterWrite(db);
    console.log(`${c.yellow}⚠${c.reset}  ${c.dim}${task.id}${c.reset} ${task.title}`);
    console.log(`  ${c.yellow}Close blocked${c.reset} — verification required`);
    console.log(`  ${c.dim}Status set to ${c.bold}review${c.reset}${c.dim} (pending verification)${c.reset}`);
    console.log(`  ${c.dim}Use ${c.bold}trak close ${task.id} --verify${c.reset}${c.dim} to run checks, or ${c.bold}--force${c.reset}${c.dim} to bypass${c.reset}`);
    return;
  }

  // If --verify flag, run verification checks now
  if (opts?.verify) {
    console.log(`${c.cyan}🔒 Running verification gate for${c.reset} ${c.bold}${task.id}${c.reset}\n`);
    const passed = runVerificationGate(db, task);
    if (!passed) {
      db.prepare("UPDATE tasks SET status = 'open', updated_at = datetime('now') WHERE id = ?").run(task.id);
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
        task.id, `Close rejected — verification failed. Status reverted to open.`
      );
      afterWrite(db);
      console.log(`\n${c.red}✗ Close rejected${c.reset} — verification failed`);
      console.log(`  ${c.dim}Status reverted to ${c.bold}open${c.reset}`);
      return;
    }
    console.log('');
  }

  // ── Proceed with close ──────────────────────────────────
  db.prepare("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?").run(task.id);
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id, `Closed (was: ${task.status})${opts?.verify ? ' [verified]' : opts?.force ? ' [force]' : ' [pre-verified]'}`
  );

  // Additive cost/token logging
  if (opts?.cost || opts?.tokens) {
    const addCost = opts.cost ? parseFloat(opts.cost) : 0;
    const addTokens = opts.tokens ? parseInt(opts.tokens, 10) : 0;
    if (addCost > 0 || addTokens > 0) {
      db.prepare('UPDATE tasks SET cost_usd = cost_usd + ?, tokens_used = tokens_used + ? WHERE id = ?')
        .run(addCost, addTokens, task.id);
      const parts: string[] = [];
      if (addCost > 0) parts.push(`$${addCost.toFixed(4)}`);
      if (addTokens > 0) parts.push(`${addTokens} tokens`);
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
        task.id, `Cost logged: ${parts.join(', ')}`
      );
      console.log(`${c.green}✓${c.reset} Cost: ${parts.join(', ')}`);
    }
  }

  afterWrite(db);
  hookTaskClosed(task);

  console.log(`${c.green}✓${c.reset} ${STATUS_EMOJI.done} ${c.dim}${task.id}${c.reset} ${task.title}`);

  // Event chain: find tasks that were blocked by this task and are now fully unblocked
  const unblockedAutoTasks = db.prepare(`
    SELECT t.* FROM tasks t
    JOIN dependencies d ON d.child_id = t.id AND d.parent_id = ?
    WHERE t.status IN ('open', 'wip', 'blocked')
    AND t.autonomy = 'auto'
    AND t.blocked_by = ''
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d2
      JOIN tasks dep ON dep.id = d2.parent_id
      WHERE d2.child_id = t.id
      AND dep.status NOT IN ('done', 'archived')
    )
  `).all(task.id) as Task[];

  if (unblockedAutoTasks.length > 0) {
    const items = unblockedAutoTasks.map(t => `${t.id} (${t.title})`).join(', ');
    console.log(`⚡ Unblocked auto tasks: ${items}`);
    // Emit machine-readable event for orchestrators
    for (const t of unblockedAutoTasks) {
      console.log(`TRAK_EVENT:UNBLOCKED:${t.id}:${t.title}`);
    }
    // Auto-dispatch: sling each unblocked auto task immediately
    for (const t of unblockedAutoTasks) {
      try {
        console.log(`⚡ Auto-dispatching: ${t.id} — ${t.title}`);
        slingCommand(t.id, { json: true });
      } catch {
        // slingCommand calls process.exit on failure — catch to continue chain
        console.log(`${c.dim}  (dispatch skipped for ${t.id})${c.reset}`);
      }
    }
  }
}
