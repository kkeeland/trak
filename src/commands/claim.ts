import { getDb, Task, TaskClaim } from '../db.js';
import { c } from '../utils.js';

export interface ClaimOptions {
  agent?: string;
  model?: string;
  release?: boolean;
}

export function claimCommand(id: string, opts: ClaimOptions): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  if (opts.release) {
    const active = db.prepare(
      "SELECT * FROM task_claims WHERE task_id = ? AND status = 'claimed' ORDER BY claimed_at DESC LIMIT 1"
    ).get(task.id) as TaskClaim | undefined;

    if (!active) {
      console.error(`${c.yellow}No active claim on ${task.id}${c.reset}`);
      process.exit(1);
    }

    db.prepare(
      "UPDATE task_claims SET status = 'released', released_at = datetime('now') WHERE id = ?"
    ).run(active.id);

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id,
      `Claim released by ${active.agent}`
    );

    console.log(`${c.green}✓${c.reset} ${c.dim}${task.id}${c.reset} claim released (was: ${c.bold}${active.agent}${c.reset})`);
    return;
  }

  if (!opts.agent) {
    console.error(`${c.red}Must specify --agent <name>${c.reset}`);
    process.exit(1);
  }

  const existing = db.prepare(
    "SELECT * FROM task_claims WHERE task_id = ? AND status = 'claimed'"
  ).get(task.id) as TaskClaim | undefined;

  if (existing) {
    if (existing.agent === opts.agent) {
      console.log(`${c.yellow}⚠${c.reset} ${c.dim}${task.id}${c.reset} already claimed by ${c.bold}${opts.agent}${c.reset}`);
      return;
    }
    console.log(`${c.yellow}⚠${c.reset} ${c.dim}${task.id}${c.reset} already claimed by ${c.bold}${existing.agent}${c.reset} — overriding`);
    db.prepare(
      "UPDATE task_claims SET status = 'released', released_at = datetime('now') WHERE id = ?"
    ).run(existing.id);
  }

  db.prepare(
    "INSERT INTO task_claims (task_id, agent, model) VALUES (?, ?, ?)"
  ).run(task.id, opts.agent, opts.model || '');

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id,
    `Claimed by ${opts.agent}${opts.model ? ` (model: ${opts.model})` : ''}`
  );

  console.log(`${c.green}✓${c.reset} ${c.dim}${task.id}${c.reset} claimed by ${c.bold}${opts.agent}${c.reset}${opts.model ? ` ${c.dim}(${opts.model})${c.reset}` : ''}`);
}
