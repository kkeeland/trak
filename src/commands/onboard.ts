import { getDb, Task, calculateHeat } from '../db.js';
import { c, STATUS_EMOJI, statusColor, heatBar } from '../utils.js';

function progressBar(done: number, total: number, width: number = 10): string {
  if (total === 0) return '░'.repeat(width);
  const filled = Math.round((done / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function onboardCommand(project: string): void {
  const db = getDb();

  const tasks = db.prepare(
    'SELECT * FROM tasks WHERE project = ? ORDER BY priority DESC, created_at ASC'
  ).all(project) as Task[];

  if (tasks.length === 0) {
    console.error(`${c.red}No tasks found for project: ${project}${c.reset}`);
    process.exit(1);
  }

  // Counts
  const statusCounts: Record<string, number> = {};
  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  const epics = tasks.filter(t => t.is_epic);

  // Welcome header
  console.log(`\n${c.bold}👋 Welcome to ${c.cyan}${project}${c.reset}${c.bold}!${c.reset}\n`);

  // Overview
  const totalTasks = tasks.length;
  const epicCount = epics.length;
  console.log(`This project has ${c.bold}${totalTasks} tasks${c.reset}${epicCount > 0 ? ` across ${c.bold}${epicCount} epics${c.reset}` : ''}.`);

  const parts: string[] = [];
  if (statusCounts.done) parts.push(`${c.green}${statusCounts.done} done${c.reset}`);
  if (statusCounts.wip) parts.push(`${c.yellow}${statusCounts.wip} in progress${c.reset}`);
  if (statusCounts.open) parts.push(`${c.white}${statusCounts.open} ready${c.reset}`);
  if (statusCounts.blocked) parts.push(`${c.red}${statusCounts.blocked} blocked${c.reset}`);
  if (statusCounts.review) parts.push(`${c.magenta}${statusCounts.review} in review${c.reset}`);
  if (parts.length > 0) console.log(parts.join(', '));
  console.log();

  // Epic progress
  if (epics.length > 0) {
    console.log(`${c.bold}📋 Epics:${c.reset}`);
    for (const epic of epics) {
      const epicTasks = tasks.filter(t => t.epic_id === epic.id);
      const epicDone = epicTasks.filter(t => t.status === 'done').length;
      const total = epicTasks.length;
      const bar = progressBar(epicDone, total, 8);
      const emoji = STATUS_EMOJI[epic.status] || '?';
      const sc = statusColor(epic.status);
      console.log(`  ${emoji} ${sc}${epic.title}${c.reset} [${bar}] ${epicDone}/${total}`);
    }
    console.log();
  }

  // What's been done (compressed)
  const doneTasks = tasks.filter(t => t.status === 'done');
  if (doneTasks.length > 0) {
    console.log(`${c.bold}✅ What happened so far:${c.reset}`);
    const doneEpics = doneTasks.filter(t => t.is_epic);
    const doneRegular = doneTasks.filter(t => !t.is_epic);

    for (const e of doneEpics) {
      console.log(`  ✅ EPIC: ${e.title}`);
    }

    if (doneRegular.length <= 5) {
      for (const t of doneRegular) {
        console.log(`  ✅ ${t.title}`);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        console.log(`  ✅ ${doneRegular[i].title}`);
      }
      console.log(`  ${c.dim}... and ${doneRegular.length - 3} more completed tasks${c.reset}`);
    }
    console.log();
  }

  // Currently active
  const wipTasks = tasks.filter(t => t.status === 'wip' || t.status === 'review');
  if (wipTasks.length > 0) {
    console.log(`${c.bold}🔨 Currently in progress:${c.reset}`);
    for (const t of wipTasks) {
      const emoji = STATUS_EMOJI[t.status] || '?';
      const session = t.agent_session ? ` ${c.dim}(${t.agent_session})${c.reset}` : '';
      console.log(`  ${emoji} ${t.title}${session}`);
    }
    console.log();
  }

  // Blocked
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  if (blockedTasks.length > 0) {
    console.log(`${c.bold}🚫 Blocked:${c.reset}`);
    for (const t of blockedTasks) {
      const reason = t.blocked_by ? ` — ${t.blocked_by}` : '';
      console.log(`  🚫 ${t.title}${reason}`);
    }
    console.log();
  }

  // Find highest-impact ready task
  const openTasks = tasks.filter(t => t.status === 'open');
  const readyTasks: (Task & { _unblocks: number })[] = [];

  for (const t of openTasks) {
    const deps = db.prepare('SELECT parent_id FROM dependencies WHERE child_id = ?').all(t.id) as { parent_id: string }[];
    const allDone = deps.every(d => {
      const parent = db.prepare('SELECT status FROM tasks WHERE id = ?').get(d.parent_id) as { status: string } | undefined;
      return parent && (parent.status === 'done' || parent.status === 'archived');
    });
    if (allDone) {
      const unblocks = db.prepare('SELECT COUNT(*) as cnt FROM dependencies WHERE parent_id = ?').get(t.id) as { cnt: number };
      readyTasks.push({ ...t, _unblocks: unblocks.cnt });
    }
  }

  // Sort by heat score + unblocks
  readyTasks.sort((a, b) => {
    const heatA = calculateHeat(db, a) + a._unblocks * 2;
    const heatB = calculateHeat(db, b) + b._unblocks * 2;
    return heatB - heatA;
  });

  if (readyTasks.length > 0) {
    console.log(`${c.bold}🎯 What needs doing:${c.reset}`);
    const showLimit = Math.min(readyTasks.length, 5);
    for (let i = 0; i < showLimit; i++) {
      const t = readyTasks[i];
      const extras: string[] = [];
      extras.push(`P${t.priority}`);
      if (t._unblocks > 0) extras.push(`unblocks ${t._unblocks}`);
      console.log(`  ○ ${t.title} ${c.dim}(${extras.join(', ')})${c.reset}`);
    }
    if (readyTasks.length > showLimit) {
      console.log(`  ${c.dim}... and ${readyTasks.length - showLimit} more ready tasks${c.reset}`);
    }
    console.log();

    // Highlight top pick
    const top = readyTasks[0];
    const topExtras: string[] = [`P${top.priority}`];
    if (top._unblocks > 0) topExtras.push(`unblocks ${top._unblocks} tasks`);

    console.log(`${c.bold}${c.green}Your highest-impact task right now:${c.reset}`);
    console.log(`→ ${c.bold}${top.id}${c.reset}: ${top.title} (${topExtras.join(', ')})`);
    console.log();
    console.log(`Run ${c.cyan}trak status ${top.id} wip${c.reset} to get started.`);
  } else if (openTasks.length > 0) {
    console.log(`${c.dim}${openTasks.length} open tasks, but all are waiting on dependencies.${c.reset}`);
  } else {
    console.log(`${c.green}${c.bold}🎉 All tasks are done or in progress! Nothing to pick up.${c.reset}`);
  }

  console.log();
}
