import { getDb, Task } from '../db.js';
import { c } from '../utils.js';

export interface VerifyOptions {
  pass?: boolean;
  fail?: boolean;
  agent?: string;
  reason?: string;
}

export function verifyCommand(id: string, opts: VerifyOptions): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  if (!opts.pass && !opts.fail) {
    console.error(`${c.red}Must specify --pass or --fail${c.reset}`);
    process.exit(1);
  }

  const agent = opts.agent || 'human';
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
