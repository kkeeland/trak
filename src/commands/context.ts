import { getDb, Task, LogEntry } from '../db.js';
import { c } from '../utils.js';

function getStatusEmoji(status: string): string {
  switch (status) {
    case 'done': return '✅';
    case 'wip': return '🔨';
    case 'blocked': return '🚫';
    case 'review': return '👀';
    case 'open': return '○';
    case 'archived': return '📦';
    default: return '?';
  }
}

function progressBar(done: number, total: number, width: number = 10): string {
  if (total === 0) return '░'.repeat(width);
  const filled = Math.round((done / total) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function contextCommand(project: string): void {
  const db = getDb();

  // Get all tasks for this project
  const tasks = db.prepare(
    'SELECT * FROM tasks WHERE project = ? ORDER BY priority DESC, created_at ASC'
  ).all(project) as Task[];

  if (tasks.length === 0) {
    console.error(`No tasks found for project: ${project}`);
    process.exit(1);
  }

  const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');

  // Counts
  const statusCounts: Record<string, number> = {};
  let totalTokens = 0;
  let totalCost = 0;

  for (const t of tasks) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    totalTokens += t.tokens_used || 0;
    totalCost += t.cost_usd || 0;
  }

  const epics = tasks.filter(t => t.is_epic);
  const epicsComplete = epics.filter(t => t.status === 'done').length;

  // Header
  console.log(`# Project Context: ${project}`);
  console.log(`Generated: ${now}`);
  console.log();

  // Summary
  console.log(`## Summary`);
  const parts: string[] = [];
  for (const [status, count] of Object.entries(statusCounts)) {
    parts.push(`${count} ${status}`);
  }
  console.log(`${tasks.length} tasks (${parts.join(', ')})`);
  if (epics.length > 0) {
    console.log(`${epics.length} epics, ${epicsComplete} complete`);
  }
  if (totalCost > 0 || totalTokens > 0) {
    console.log(`Total investment: $${totalCost.toFixed(2)} (${totalTokens.toLocaleString()} tokens)`);
  }
  console.log();

  // Completed Work
  const doneTasks = tasks.filter(t => t.status === 'done');
  if (doneTasks.length > 0) {
    console.log(`## Completed Work (what's been done)`);
    // Show epics first, then standalone
    const doneEpics = doneTasks.filter(t => t.is_epic);
    const doneRegular = doneTasks.filter(t => !t.is_epic);

    for (const epic of doneEpics) {
      console.log(`- ✅ EPIC: ${epic.title} [done]`);
      // Get key decisions from journal
      const keyLogs = getKeyDecisions(db, epic.id);
      if (keyLogs.length > 0) {
        console.log(`  Key decisions: ${keyLogs.join('; ')}`);
      }
    }

    // Group non-epic done tasks (limit to avoid wall of text)
    const showLimit = 10;
    for (let i = 0; i < Math.min(doneRegular.length, showLimit); i++) {
      const t = doneRegular[i];
      console.log(`- ✅ ${t.title}`);
    }
    if (doneRegular.length > showLimit) {
      console.log(`  ... and ${doneRegular.length - showLimit} more completed tasks`);
    }
    console.log();
  }

  // Active Work (wip + review)
  const activeTasks = tasks.filter(t => t.status === 'wip' || t.status === 'review');
  if (activeTasks.length > 0) {
    console.log(`## Active Work (what's happening now)`);

    // Show active epics with progress
    const activeEpics = epics.filter(e => e.status === 'wip' || e.status === 'review');
    for (const epic of activeEpics) {
      const epicTasks = tasks.filter(t => t.epic_id === epic.id);
      const epicDone = epicTasks.filter(t => t.status === 'done').length;
      const bar = progressBar(epicDone, epicTasks.length, 6);
      console.log(`- 🔨 EPIC: ${epic.title} [${bar}] ${epicDone}/${epicTasks.length}`);

      // Show current WIP subtasks
      const wipSubs = epicTasks.filter(t => t.status === 'wip');
      for (const s of wipSubs) {
        const session = s.agent_session ? ` (${s.agent_session})` : '';
        console.log(`  Currently: ${s.title}${session}`);
      }
    }

    // Non-epic active tasks
    const activeRegular = activeTasks.filter(t => !t.is_epic);
    for (const t of activeRegular) {
      const emoji = t.status === 'review' ? '👀' : '🔨';
      const session = t.agent_session ? ` (${t.agent_session})` : '';
      console.log(`- ${emoji} ${t.title} — ${t.status}${session}`);
    }
    console.log();
  }

  // Blocked
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  if (blockedTasks.length > 0) {
    console.log(`## Blocked (needs attention)`);
    for (const t of blockedTasks) {
      const reason = t.blocked_by ? ` — ${t.blocked_by}` : '';
      console.log(`- 🚫 ${t.title}${reason}`);
    }
    console.log();
  }

  // What's Next (open tasks, ordered by priority, checking unblocked)
  const openTasks = tasks.filter(t => t.status === 'open');
  if (openTasks.length > 0) {
    console.log(`## What's Next (ready to start)`);

    // Check which are truly unblocked
    const readyTasks: Task[] = [];
    for (const t of openTasks) {
      const deps = db.prepare('SELECT parent_id FROM dependencies WHERE child_id = ?').all(t.id) as { parent_id: string }[];
      const allDone = deps.every(d => {
        const parent = db.prepare('SELECT status FROM tasks WHERE id = ?').get(d.parent_id) as { status: string } | undefined;
        return parent && (parent.status === 'done' || parent.status === 'archived');
      });
      if (allDone) {
        // Count what this unblocks
        const unblocks = db.prepare('SELECT COUNT(*) as cnt FROM dependencies WHERE parent_id = ?').get(t.id) as { cnt: number };
        (t as any)._unblocks = unblocks.cnt;
        readyTasks.push(t);
      }
    }

    // Sort by priority desc, unblocks desc
    readyTasks.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return ((b as any)._unblocks || 0) - ((a as any)._unblocks || 0);
    });

    const showLimit = 10;
    for (let i = 0; i < Math.min(readyTasks.length, showLimit); i++) {
      const t = readyTasks[i];
      const unblocks = (t as any)._unblocks;
      const extras: string[] = [];
      extras.push(`P${t.priority}`);
      if (unblocks > 0) extras.push(`unblocks ${unblocks} tasks`);
      console.log(`- ○ ${t.title} — ${extras.join(', ')}`);
    }

    const remaining = openTasks.length - readyTasks.length;
    if (remaining > 0) {
      console.log(`  ... and ${remaining} tasks waiting on dependencies`);
    }
    console.log();
  }

  // Key Decisions (from journals)
  const allDecisions = extractDecisions(db, tasks);
  if (allDecisions.length > 0) {
    console.log(`## Key Decisions Made`);
    console.log(`(extracted from task journals)`);
    for (const d of allDecisions.slice(0, 15)) {
      console.log(`- ${d}`);
    }
    console.log();
  }
}

