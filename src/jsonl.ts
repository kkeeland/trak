/**
 * JSONL export/import — event-based and snapshot-based sync layer
 * 
 * Supports two formats:
 * 1. Event log: Each line is {"op":"create|update|close|dep_add|dep_rm|log|claim","id":"task-id","ts":"ISO","data":{...changed fields only...}}
 * 2. Legacy snapshots: Full task state dumps (one JSON object per line)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { Task, LogEntry, Dependency, TaskClaim } from './db.js';

const JSONL_FILE = 'trak.jsonl';

// Event log types
export type EventOp = 'create' | 'update' | 'close' | 'dep_add' | 'dep_rm' | 'log' | 'claim';

export interface EventLogEntry {
  op: EventOp;
  id: string;
  ts: string; // ISO timestamp
  data: Record<string, any>; // Changed fields only
}

export interface EventLogOptions {
  compactThreshold?: number; // After this many events, write a compact snapshot
}

export interface JsonlTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  project: string;
  blocked_by: string;
  parent_id: string | null;
  epic_id: string | null;
  is_epic: number;
  created_at: string;
  updated_at: string;
  agent_session: string;
  tokens_used: number;
  cost_usd: number;
  tags: string;
  assigned_to: string;
  verified_by: string;
  verification_status: string;
  created_from: string;
  verify_command: string;
  wip_snapshot: string;
  autonomy: string;
  budget_usd: number | null;
  tokens_in: number;
  tokens_out: number;
  model_used: string;
  duration_seconds: number;
  retry_count: number;
  max_retries: number;
  last_failure_reason: string;
  retry_after: string | null;
  journal: { timestamp: string; entry: string; author: string }[];
  deps: string[];  // parent_ids this task depends on
  claims: { agent: string; model: string; status: string; claimed_at: string; released_at: string | null }[];
}

/**
 * Get the JSONL file path for a given DB path
 */
export function getJsonlPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), JSONL_FILE);
}

/**
 * Append an event to the JSONL file.
 * Used for incremental event logging instead of full snapshots.
 */
export function appendEvent(dbPath: string, event: EventLogEntry): void {
  const jsonlPath = getJsonlPath(dbPath);
  const eventLine = JSON.stringify(event) + '\n';
  fs.appendFileSync(jsonlPath, eventLine);
}

/**
 * Check if JSONL file contains events (vs legacy snapshots).
 * Events have an "op" field, snapshots have task fields like "title".
 */
export function isEventLog(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return true; // New files start as event logs
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const firstLine = content.split('\n').find(l => l.trim().length > 0);
  if (!firstLine) return true;
  
  try {
    const record = JSON.parse(firstLine);
    return 'op' in record && 'ts' in record;
  } catch {
    return false;
  }
}

/**
 * Compact an event log into a single snapshot.
 * Replaces the JSONL file with full task snapshots.
 */
export function compactToSnapshots(db: Database.Database, dbPath: string): void {
  exportToJsonl(db, dbPath);
}

/**
 * Export all tasks to JSONL format as complete snapshots.
 * Each line is a complete task snapshot with embedded journal, deps, and claims.
 * This is used for periodic compaction or legacy compatibility.
 */
