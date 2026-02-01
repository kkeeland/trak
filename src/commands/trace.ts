import Database from 'better-sqlite3';
import { getDb, Task } from '../db.js';
import { c, STATUS_EMOJI, statusColor } from '../utils.js';

export interface TraceOptions {
  forward?: boolean;
  backward?: boolean;
  depth?: string;
}

interface TaskNode {
  id: string;
  title: string;
  status: string;
  is_epic: number;
}

function resolveTask(db: Database.Database, id: string): Task {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }
  return task;
}

function getTaskNode(db: Database.Database, id: string): TaskNode | null {
  return db.prepare('SELECT id, title, status, is_epic FROM tasks WHERE id = ?').get(id) as TaskNode | null;
}

// Get parents (upstream): tasks this task depends on
function getParents(db: Database.Database, taskId: string): string[] {
  const rows = db.prepare('SELECT parent_id FROM dependencies WHERE child_id = ?').all(taskId) as { parent_id: string }[];
  return rows.map(r => r.parent_id);
}

// Get children (downstream): tasks that depend on this task
function getChildren(db: Database.Database, taskId: string): string[] {
  const rows = db.prepare('SELECT child_id FROM dependencies WHERE parent_id = ?').all(taskId) as { child_id: string }[];
  return rows.map(r => r.child_id);
}

function formatTaskLine(node: TaskNode, targetId: string): string {
  const emoji = STATUS_EMOJI[node.status] || '?';
  const sc = statusColor(node.status);
  const prefix = node.is_epic ? 'EPIC: ' : '';
  const marker = node.id === targetId ? ` ${c.bold}${c.yellow}← YOU ARE HERE${c.reset}` : '';
  return `${prefix}${node.title} (${c.dim}${node.id}${c.reset}) — ${sc}${node.status}${c.reset} ${emoji}${marker}`;
}

// Find all root ancestors (tasks with no parents in the dependency graph)
function findRoots(db: Database.Database, taskId: string, maxDepth: number): Set<string> {
  const roots = new Set<string>();
  const visited = new Set<string>();

  function walk(id: string, depth: number): void {
    if (visited.has(id) || depth > maxDepth) return;
    visited.add(id);
    const parents = getParents(db, id);
    if (parents.length === 0) {
      roots.add(id);
    } else {
      for (const p of parents) {
        walk(p, depth + 1);
      }
    }
  }

  walk(taskId, 0);
  return roots;
}

// Build full tree from a root downward, marking the target
function printFullTree(
  db: Database.Database,
  rootId: string,
  targetId: string,
  maxDepth: number
): void {
  const visited = new Set<string>();

  function renderTree(id: string, prefix: string, isLast: boolean, depth: number): void {
    if (depth > maxDepth) return;
    if (visited.has(id)) {
      const node = getTaskNode(db, id);
      if (node) {
        const connector = isLast ? '└─ ' : '├─ ';
        console.log(`${prefix}${connector}${c.dim}(cycle: ${node.id})${c.reset}`);
      }
      return;
    }
    visited.add(id);

    const node = getTaskNode(db, id);
    if (!node) return;

    const connector = depth === 0 ? '' : (isLast ? '└─ ' : '├─ ');
    const line = formatTaskLine(node, targetId);
    console.log(`${prefix}${connector}${line}`);

    const children = getChildren(db, id);
    const childPrefix = depth === 0 ? '   ' : prefix + (isLast ? '   ' : '│  ');

    for (let i = 0; i < children.length; i++) {
      renderTree(children[i], childPrefix, i === children.length - 1, depth + 1);
    }
  }

  renderTree(rootId, '  ', true, 0);
}

