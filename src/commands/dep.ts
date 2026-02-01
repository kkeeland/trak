import { getDb, Task, afterWrite } from '../db.js';
import { c } from '../utils.js';

function resolveTask(db: ReturnType<typeof getDb>, id: string): Task {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }
  return task;
}

export function depAddCommand(childId: string, parentId: string): void {
  const db = getDb();
  const child = resolveTask(db, childId);
  const parent = resolveTask(db, parentId);

  if (child.id === parent.id) {
    console.error(`${c.red}A task cannot depend on itself${c.reset}`);
    process.exit(1);
  }

  try {
    db.prepare('INSERT INTO dependencies (child_id, parent_id) VALUES (?, ?)').run(child.id, parent.id);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      console.log(`${c.yellow}Dependency already exists${c.reset}`);
      return;
    }
    throw e;
  }

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    child.id, `Added dependency on ${parent.id} (${parent.title})`
  );

  afterWrite(db);

  console.log(`${c.green}✓${c.reset} ${c.dim}${child.id}${c.reset} depends on ${c.dim}${parent.id}${c.reset}`);
  console.log(`  ${child.title} → ${parent.title}`);
}

export function depRmCommand(childId: string, parentId: string): void {
  const db = getDb();
  const child = resolveTask(db, childId);
  const parent = resolveTask(db, parentId);

  const result = db.prepare('DELETE FROM dependencies WHERE child_id = ? AND parent_id = ?').run(child.id, parent.id);

  if (result.changes === 0) {
    console.log(`${c.yellow}No such dependency${c.reset}`);
    return;
  }

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
    child.id, `Removed dependency on ${parent.id}`
  );

  console.log(`${c.green}✓${c.reset} Removed dependency: ${c.dim}${child.id}${c.reset} → ${c.dim}${parent.id}${c.reset}`);
}
