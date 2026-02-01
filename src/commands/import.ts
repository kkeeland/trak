import fs from 'fs';
import path from 'path';
import { getDb, Task, LogEntry, Dependency } from '../db.js';
import { parseJsonl, importFromJsonl } from '../jsonl.js';
import { c } from '../utils.js';

interface ImportData {
  version: string;
  tasks: Task[];
  dependencies: Dependency[];
  logs: LogEntry[];
}

export function importCommand(file?: string): void {
  // Default to .trak/trak.jsonl if no file specified
  if (!file) {
    const defaultJsonl = path.join(process.cwd(), '.trak', 'trak.jsonl');
    if (fs.existsSync(defaultJsonl)) {
      file = defaultJsonl;
    } else {
      console.error(`${c.red}No file specified and no .trak/trak.jsonl found${c.reset}`);
      process.exit(1);
    }
  }

  if (!fs.existsSync(file)) {
    console.error(`${c.red}File not found: ${file}${c.reset}`);
    process.exit(1);
  }

  // Detect JSONL vs JSON
  if (file.endsWith('.jsonl')) {
    const records = parseJsonl(file);
    const db = getDb();
    const result = importFromJsonl(db, records);
    console.log(`${c.green}✓${c.reset} Imported from ${file}`);
    console.log(`  ${result.tasks} tasks, ${result.deps} dependencies, ${result.logs} log entries`);
    return;
  }

  const raw = fs.readFileSync(file, 'utf-8');
  let data: ImportData;

  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`${c.red}Invalid JSON${c.reset}`);
    process.exit(1);
  }

  const db = getDb();
  let taskCount = 0;
  let depCount = 0;
  let logCount = 0;

  const insertTask = db.prepare(`
    INSERT OR REPLACE INTO tasks (id, title, description, status, priority, project, blocked_by, parent_id, created_at, updated_at, agent_session, tokens_used, cost_usd, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDep = db.prepare(`
    INSERT OR IGNORE INTO dependencies (child_id, parent_id) VALUES (?, ?)
  `);

  const insertLog = db.prepare(`
    INSERT INTO task_log (task_id, timestamp, entry, author) VALUES (?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    if (data.tasks) {
      for (const t of data.tasks) {
        insertTask.run(
          t.id, t.title, t.description || '', t.status || 'open', t.priority || 1,
          t.project || '', t.blocked_by || '', t.parent_id || null,
          t.created_at, t.updated_at, t.agent_session || '', t.tokens_used || 0,
          t.cost_usd || 0, t.tags || ''
        );
        taskCount++;
      }
    }

    if (data.dependencies) {
      for (const d of data.dependencies) {
        insertDep.run(d.child_id, d.parent_id);
        depCount++;
      }
    }

    if (data.logs) {
      for (const l of data.logs) {
        insertLog.run(l.task_id, l.timestamp, l.entry, l.author || 'imported');
        logCount++;
      }
    }
  });

  transaction();

  console.log(`${c.green}✓${c.reset} Imported from ${file}`);
  console.log(`  ${taskCount} tasks, ${depCount} dependencies, ${logCount} log entries`);
}
