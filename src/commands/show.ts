import { getDb, Task, LogEntry, Dependency, calculateHeat } from '../db.js';
import { c, STATUS_EMOJI, statusColor, priorityLabel, formatDate, heatBar } from '../utils.js';

export function showCommand(id: string): void {
  const db = getDb();

  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }

  const heat = calculateHeat(db, task);
  const emoji = STATUS_EMOJI[task.status] || '?';
  const sc = statusColor(task.status);

  console.log(`\n${c.bold}${task.id}${c.reset} ${emoji} ${sc}${task.status.toUpperCase()}${c.reset}`);
  console.log(`${c.bold}${task.title}${c.reset}`);
  console.log(`${'─'.repeat(60)}`);

  if (task.description) console.log(`\n${task.description}\n`);

  console.log(`  ${c.dim}Priority:${c.reset}  ${priorityLabel(task.priority)}`);
  console.log(`  ${c.dim}Heat:${c.reset}      ${heatBar(heat)} ${c.dim}(${heat})${c.reset}`);
  if (task.brand) console.log(`  ${c.dim}Brand:${c.reset}     ${c.cyan}${task.brand}${c.reset}`);
  if (task.tags) console.log(`  ${c.dim}Tags:${c.reset}      ${task.tags}`);
  if (task.blocked_by) console.log(`  ${c.dim}Blocked:${c.reset}   ${c.red}${task.blocked_by}${c.reset}`);
  if (task.parent_id) console.log(`  ${c.dim}Parent:${c.reset}    ${task.parent_id}`);
  if (task.agent_session) console.log(`  ${c.dim}Session:${c.reset}   ${task.agent_session}`);
  if (task.tokens_used) console.log(`  ${c.dim}Tokens:${c.reset}    ${task.tokens_used.toLocaleString()}`);
  if (task.cost_usd) console.log(`  ${c.dim}Cost:${c.reset}      $${task.cost_usd.toFixed(4)}`);
  console.log(`  ${c.dim}Created:${c.reset}   ${task.created_at} (${formatDate(task.created_at)})`);
  console.log(`  ${c.dim}Updated:${c.reset}   ${task.updated_at} (${formatDate(task.updated_at)})`);

  // Dependencies
  const deps = db.prepare('SELECT parent_id FROM dependencies WHERE child_id = ?').all(task.id) as { parent_id: string }[];
  const dependents = db.prepare('SELECT child_id FROM dependencies WHERE parent_id = ?').all(task.id) as { child_id: string }[];

  if (deps.length > 0) {
    console.log(`\n  ${c.dim}Depends on:${c.reset}`);
    for (const d of deps) {
      const dep = db.prepare('SELECT id, title, status FROM tasks WHERE id = ?').get(d.parent_id) as Task | undefined;
      if (dep) {
        const e = STATUS_EMOJI[dep.status];
        console.log(`    ${e} ${c.dim}${dep.id}${c.reset} ${dep.title}`);
      }
    }
  }

  if (dependents.length > 0) {
    console.log(`\n  ${c.dim}Blocks:${c.reset}`);
    for (const d of dependents) {
      const dep = db.prepare('SELECT id, title, status FROM tasks WHERE id = ?').get(d.child_id) as Task | undefined;
      if (dep) {
        const e = STATUS_EMOJI[dep.status];
        console.log(`    ${e} ${c.dim}${dep.id}${c.reset} ${dep.title}`);
      }
    }
  }

  // Subtasks
  const subtasks = db.prepare("SELECT * FROM tasks WHERE parent_id = ? ORDER BY status, priority DESC").all(task.id) as Task[];
  if (subtasks.length > 0) {
    console.log(`\n  ${c.dim}Subtasks:${c.reset}`);
    for (const st of subtasks) {
      const e = STATUS_EMOJI[st.status];
      console.log(`    ${e} ${c.dim}${st.id}${c.reset} ${st.title}`);
    }
  }

  // Journal
  const logs = db.prepare('SELECT * FROM task_log WHERE task_id = ? ORDER BY timestamp ASC').all(task.id) as LogEntry[];
  if (logs.length > 0) {
    console.log(`\n  ${c.bold}Journal${c.reset} (${logs.length} entries)`);
    console.log(`  ${'─'.repeat(56)}`);
    for (const log of logs) {
      const ts = formatDate(log.timestamp);
      console.log(`  ${c.dim}${ts}${c.reset} ${c.cyan}[${log.author}]${c.reset} ${log.entry}`);
    }
  }
  console.log();
}
