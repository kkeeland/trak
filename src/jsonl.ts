/**
 * JSONL export/import — snapshot-based sync layer
 * 
 * Exports full task state to .trak/trak.jsonl (one JSON object per line).
 * This is a snapshot dump, not an event log.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { Task, LogEntry, Dependency, TaskClaim } from './db.js';

const JSONL_FILE = 'trak.jsonl';

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
 * Export all tasks to JSONL format.
 * Each line is a complete task snapshot with embedded journal, deps, and claims.
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
 * Parse a JSONL file and return task records
 */
export function parseJsonl(filePath: string): JsonlTask[] {
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
 * Rebuild SQLite database from JSONL records.
 * Clears existing data and replaces with JSONL content.
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
      autonomy, budget_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        r.wip_snapshot || '', r.autonomy || 'manual', r.budget_usd ?? null
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