export function exportToJsonl(db: Database.Database, dbPath: string): void {
  const jsonlPath = getJsonlPath(dbPath);
  
  const tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at ASC').all() as Task[];
  const allDeps = db.prepare('SELECT * FROM dependencies').all() as Dependency[];
  const allLogs = db.prepare('SELECT * FROM task_log ORDER BY timestamp ASC').all() as LogEntry[];
  const allClaims = db.prepare('SELECT * FROM task_claims ORDER BY claimed_at ASC').all() as TaskClaim[];

  // Index deps and logs by task_id for fast lookup
  const depsByChild = new Map<string, string[]>();
  for (const d of allDeps) {
    const arr = depsByChild.get(d.child_id) || [];
    arr.push(d.parent_id);
    depsByChild.set(d.child_id, arr);
  }

  const logsByTask = new Map<string, { timestamp: string; entry: string; author: string }[]>();
  for (const l of allLogs) {
    const arr = logsByTask.get(l.task_id) || [];
    arr.push({ timestamp: l.timestamp, entry: l.entry, author: l.author });
    logsByTask.set(l.task_id, arr);
  }

  const claimsByTask = new Map<string, { agent: string; model: string; status: string; claimed_at: string; released_at: string | null }[]>();
  for (const c of allClaims) {
    const arr = claimsByTask.get(c.task_id) || [];
    arr.push({ agent: c.agent, model: c.model, status: c.status, claimed_at: c.claimed_at, released_at: c.released_at });
    claimsByTask.set(c.task_id, arr);
  }

  const lines: string[] = [];
  for (const t of tasks) {
    const record: JsonlTask = {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      project: t.project,
      blocked_by: t.blocked_by,
      parent_id: t.parent_id,
      epic_id: t.epic_id,
      is_epic: t.is_epic,
      created_at: t.created_at,
      updated_at: t.updated_at,
      agent_session: t.agent_session,
      tokens_used: t.tokens_used,
      cost_usd: t.cost_usd,
      tags: t.tags,
      assigned_to: t.assigned_to,
      verified_by: t.verified_by,
      verification_status: t.verification_status,
      created_from: t.created_from,
      verify_command: t.verify_command,
      wip_snapshot: t.wip_snapshot,
      autonomy: t.autonomy || 'manual',
      budget_usd: t.budget_usd ?? null,
      tokens_in: t.tokens_in ?? 0,
      tokens_out: t.tokens_out ?? 0,
      model_used: t.model_used || '',
      duration_seconds: t.duration_seconds ?? 0,
      retry_count: (t as any).retry_count ?? 0,
      max_retries: (t as any).max_retries ?? 3,
      last_failure_reason: (t as any).last_failure_reason || '',
      retry_after: (t as any).retry_after || null,
      journal: logsByTask.get(t.id) || [],
      deps: depsByChild.get(t.id) || [],
      claims: claimsByTask.get(t.id) || [],
    };
    lines.push(JSON.stringify(record));
  }

  // Atomic write via temp file
  const tmpPath = jsonlPath + '.tmp';
  fs.writeFileSync(tmpPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  fs.renameSync(tmpPath, jsonlPath);
}

/**
 * Parse a JSONL file — handles both event logs and legacy snapshots
 */
export function parseJsonl(filePath: string): JsonlTask[] {
  if (isEventLog(filePath)) {
    return parseEventLogToSnapshots(filePath);
  } else {
    return parseLegacySnapshots(filePath);
  }
}

/**
 * Parse legacy snapshot format (for backward compatibility)
 */
function parseLegacySnapshots(filePath: string): JsonlTask[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as JsonlTask;
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1}`);
    }
  });
}

/**
 * Parse an event log and replay it into task snapshots
 */
function parseEventLogToSnapshots(filePath: string): JsonlTask[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  
  // Parse all events
  const events: EventLogEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const event = JSON.parse(lines[i]) as EventLogEntry;
      if (!event.op || !event.id || !event.ts) {
        // Might be a legacy snapshot line mixed in - skip for now
        continue;
      }
      events.push(event);
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1}`);
    }
  }
  
  // Replay events into task state
  const tasks = new Map<string, JsonlTask>();
  const deps = new Map<string, Set<string>>(); // child_id -> Set<parent_id>
  
  for (const event of events) {
    switch (event.op) {
      case 'create':
        tasks.set(event.id, {
          id: event.id,
          title: event.data.title || '',
          description: event.data.description || '',
          status: event.data.status || 'open',
          priority: event.data.priority ?? 1,
          project: event.data.project || '',
          blocked_by: event.data.blocked_by || '',
          parent_id: event.data.parent_id || null,
          epic_id: event.data.epic_id || null,
          is_epic: event.data.is_epic ?? 0,
          created_at: event.ts,
          updated_at: event.ts,
          agent_session: event.data.agent_session || '',
          tokens_used: event.data.tokens_used ?? 0,
          cost_usd: event.data.cost_usd ?? 0,
          tags: event.data.tags || '',
          assigned_to: event.data.assigned_to || '',
          verified_by: event.data.verified_by || '',
          verification_status: event.data.verification_status || '',
          created_from: event.data.created_from || '',
          verify_command: event.data.verify_command || '',
          wip_snapshot: event.data.wip_snapshot || '',
          autonomy: event.data.autonomy || 'manual',
          budget_usd: event.data.budget_usd ?? null,
          tokens_in: event.data.tokens_in ?? 0,
          tokens_out: event.data.tokens_out ?? 0,
          model_used: event.data.model_used || '',
          duration_seconds: event.data.duration_seconds ?? 0,
          retry_count: event.data.retry_count ?? 0,
          max_retries: event.data.max_retries ?? 3,
          last_failure_reason: event.data.last_failure_reason || '',
          retry_after: event.data.retry_after || null,
          journal: [],
          deps: [],
          claims: []
        });
        break;
        
      case 'update':
        const task = tasks.get(event.id);
        if (task) {
          Object.assign(task, event.data);
          task.updated_at = event.ts;
        }
        break;
        
      case 'close':
        const closeTask = tasks.get(event.id);
        if (closeTask) {
          closeTask.status = event.data.status || 'done';
          closeTask.updated_at = event.ts;
        }
        break;
        
      case 'dep_add':
        if (!deps.has(event.id)) {
          deps.set(event.id, new Set());
        }
        deps.get(event.id)!.add(event.data.parent_id);
        break;
        
      case 'dep_rm':
        const depSet = deps.get(event.id);
        if (depSet) {
          depSet.delete(event.data.parent_id);
        }
        break;
        
      case 'log':
        const logTask = tasks.get(event.id);
        if (logTask) {
          logTask.journal.push({
            timestamp: event.ts,
            entry: event.data.entry,
            author: event.data.author || 'system'
          });
        }
        break;
        
      case 'claim':
        const claimTask = tasks.get(event.id);
        if (claimTask) {
          claimTask.claims.push({
            agent: event.data.agent,
            model: event.data.model || '',
            status: event.data.status || 'claimed',
            claimed_at: event.ts,
            released_at: event.data.released_at || null
          });
        }
        break;
    }
  }
  
  // Convert deps map back to task.deps arrays
  for (const [taskId, parentSet] of deps) {
    const task = tasks.get(taskId);
    if (task) {
      task.deps = Array.from(parentSet);
    }
  }
  
  // Sort journal and claims by timestamp
  for (const task of tasks.values()) {
    task.journal.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    task.claims.sort((a, b) => a.claimed_at.localeCompare(b.claimed_at));
  }
  
  return Array.from(tasks.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * Import from event log file directly (for use in pull command)
 */
export function importEventsFromJsonl(db: Database.Database, filePath: string): { tasks: number; deps: number; logs: number; claims: number } {
  if (!fs.existsSync(filePath)) {
    throw new Error(`JSONL file not found: ${filePath}`);
  }
  
  const records = parseJsonl(filePath); // This handles both events and snapshots
  return importFromJsonl(db, records);
}

/**
 * Rebuild SQLite database from JSONL records.
 * Clears existing data and replaces with JSONL content.
 * Records can come from either event replay or legacy snapshots.
 */
export function importFromJsonl(db: Database.Database, records: JsonlTask[]): { tasks: number; deps: number; logs: number; claims: number } {
  let taskCount = 0;
  let depCount = 0;
  let logCount = 0;
  let claimCount = 0;

  const insertTask = db.prepare(`
    INSERT OR REPLACE INTO tasks (
      id, title, description, status, priority, project, blocked_by, parent_id,
      epic_id, is_epic, created_at, updated_at, agent_session, tokens_used, cost_usd,
      tags, assigned_to, verified_by, verification_status, created_from, verify_command, wip_snapshot,
      autonomy, budget_usd, tokens_in, tokens_out, model_used, duration_seconds,
      retry_count, max_retries, last_failure_reason, retry_after
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDep = db.prepare('INSERT OR IGNORE INTO dependencies (child_id, parent_id) VALUES (?, ?)');
  const insertLog = db.prepare('INSERT INTO task_log (task_id, timestamp, entry, author) VALUES (?, ?, ?, ?)');
  const insertClaim = db.prepare('INSERT INTO task_claims (task_id, agent, model, status, claimed_at, released_at) VALUES (?, ?, ?, ?, ?, ?)');

  const transaction = db.transaction(() => {
    // Clear existing data
    db.exec('DELETE FROM task_claims');
    db.exec('DELETE FROM task_log');
    db.exec('DELETE FROM dependencies');
    db.exec('DELETE FROM tasks');

    for (const r of records) {
      insertTask.run(
        r.id, r.title, r.description || '', r.status || 'open', r.priority ?? 1,
        r.project || '', r.blocked_by || '', r.parent_id || null,
        r.epic_id || null, r.is_epic ?? 0, r.created_at, r.updated_at,
        r.agent_session || '', r.tokens_used ?? 0, r.cost_usd ?? 0,
        r.tags || '', r.assigned_to || '', r.verified_by || '',
        r.verification_status || '', r.created_from || '', r.verify_command || '',
        r.wip_snapshot || '', r.autonomy || 'manual', r.budget_usd ?? null,
        r.tokens_in ?? 0, r.tokens_out ?? 0, r.model_used || '', r.duration_seconds ?? 0,
        r.retry_count ?? 0, r.max_retries ?? 3, r.last_failure_reason || '', r.retry_after || null
      );
      taskCount++;

      if (r.deps) {
        for (const parentId of r.deps) {
          insertDep.run(r.id, parentId);
          depCount++;
        }
      }

      if (r.journal) {
        for (const j of r.journal) {
          insertLog.run(r.id, j.timestamp, j.entry, j.author || 'imported');
          logCount++;
        }
      }

      if (r.claims) {
        for (const cl of r.claims) {
          insertClaim.run(r.id, cl.agent, cl.model || '', cl.status || 'claimed', cl.claimed_at, cl.released_at || null);
          claimCount++;
        }
      }
    }
  });

  transaction();

  return { tasks: taskCount, deps: depCount, logs: logCount, claims: claimCount };
}