function getKeyDecisions(db: ReturnType<typeof getDb>, taskId: string): string[] {
  const logs = db.prepare(
    'SELECT entry FROM task_log WHERE task_id = ? ORDER BY timestamp ASC LIMIT 5'
  ).all(taskId) as { entry: string }[];

  return logs
    .map(l => l.entry)
    .filter(e => e.length > 10 && e.length < 200)
    .slice(0, 3);
}

function extractDecisions(db: ReturnType<typeof getDb>, tasks: Task[]): string[] {
  const decisions: string[] = [];
  const seen = new Set<string>();

  // Look for decision-like patterns in journals
  const decisionPatterns = [
    /(?:decided|chose|chosen|selected|using|switched to|went with|picked)\s+(.+)/i,
    /(?:architecture|stack|framework|approach):\s*(.+)/i,
  ];

  for (const task of tasks) {
    const logs = db.prepare(
      'SELECT entry FROM task_log WHERE task_id = ? ORDER BY timestamp ASC'
    ).all(task.id) as { entry: string }[];

    for (const log of logs) {
      for (const pattern of decisionPatterns) {
        const match = log.entry.match(pattern);
        if (match && !seen.has(match[1].toLowerCase())) {
          seen.add(match[1].toLowerCase());
          decisions.push(match[1].trim());
        }
      }
    }
  }

  return decisions;
}
