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
  proof?: string;
  commit?: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Check if we're inside a git repository.
 */
function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check for git commits since the task's WIP snapshot, or recent commits
 * mentioning the task ID. Returns check result.
 */
function checkGitProof(task: Task, explicitCommit?: string): VerificationCheck {
  if (!isGitRepo()) {
    return { name: 'git-proof', passed: true, detail: 'Not a git repo — skipped' };
  }

  // If explicit commit hash provided, verify it exists
  if (explicitCommit) {
    try {
      const log = execSync(`git log --oneline -1 ${explicitCommit}`, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return { name: 'git-proof', passed: true, detail: `Commit verified: ${log}` };
    } catch {
      return { name: 'git-proof', passed: false, detail: `Commit not found: ${explicitCommit}` };
    }
  }

  // Check for commits mentioning task ID
  try {
    const mentions = execSync(`git log --oneline --all --grep="${task.id}" -5`, {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (mentions) {
      const count = mentions.split('\n').length;
      return { name: 'git-proof', passed: true, detail: `${count} commit(s) referencing ${task.id}` };
    }
  } catch {
    // git log failed — not fatal
  }

  // Check for commits since WIP snapshot
  const snapshot = task.wip_snapshot;
  if (snapshot) {
    try {
      const diffStat = execSync(`git diff --stat ${snapshot}..HEAD`, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (diffStat) {
        const lines = diffStat.split('\n');
        const summary = lines[lines.length - 1] || '';
        return { name: 'git-proof', passed: true, detail: `Changes since WIP: ${summary.trim()}` };
      }
      return { name: 'git-proof', passed: false, detail: `No changes since WIP snapshot (${snapshot.slice(0, 8)})` };
    } catch {
      // snapshot commit may not exist — fall through
    }
  }

  // No explicit proof found — check for any recent commits (last 24h)
  try {
    const recent = execSync('git log --oneline --since="24 hours ago" -5', {
      encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (recent) {
      return { name: 'git-proof', passed: true, detail: `Recent commits found (last 24h)` };
    }
  } catch {
    // fallthrough
  }

  return { name: 'git-proof', passed: false, detail: 'No git commits found as proof of work' };
}

/**
 * Check for explicit proof string (URL, file path, description).
 */
function checkExplicitProof(proof?: string): VerificationCheck | null {
  if (!proof) return null;
  // Proof is a freeform string — log it as evidence
  return { name: 'proof-artifact', passed: true, detail: `Proof: ${proof}` };
}

/**
 * Check that the task has journal entries beyond just creation.
 * A task with only a creation entry and no work logged is suspicious.
 */
function checkJournalActivity(db: ReturnType<typeof getDb>, task: Task): VerificationCheck {
  const entries = db.prepare(
    "SELECT COUNT(*) as cnt FROM task_log WHERE task_id = ? AND author != 'system'"
  ).get(task.id) as { cnt: number };

  if (entries.cnt > 0) {
    return { name: 'journal-activity', passed: true, detail: `${entries.cnt} journal entries by non-system authors` };
  }

  // Also count system entries (status changes, etc.)
  const sysEntries = db.prepare(
    "SELECT COUNT(*) as cnt FROM task_log WHERE task_id = ?"
  ).get(task.id) as { cnt: number };

  if (sysEntries.cnt >= 2) {
    return { name: 'journal-activity', passed: true, detail: `${sysEntries.cnt} total journal entries (system)` };
  }

  return { name: 'journal-activity', passed: false, detail: 'No meaningful work logged in journal' };
}

/**
 * Run verification checks for a task before closing.
 * Returns true if all checks pass, false otherwise.
 * Stores results in the task journal.
 */
function runVerificationGate(db: ReturnType<typeof getDb>, task: Task, opts?: CloseOptions): boolean {
  const checks: VerificationCheck[] = [];

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

  // 3. Git commit proof check
  const gitCheck = checkGitProof(task, opts?.commit);
  checks.push(gitCheck);

  // 4. Explicit proof artifact
  const proofCheck = checkExplicitProof(opts?.proof);
  if (proofCheck) checks.push(proofCheck);

  // 5. Journal activity check — ensure work was actually logged
  const journalCheck = checkJournalActivity(db, task);
  checks.push(journalCheck);

  // Determine pass/fail: hard checks (verify_command, build, tests) must all pass.
  // Soft checks (git-proof, journal-activity) generate warnings but don't block
  // UNLESS there are zero hard checks — then at least one soft check must pass.
  const hardChecks = checks.filter(ch =>
    ['verify_command', 'build', 'tests'].includes(ch.name)
  );
  const softChecks = checks.filter(ch =>
    !['verify_command', 'build', 'tests'].includes(ch.name)
  );

  const hardAllPassed = hardChecks.every(ch => ch.passed);
  const softAnyPassed = softChecks.some(ch => ch.passed);

  // If there are hard checks, they must all pass. If no hard checks, at least one soft must pass.
  const allPassed = hardChecks.length > 0 ? hardAllPassed : softAnyPassed;

  const lines = [
    `Verification gate ${allPassed ? 'PASSED' : 'FAILED'}`,
    ...checks.map(ch => `  ${ch.passed ? '✓' : '✗'} ${ch.name}: ${ch.detail}`),
  ];
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id, lines.join('\n')
  );

  db.prepare(`UPDATE tasks SET verification_status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(allPassed ? 'passed' : 'failed', task.id);

  for (const ch of checks) {
    const isHard = ['verify_command', 'build', 'tests'].includes(ch.name);
    const icon = ch.passed
      ? `${c.green}✓${c.reset}`
      : isHard ? `${c.red}✗${c.reset}` : `${c.yellow}⚠${c.reset}`;
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
  const hasExistingVerification = task.verification_status === 'passed';

  if (!opts?.force && !opts?.verify && !hasExistingVerification) {
    db.prepare("UPDATE tasks SET status = 'review', updated_at = datetime('now') WHERE id = ?").run(task.id);
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id, `Close blocked — no verification. Status set to review (was: ${task.status}). Use --verify to run checks or --force to bypass.`
    );
    afterWrite(db, { op: 'update', id: task.id, data: { status: 'review' } });
    console.log(`${c.yellow}⚠${c.reset}  ${c.dim}${task.id}${c.reset} ${task.title}`);
    console.log(`  ${c.yellow}Close blocked${c.reset} — verification required`);
    console.log(`  ${c.dim}Status set to ${c.bold}review${c.reset}${c.dim} (pending verification)${c.reset}`);
    console.log(`  ${c.dim}Use ${c.bold}trak close ${task.id} --verify${c.reset}${c.dim} to run checks, or ${c.bold}--force${c.reset}${c.dim} to bypass${c.reset}`);
    return;
  }

  if (opts?.verify) {
    console.log(`${c.cyan}🔒 Running verification gate for${c.reset} ${c.bold}${task.id}${c.reset}\n`);
    const passed = runVerificationGate(db, task, opts);
    if (!passed) {
      db.prepare("UPDATE tasks SET status = 'open', updated_at = datetime('now') WHERE id = ?").run(task.id);
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
        task.id, `Close rejected — verification failed. Status reverted to open.`
      );
      afterWrite(db, { op: 'update', id: task.id, data: { status: 'open' } });
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

  // Additive cost/token logging (with granular fields)
  {
    const addCost = opts?.cost ? parseFloat(opts.cost) : 0;
    const addTokens = opts?.tokens ? parseInt(opts.tokens, 10) : 0;
    const addTokensIn = opts?.tokensIn ? parseInt(opts.tokensIn, 10) : 0;
    const addTokensOut = opts?.tokensOut ? parseInt(opts.tokensOut, 10) : 0;
    const model = opts?.model || '';
    const duration = opts?.duration ? parseFloat(opts.duration) : 0;

    if (addCost > 0 || addTokens > 0 || addTokensIn > 0 || addTokensOut > 0 || model || duration > 0) {
      db.prepare(`UPDATE tasks SET
        cost_usd = cost_usd + ?,
        tokens_used = tokens_used + ?,
        tokens_in = tokens_in + ?,
        tokens_out = tokens_out + ?,
        model_used = CASE WHEN ? != '' THEN ? ELSE model_used END,
        duration_seconds = duration_seconds + ?
        WHERE id = ?`)
        .run(addCost, addTokens, addTokensIn, addTokensOut, model, model, duration, task.id);
      const parts: string[] = [];
      if (addCost > 0) parts.push(`$${addCost.toFixed(4)}`);
      if (addTokens > 0) parts.push(`${addTokens} tokens`);
      if (addTokensIn > 0 || addTokensOut > 0) parts.push(`${addTokensIn} in / ${addTokensOut} out`);
      if (model) parts.push(`model: ${model}`);
      if (duration > 0) parts.push(`${duration.toFixed(1)}s`);
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
        task.id, `Cost logged: ${parts.join(', ')}`
      );
      console.log(`${c.green}✓${c.reset} Cost: ${parts.join(', ')}`);
    }
  }

  // Always log a cost summary when closing (if task has accumulated cost data)
  {
    const updated = db.prepare('SELECT cost_usd, tokens_used, tokens_in, tokens_out, model_used, duration_seconds FROM tasks WHERE id = ?').get(task.id) as any;
    if (updated && (updated.cost_usd > 0 || updated.tokens_used > 0)) {
      const summary: string[] = [`💰 Final cost summary:`];
      summary.push(`  Total: $${updated.cost_usd.toFixed(4)}`);
      summary.push(`  Tokens: ${updated.tokens_used.toLocaleString()}`);
      if (updated.tokens_in || updated.tokens_out) {
        summary.push(`  Tokens in: ${updated.tokens_in.toLocaleString()}, out: ${updated.tokens_out.toLocaleString()}`);
      }
      if (updated.model_used) summary.push(`  Model: ${updated.model_used}`);
      if (updated.duration_seconds > 0) summary.push(`  Duration: ${updated.duration_seconds.toFixed(1)}s`);
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
        task.id, summary.join('\n')
      );
    }
  }

  afterWrite(db, {
    op: 'close',
    id: task.id,
    data: {
      status: 'done',
      verified: opts?.verify || false,
      forced: opts?.force || false
    }
  });
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
    for (const t of unblockedAutoTasks) {
      console.log(`TRAK_EVENT:UNBLOCKED:${t.id}:${t.title}`);
    }
    for (const t of unblockedAutoTasks) {
      try {
        console.log(`⚡ Auto-dispatching: ${t.id} — ${t.title}`);
        slingCommand(t.id, { json: true });
      } catch {
        console.log(`${c.dim}  (dispatch skipped for ${t.id})${c.reset}`);
      }
    }
  }
}
