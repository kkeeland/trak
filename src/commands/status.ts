import { execSync } from 'child_process';
import { getDb, Task, afterWrite } from '../db.js';
import { c, STATUS_EMOJI, VALID_STATUSES } from '../utils.js';
import { hookTaskStatusChanged } from '../hooks.js';

function getGitHead(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function statusCommand(id: string, newStatus: string): void {
  if (!VALID_STATUSES.includes(newStatus)) {
    console.error(`${c.red}Invalid status: ${newStatus}${c.reset}`);
    console.error(`Valid: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  const oldStatus = task.status;
  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, task.id);

  // Record git snapshot when entering WIP
  if (newStatus === 'wip') {
    const head = getGitHead();
    if (head) {
      db.prepare("UPDATE tasks SET wip_snapshot = ? WHERE id = ?").run(head, task.id);
      db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
        task.id,
        `Status: ${oldStatus} → ${newStatus}\nWIP started, snapshot: ${head.slice(0, 8)}`
      );
      const emoji = STATUS_EMOJI[newStatus];
      afterWrite(db);
      hookTaskStatusChanged(task, oldStatus, newStatus);
      console.log(`${c.green}✓${c.reset} ${c.dim}${task.id}${c.reset} ${emoji} ${oldStatus} → ${c.bold}${newStatus}${c.reset}`);
      console.log(`  ${c.dim}git snapshot:${c.reset} ${head.slice(0, 8)}`);
      return;
    }
  }

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id,
    `Status: ${oldStatus} → ${newStatus}`
  );

  afterWrite(db);
  hookTaskStatusChanged(task, oldStatus, newStatus);

  const emoji = STATUS_EMOJI[newStatus];
  console.log(`${c.green}✓${c.reset} ${c.dim}${task.id}${c.reset} ${emoji} ${oldStatus} → ${c.bold}${newStatus}${c.reset}`);
}
