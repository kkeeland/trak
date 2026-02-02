import { getDb, Task, afterWrite, getConfigValue } from '../db.js';
import { c, STATUS_EMOJI } from '../utils.js';
import { hookTaskAssigned, hookTaskStatusChanged } from '../hooks.js';
import { checkConflict, listLocks, LockInfo } from '../locks.js';

/**
 * Check if assigning a task to an agent would create a workspace conflict.
 * Uses the task's project field to infer the repo path, and checks locks.
 */
function checkAssignConflicts(task: Task, agentName: string): LockInfo | null {
  // Check if lock enforcement is enabled (default: warn only)
  const locks = listLocks();
  if (locks.length === 0) return null;

  // Check if any active lock is for the same project by a different agent
  for (const lock of locks) {
    if (lock.agent === agentName) continue; // same agent is fine
    if (lock.taskId === task.id) continue;  // same task is fine

    // Match by project name in repo path
    if (task.project && lock.repoPath.toLowerCase().includes(task.project.toLowerCase())) {
      return lock;
    }
  }

  return null;
}

export function assignCommand(id: string, agentName: string): void {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;

  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  // Check for workspace conflicts
  const conflictLock = checkAssignConflicts(task, agentName);
  if (conflictLock) {
    const enforce = getConfigValue('lock.enforce');
    const remaining = Math.max(0, Math.round(
      (new Date(conflictLock.expiresAt).getTime() - Date.now()) / 60_000
    ));

    if (enforce === true || enforce === 'block') {
      console.error(`${c.red}✗ Workspace conflict!${c.reset} Project "${task.project}" is locked by:`);
      console.error(`  Task: ${c.bold}${conflictLock.taskId}${c.reset}  Agent: ${conflictLock.agent}  Expires: ${remaining}m`);
      console.error(`${c.dim}Use 'trak lock break' to force, or wait for lock to release.${c.reset}`);
      process.exit(1);
    } else {
      // Warn but don't block (default behavior)
      console.log(`${c.yellow}⚠ Warning:${c.reset} Project "${task.project}" has active lock by ${c.bold}${conflictLock.agent}${c.reset} (task ${conflictLock.taskId}, ${remaining}m remaining)`);
      console.log(`  ${c.dim}Set 'trak config set lock.enforce true' to block conflicting assignments.${c.reset}`);
    }
  }

  const oldStatus = task.status;
  const newStatus = (oldStatus === 'open' || oldStatus === 'review') ? 'wip' : oldStatus;

  db.prepare(`
    UPDATE tasks SET assigned_to = ?, status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(agentName, newStatus, task.id);

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    task.id,
    `${agentName} assigned to this task`
  );

  if (oldStatus !== newStatus) {
    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      task.id,
      `Status: ${oldStatus} → ${newStatus}`
    );
  }

  afterWrite(db, {
    op: 'update',
    id: task.id,
    data: {
      assigned_to: agentName,
      status: newStatus
    }
  });
  hookTaskAssigned(task, agentName);
  if (oldStatus !== newStatus) {
    hookTaskStatusChanged(task, oldStatus, newStatus);
  }

  const emoji = STATUS_EMOJI[newStatus] || '?';
  console.log(`${c.green}✓${c.reset} ${c.dim}${task.id}${c.reset} ${emoji} assigned to ${c.bold}${agentName}${c.reset}`);
  if (oldStatus !== newStatus) {
    console.log(`  ${c.dim}status:${c.reset} ${oldStatus} → ${c.bold}${newStatus}${c.reset}`);
  }
}
