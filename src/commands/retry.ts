import { getDb, Task, manualRetry, taskFailed } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, formatDate, truncate } from '../utils.js';

export interface RetryOptions {
  reset?: boolean;
  reason?: string;
  list?: boolean;
  all?: boolean;
}

/**
 * trak retry --list — show all failed/retryable tasks
 */
function retryListCommand(opts: RetryOptions): void {
  const db = getDb();

  let sql: string;
  if (opts.all) {
    // Show everything with retry history
    sql = `SELECT * FROM tasks WHERE retry_count > 0 OR status = 'failed' ORDER BY updated_at DESC`;
  } else {
    // Show only failed tasks and tasks with pending retry_after
    sql = `
      SELECT * FROM tasks
      WHERE status = 'failed'
         OR (retry_after IS NOT NULL AND status = 'open')
      ORDER BY updated_at DESC
    `;
  }

  const tasks = db.prepare(sql).all() as Task[];

  if (tasks.length === 0) {
    console.log(`${c.dim}No failed or retryable tasks${c.reset}`);
    return;
  }

  // Separate into categories
  const failed = tasks.filter(t => t.status === 'failed');
  const pendingRetry = tasks.filter(t => t.status === 'open' && t.retry_after);
  const retried = tasks.filter(t => t.status !== 'failed' && !t.retry_after && t.retry_count > 0);

  if (failed.length > 0) {
    console.log(`\n${c.red}${c.bold}💀 Permanently Failed${c.reset} (${failed.length})\n`);
    for (const t of failed) {
      const projectTag = t.project ? `${c.cyan}[${t.project}]${c.reset} ` : '';
      console.log(`  ${STATUS_EMOJI.failed} ${c.dim}${t.id}${c.reset} ${projectTag}${truncate(t.title, 45)}`);
      console.log(`    ${c.dim}Attempts: ${t.retry_count}/${t.max_retries ?? 3} | Last: ${t.last_failure_reason || 'unknown'}${c.reset}`);
      console.log(`    ${c.dim}${formatDate(t.updated_at)}${c.reset}`);
    }
  }

  if (pendingRetry.length > 0) {
    console.log(`\n${c.yellow}${c.bold}⟳ Pending Retry${c.reset} (${pendingRetry.length})\n`);
    for (const t of pendingRetry) {
      const projectTag = t.project ? `${c.cyan}[${t.project}]${c.reset} ` : '';
      const retryAfter = t.retry_after ? new Date(t.retry_after) : null;
      const now = new Date();
      const ready = retryAfter && retryAfter <= now;
      const retryStatus = ready ? `${c.green}ready now${c.reset}` : `${c.yellow}waiting until ${t.retry_after}${c.reset}`;
      console.log(`  ⟳ ${c.dim}${t.id}${c.reset} ${projectTag}${truncate(t.title, 45)}`);
      console.log(`    ${c.dim}Attempt ${t.retry_count}/${t.max_retries ?? 3}${c.reset} | ${retryStatus}`);
      if (t.last_failure_reason) {
        console.log(`    ${c.dim}Reason: ${t.last_failure_reason}${c.reset}`);
      }
    }
  }

  if (opts.all && retried.length > 0) {
    console.log(`\n${c.green}${c.bold}✓ Previously Retried${c.reset} (${retried.length})\n`);
    for (const t of retried) {
      const emoji = STATUS_EMOJI[t.status] || '?';
      const sc = statusColor(t.status);
      const projectTag = t.project ? `${c.cyan}[${t.project}]${c.reset} ` : '';
      console.log(`  ${emoji} ${c.dim}${t.id}${c.reset} ${projectTag}${sc}${truncate(t.title, 45)}${c.reset}`);
      console.log(`    ${c.dim}Retried ${t.retry_count}x | Now: ${t.status}${c.reset}`);
    }
  }

  // Summary
  const total = tasks.length;
  console.log(`\n${c.dim}Total: ${total} task(s) with retry history${c.reset}`);
  if (failed.length > 0) {
    console.log(`${c.dim}Use 'trak retry <id>' to manually re-queue a failed task${c.reset}`);
  }
}

/**
 * trak retry <id> — manually retry a failed or timed-out task
 */
export function retryCommand(idOrUndefined: string | undefined, opts?: RetryOptions): void {
  // Handle --list flag
  if (opts?.list || idOrUndefined === undefined) {
    retryListCommand(opts || {});
    return;
  }

  const id = idOrUndefined;
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  if (task.status === 'done' || task.status === 'archived') {
    console.error(`${c.yellow}Task is already ${task.status} — nothing to retry${c.reset}`);
    process.exit(1);
  }

  const resetCount = opts?.reset !== false; // default true
  const updated = manualRetry(db, task.id, resetCount);

  console.log(`${c.green}✓${c.reset} ${STATUS_EMOJI.open} ${c.dim}${updated.id}${c.reset} ${updated.title}`);
  console.log(`  Re-queued as ${c.bold}open${c.reset}${resetCount ? ' (retry count reset to 0)' : ''}`);
  if (task.retry_count > 0) {
    console.log(`  ${c.dim}Previous attempts: ${task.retry_count}${c.reset}`);
  }
  if (task.last_failure_reason) {
    console.log(`  ${c.dim}Last failure: ${task.last_failure_reason}${c.reset}`);
  }
}

/**
 * trak fail <id> --reason "..." — mark a task as failed (triggers auto-retry logic)
 */
export function failCommand(id: string, opts?: { reason?: string }): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  if (task.status === 'done' || task.status === 'archived') {
    console.error(`${c.yellow}Task is already ${task.status}${c.reset}`);
    process.exit(1);
  }

  const reason = opts?.reason || 'No reason provided';
  const result = taskFailed(db, task.id, reason);

  if (result.requeued) {
    console.log(`${c.yellow}⟳${c.reset} ${c.dim}${task.id}${c.reset} ${task.title}`);
    console.log(`  ${c.yellow}Retry ${result.retryCount}/${result.maxRetries}${c.reset} — re-queued with backoff`);
    console.log(`  ${c.dim}Reason: ${reason}${c.reset}`);
  } else {
    console.log(`${c.red}${STATUS_EMOJI.failed}${c.reset} ${c.dim}${task.id}${c.reset} ${task.title}`);
    console.log(`  ${c.red}Permanently failed${c.reset} after ${result.retryCount} attempts`);
    console.log(`  ${c.dim}Reason: ${reason}${c.reset}`);
  }
}
