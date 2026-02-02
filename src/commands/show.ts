import { getDb, Task, LogEntry, Dependency, TaskClaim, calculateHeat, resolveTimeout } from '../db.js';
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

  const epicBadge = task.is_epic ? ' 📋 EPIC' : '';
  console.log(`\n${c.bold}${task.id}${c.reset} ${emoji} ${sc}${task.status.toUpperCase()}${c.reset}${epicBadge}`);
  console.log(`${c.bold}${task.title}${c.reset}`);
  console.log(`${'─'.repeat(60)}`);

  if (task.description) console.log(`\n${task.description}\n`);

  console.log(`  ${c.dim}Priority:${c.reset}  ${priorityLabel(task.priority)}`);
  console.log(`  ${c.dim}Heat:${c.reset}      ${heatBar(heat)} ${c.dim}(${heat})${c.reset}`);
  if (task.project) console.log(`  ${c.dim}Project:${c.reset}     ${c.cyan}${task.project}${c.reset}`);
  if (task.tags) console.log(`  ${c.dim}Tags:${c.reset}      ${task.tags}`);
  if (task.blocked_by) console.log(`  ${c.dim}Blocked:${c.reset}   ${c.red}${task.blocked_by}${c.reset}`);
  if (task.parent_id) console.log(`  ${c.dim}Parent:${c.reset}    ${task.parent_id}`);
  if (task.epic_id) console.log(`  ${c.dim}Epic:${c.reset}      ${task.epic_id}`);
  if (task.assigned_to) console.log(`  ${c.dim}Assigned:${c.reset}  ${c.bold}${task.assigned_to}${c.reset}`);
  if (task.verified_by) console.log(`  ${c.dim}Verified:${c.reset}  ${c.green}${task.verified_by}${c.reset}`);
  if (task.verification_status) {
    const vsColor = task.verification_status === 'passed' ? c.green : task.verification_status === 'failed' ? c.red : c.yellow;
    console.log(`  ${c.dim}Verify:${c.reset}    ${vsColor}${task.verification_status}${c.reset}`);
  }
  // Epic child count and completion percentage
  if (task.is_epic) {
    const epicChildren = db.prepare('SELECT status FROM tasks WHERE epic_id = ?').all(task.id) as { status: string }[];
    const total = epicChildren.length;
    const done = epicChildren.filter(t => t.status === 'done' || t.status === 'archived').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    const pctColor = pct === 100 ? c.green : pct >= 50 ? c.yellow : c.red;
    console.log(`  ${c.dim}Children:${c.reset}  ${total} tasks, ${pctColor}${done}/${total} complete (${pct}%)${c.reset}`);
  }
  // Retry info
  if ((task as any).retry_count > 0 || task.status === 'failed') {
    const retryCount = (task as any).retry_count || 0;
    const maxRetries = (task as any).max_retries ?? 3;
    const retryColor = task.status === 'failed' ? c.red : c.yellow;
    console.log(`  ${c.dim}Retries:${c.reset}   ${retryColor}${retryCount}/${maxRetries}${c.reset}${task.status === 'failed' ? ` ${c.red}(permanently failed)${c.reset}` : ''}`);
    if ((task as any).last_failure_reason) {
      console.log(`  ${c.dim}Last fail:${c.reset} ${c.red}${(task as any).last_failure_reason}${c.reset}`);
    }
    if ((task as any).retry_after) {
      const retryAfter = new Date((task as any).retry_after);
      const now = new Date();
      const ready = retryAfter <= now;
      console.log(`  ${c.dim}Retry at:${c.reset}  ${ready ? c.green : c.yellow}${(task as any).retry_after}${ready ? ' (ready)' : ''}${c.reset}`);
    }
  }
  if (task.autonomy && task.autonomy !== 'manual') console.log(`  ${c.dim}Autonomy:${c.reset}  ${task.autonomy}`);
  // Timeout display — show per-task if set, or effective resolved value for auto tasks
  if (task.timeout_seconds && task.timeout_seconds > 0) {
    const ts = task.timeout_seconds;
    const tStr = ts < 60 ? `${ts}s` : ts < 3600 ? `${(ts / 60).toFixed(0)}m` : `${(ts / 3600).toFixed(1)}h`;
    console.log(`  ${c.dim}Timeout:${c.reset}   ${tStr} (per-task)`);
  } else if (task.autonomy === 'auto') {
    const effective = resolveTimeout({ task });
    const eStr = effective < 60 ? `${effective}s` : effective < 3600 ? `${(effective / 60).toFixed(0)}m` : `${(effective / 3600).toFixed(1)}h`;
    console.log(`  ${c.dim}Timeout:${c.reset}   ${eStr} (default)`);
  }
  if (task.budget_usd !== null && task.budget_usd !== undefined) {
    const budgetColor = task.cost_usd > task.budget_usd ? c.red : c.green;
    console.log(`  ${c.dim}Budget:${c.reset}    ${budgetColor}$${task.budget_usd.toFixed(2)}${c.reset}`);
    if (task.cost_usd > task.budget_usd) {
      console.log(`  ${c.bgRed}${c.white} ⚠ OVER BUDGET ${c.reset} cost $${task.cost_usd.toFixed(4)} exceeds budget $${task.budget_usd.toFixed(2)}`);
    }
  }
  if (task.agent_session) console.log(`  ${c.dim}Session:${c.reset}   ${task.agent_session}`);
  if (task.tokens_used) {
    let tokenStr = task.tokens_used.toLocaleString();
    if (task.tokens_in || task.tokens_out) {
      tokenStr += ` (${task.tokens_in.toLocaleString()} in / ${task.tokens_out.toLocaleString()} out)`;
    }
    console.log(`  ${c.dim}Tokens:${c.reset}    ${tokenStr}`);
  }
  if (task.cost_usd) console.log(`  ${c.dim}Cost:${c.reset}      ${c.yellow}$${task.cost_usd.toFixed(4)}${c.reset}`);
  if (task.model_used) console.log(`  ${c.dim}Model:${c.reset}     ${c.cyan}${task.model_used}${c.reset}`);
  if (task.duration_seconds > 0) {
    const dur = task.duration_seconds;
    const durStr = dur < 60 ? `${dur.toFixed(0)}s` : dur < 3600 ? `${(dur/60).toFixed(1)}m` : `${(dur/3600).toFixed(1)}h`;
    console.log(`  ${c.dim}Duration:${c.reset}  ${durStr}`);
  }
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

  // Subtasks + epic children
  const subtasks = db.prepare("SELECT * FROM tasks WHERE parent_id = ? ORDER BY status, priority DESC").all(task.id) as Task[];
  const epicChildren = task.is_epic
    ? db.prepare("SELECT * FROM tasks WHERE epic_id = ? ORDER BY status, priority DESC").all(task.id) as Task[]
    : [];

  const allChildren = [...subtasks];
  const subtaskIds = new Set(subtasks.map(s => s.id));
  for (const ec of epicChildren) {
    if (!subtaskIds.has(ec.id)) allChildren.push(ec);
  }

  if (allChildren.length > 0) {
    console.log(`\n  ${c.dim}${task.is_epic ? 'Epic Tasks' : 'Subtasks'}:${c.reset}`);
    for (const st of allChildren) {
      const e = STATUS_EMOJI[st.status];
      const agent = st.assigned_to ? ` ${c.cyan}→ ${st.assigned_to}${c.reset}` : '';
      console.log(`    ${e} ${c.dim}${st.id}${c.reset} ${st.title}${agent}`);
    }
  }

  // Claims history
  const claims = db.prepare('SELECT * FROM task_claims WHERE task_id = ? ORDER BY claimed_at ASC').all(task.id) as TaskClaim[];
  if (claims.length > 0) {
    console.log(`\n  ${c.bold}Claims History${c.reset} (${claims.length})`);
    console.log(`  ${'─'.repeat(56)}`);
    for (const claim of claims) {
      const statusIcon = claim.status === 'claimed' ? '🟢' : claim.status === 'completed' ? '✅' : '⬜';
      const model = claim.model ? ` ${c.dim}(${claim.model})${c.reset}` : '';
      const duration = claim.released_at ? ` → ${formatDate(claim.released_at)}` : ' (active)';
      console.log(`  ${statusIcon} ${c.bold}${claim.agent}${c.reset}${model} ${c.dim}${formatDate(claim.claimed_at)}${duration}${c.reset}`);
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
