import { getDb, afterWrite } from '../db.js';
import { c } from '../utils.js';

export function ensureMailboxTable(db: ReturnType<typeof getDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mailbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL DEFAULT 'all',
      task_id TEXT DEFAULT NULL,
      message TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export interface MailSendOptions {
  task?: string;
}

export function mailSendCommand(toAgent: string, message: string, opts?: MailSendOptions): void {
  const db = getDb();
  ensureMailboxTable(db);

  const fromAgent = process.env.TRAK_AGENT || 'human';
  const taskId = opts?.task || null;

  // Validate task exists if provided
  if (taskId) {
    const task = db.prepare('SELECT id FROM tasks WHERE id = ? OR id LIKE ?').get(taskId, `%${taskId}%`) as any;
    if (!task) {
      console.error(`${c.red}Task not found: ${taskId}${c.reset}`);
      process.exit(1);
    }
  }

  const result = db.prepare(
    'INSERT INTO mailbox (from_agent, to_agent, task_id, message) VALUES (?, ?, ?, ?)'
  ).run(fromAgent, toAgent, taskId, message);

  afterWrite(db);

  console.log(`${c.green}✓${c.reset} Message sent to ${c.bold}${toAgent}${c.reset} (id: ${result.lastInsertRowid})`);
  if (taskId) console.log(`  ${c.dim}re: ${taskId}${c.reset}`);
}

export interface MailCheckOptions {
  agent?: string;
}

export function mailCheckCommand(opts?: MailCheckOptions): void {
  const db = getDb();
  ensureMailboxTable(db);

  const agent = opts?.agent || process.env.TRAK_AGENT || 'human';

  const messages = db.prepare(`
    SELECT * FROM mailbox
    WHERE (to_agent = ? OR to_agent = 'all')
    AND read = 0
    ORDER BY created_at DESC
  `).all(agent) as any[];

  if (messages.length === 0) {
    console.log(`${c.dim}📭 No unread messages for ${agent}${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}📬 ${messages.length} unread message(s) for ${agent}${c.reset}\n`);

  for (const msg of messages) {
    console.log(`  ${c.bold}#${msg.id}${c.reset} from ${c.cyan}${msg.from_agent}${c.reset} ${c.dim}${msg.created_at}${c.reset}`);
    if (msg.task_id) console.log(`  ${c.dim}re: ${msg.task_id}${c.reset}`);
    console.log(`  ${msg.message}\n`);
  }
}

export function mailReadCommand(mailId: string): void {
  const db = getDb();
  ensureMailboxTable(db);

  const id = parseInt(mailId, 10);
  const result = db.prepare('UPDATE mailbox SET read = 1 WHERE id = ?').run(id);

  if (result.changes === 0) {
    console.error(`${c.red}Message not found: ${mailId}${c.reset}`);
    process.exit(1);
  }

  afterWrite(db);
  console.log(`${c.green}✓${c.reset} Marked message #${id} as read`);
}

export interface MailListOptions {
  agent?: string;
  all?: boolean;
}

export function mailListCommand(opts?: MailListOptions): void {
  const db = getDb();
  ensureMailboxTable(db);

  const agent = opts?.agent || process.env.TRAK_AGENT || 'human';

  let query: string;
  let params: any[];

  if (opts?.all) {
    query = 'SELECT * FROM mailbox ORDER BY created_at DESC LIMIT 50';
    params = [];
  } else {
    query = `SELECT * FROM mailbox WHERE (to_agent = ? OR to_agent = 'all') ORDER BY created_at DESC LIMIT 50`;
    params = [agent];
  }

  const messages = db.prepare(query).all(...params) as any[];

  if (messages.length === 0) {
    console.log(`${c.dim}No messages${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}📨 Messages${c.reset}${opts?.all ? ' (all)' : ` for ${agent}`}\n`);

  for (const msg of messages) {
    const readMark = msg.read ? c.dim : c.bold;
    const unread = msg.read ? '' : ' 🔵';
    console.log(`  ${readMark}#${msg.id}${c.reset} ${c.cyan}${msg.from_agent}${c.reset} → ${msg.to_agent}${unread} ${c.dim}${msg.created_at}${c.reset}`);
    if (msg.task_id) console.log(`    ${c.dim}re: ${msg.task_id}${c.reset}`);
    console.log(`    ${msg.message}`);
    console.log();
  }
}
