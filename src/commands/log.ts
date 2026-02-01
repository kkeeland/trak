import { getDb, Task, afterWrite } from '../db.js';
import { c } from '../utils.js';
import { hookTaskLogged } from '../hooks.js';

export interface LogOptions {
  author?: string;
  cost?: string;
  tokens?: string;
  tokensIn?: string;
  tokensOut?: string;
  model?: string;
  duration?: string;
}

export function logCommand(id: string, entry: string, opts: LogOptions): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  const author = opts.author || 'human';

  db.prepare('INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)').run(task.id, entry, author);
  db.prepare("UPDATE tasks SET updated_at = datetime('now') WHERE id = ?").run(task.id);

  // Additive cost/token logging
  if (opts.cost || opts.tokens || opts.tokensIn || opts.tokensOut || opts.model || opts.duration) {
    const addCost = opts.cost ? parseFloat(opts.cost) : 0;
    const addTokens = opts.tokens ? parseInt(opts.tokens, 10) : 0;
    const addTokensIn = opts.tokensIn ? parseInt(opts.tokensIn, 10) : 0;
    const addTokensOut = opts.tokensOut ? parseInt(opts.tokensOut, 10) : 0;
    const model = opts.model || '';
    const duration = opts.duration ? parseFloat(opts.duration) : 0;

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
      console.log(`${c.green}✓${c.reset} Cost: ${parts.join(', ')}`);
    }
  }

  afterWrite(db);
  hookTaskLogged(task, entry, author);

  console.log(`${c.green}✓${c.reset} Logged to ${c.dim}${task.id}${c.reset} ${c.cyan}[${author}]${c.reset} ${entry}`);
}
