import { getDb, Task, afterWrite } from '../db.js';
import { c, STATUS_EMOJI } from '../utils.js';

export interface CloseOptions {
  cost?: string;
  tokens?: string;
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

  db.prepare("UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE id = ?").run(task.id);
  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id, `Closed (was: ${task.status})`
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

  console.log(`${c.green}✓${c.reset} ${STATUS_EMOJI.done} ${c.dim}${task.id}${c.reset} ${task.title}`);
}