// Forward trace: show downstream tree from target
function traceForward(db: Database.Database, task: Task, maxDepth: number): void {
  console.log(`\n${c.bold}⏩ Forward: ${task.title} (${task.id})${c.reset}\n`);

  const children = getChildren(db, task.id);
  if (children.length === 0) {
    console.log(`  ${c.dim}No downstream tasks — this is a leaf node.${c.reset}`);
    console.log();
    return;
  }

  const visited = new Set<string>();
  visited.add(task.id);

  function renderTree(id: string, prefix: string, isLast: boolean, depth: number): void {
    if (depth > maxDepth) {
      console.log(`${prefix}${isLast ? '└─ ' : '├─ '}${c.dim}... (depth limit)${c.reset}`);
      return;
    }
    if (visited.has(id)) {
      const node = getTaskNode(db, id);
      if (node) {
        console.log(`${prefix}${isLast ? '└─ ' : '├─ '}${c.dim}(cycle: ${node.id})${c.reset}`);
      }
      return;
    }
    visited.add(id);

    const node = getTaskNode(db, id);
    if (!node) return;

    const connector = isLast ? '└─ ' : '├─ ';
    const emoji = STATUS_EMOJI[node.status] || '?';
    const sc = statusColor(node.status);
    const pre = node.is_epic ? 'EPIC: ' : '';
    console.log(`${prefix}${connector}${pre}${node.title} (${c.dim}${node.id}${c.reset}) — ${sc}${node.status}${c.reset} ${emoji}`);

    const grandchildren = getChildren(db, id);
    const childPrefix = prefix + (isLast ? '   ' : '│  ');
    for (let i = 0; i < grandchildren.length; i++) {
      renderTree(grandchildren[i], childPrefix, i === grandchildren.length - 1, depth + 1);
    }
  }

  for (let i = 0; i < children.length; i++) {
    renderTree(children[i], '  ', i === children.length - 1, 1);
  }
  console.log();
}

// Backward trace: show ancestry chain
function traceBackward(db: Database.Database, task: Task, maxDepth: number): void {
  console.log(`\n${c.bold}⏪ Backward: ${task.title} (${task.id})${c.reset}\n`);

  const visited = new Set<string>();
  visited.add(task.id);

  function walkUp(id: string, indent: number, depth: number): void {
    if (depth > maxDepth) return;
    const parents = getParents(db, id);
    if (parents.length === 0) return;

    for (const pid of parents) {
      if (visited.has(pid)) {
        console.log(`${'  '.repeat(indent)}${c.dim}depends on → (cycle: ${pid})${c.reset}`);
        continue;
      }
      visited.add(pid);

      const node = getTaskNode(db, pid);
      if (!node) continue;

      const emoji = STATUS_EMOJI[node.status] || '?';
      const sc = statusColor(node.status);
      const pre = node.is_epic ? 'EPIC: ' : '';
      console.log(`${'  '.repeat(indent)}depends on → ${pre}${node.title} (${c.dim}${node.id}${c.reset}) — ${sc}${node.status}${c.reset} ${emoji}`);

      walkUp(pid, indent + 1, depth + 1);
    }
  }

  walkUp(task.id, 1, 1);
  console.log();
}

// Full trace: find roots, render full tree with target marked
function traceFull(db: Database.Database, task: Task, maxDepth: number): void {
  console.log(`\n${c.bold}🔍 Trace: ${task.title} (${task.id})${c.reset}\n`);

  const roots = findRoots(db, task.id, maxDepth);

  if (roots.size === 0) {
    // Task itself is a root
    console.log(`  ${c.dim}Root${c.reset}`);
    printFullTree(db, task.id, task.id, maxDepth);
  } else {
    for (const rootId of roots) {
      console.log(`  ${c.dim}Root${c.reset}`);
      printFullTree(db, rootId, task.id, maxDepth);
      console.log();
    }
  }
  console.log();
}

export function traceCommand(id: string, opts: TraceOptions): void {
  const db = getDb();
  const task = resolveTask(db, id);
  const maxDepth = opts.depth ? parseInt(opts.depth, 10) : 10;

  if (opts.forward) {
    traceForward(db, task, maxDepth);
  } else if (opts.backward) {
    traceBackward(db, task, maxDepth);
  } else {
    traceFull(db, task, maxDepth);
  }
}
