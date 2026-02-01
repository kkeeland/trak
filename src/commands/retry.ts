import { getDb, Task, manualRetry, taskFailed } from '../db.js';
import { c, STATUS_EMOJI } from '../utils.js';

export interface RetryOptions {
  reset?: boolean;
  reason?: string;
}

/**
 * trak retry <id> — manually retry a failed or timed-out task
 */
export function retryCommand(id: string, opts?: RetryOptions): void {
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
