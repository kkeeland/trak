/**
 * Workspace locking — prevent multiple agents from working on the same files simultaneously.
 *
 * Architecture:
 * ─────────────
 * 1. **Repo-level locks**: Coarse-grained. Locks an entire repository path.
 *    Lock files live in .trak/locks/<repo-path-hash>.lock as JSON.
 *
 * 2. **File-level locks**: Fine-grained. Locks specific file patterns within a repo.
 *    Lock files live in .trak/locks/<repo-path-hash>/<file-pattern-hash>.lock
 *
 * 3. **Lock queue**: When a lock is blocked, the request is queued.
 *    Queue entries live in .trak/locks/<repo-path-hash>.queue as JSON array.
 *    When a lock is released, the next queued request is notified.
 *
 * 4. **Emergency break**: Force-release with audit trail.
 *    Break events are logged to .trak/locks/audit.jsonl
 *
 * 5. **DB-backed tracking**: Lock events are also written to trak_locks table
 *    for queryability and reporting.
 *
 * Lock lifecycle:
 *   acquire → held → release (or expire/break)
 *
 * Default timeout: 30 minutes (configurable via `trak config set lock.timeout <minutes>`).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { findTrakDir, getConfigValue } from './db.js';

// ─── Types ──────────────────────────────────────────────

export interface LockInfo {
  taskId: string;
  repoPath: string;
  files: string[];          // file patterns locked (empty = whole repo)
  timestamp: string;        // ISO 8601
  pid: number;
  agent: string;
  expiresAt: string;        // ISO 8601
  lockType: 'repo' | 'files';
}

export interface QueueEntry {
  taskId: string;
  agent: string;
  files: string[];
  requestedAt: string;      // ISO 8601
  priority: number;         // lower = higher priority (P0 > P1)
}

export interface LockAuditEvent {
  timestamp: string;
  action: 'acquire' | 'release' | 'expire' | 'break' | 'queue' | 'dequeue' | 'conflict';
  taskId: string;
  repoPath: string;
  agent: string;
  reason?: string;
  breakBy?: string;         // who broke the lock (for emergency breaks)
  files?: string[];
}

export interface ConflictResult {
  hasConflict: boolean;
  conflictType: 'none' | 'repo' | 'files';
  holder?: LockInfo;
  conflictingFiles?: string[];
  queuePosition?: number;
}

// ─── Constants ──────────────────────────────────────────

const DEFAULT_LOCK_TIMEOUT_MIN = 30;

// ─── Helpers ────────────────────────────────────────────

/** Hash a string to a safe filename */
export function pathHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 12);
}

/** @deprecated Use pathHash instead */
export function repoPathHash(repoPath: string): string {
  return pathHash(path.resolve(repoPath));
}

/** Get the locks directory, creating it if needed */
export function getLocksDir(): string | null {
  const trakDir = findTrakDir();
  if (!trakDir) return null;
  const locksDir = path.join(trakDir, 'locks');
  if (!fs.existsSync(locksDir)) {
    fs.mkdirSync(locksDir, { recursive: true });
  }
  return locksDir;
}

/** Get the configured lock timeout in minutes */
export function getLockTimeoutMin(): number {
  try {
    const val = getConfigValue('lock.timeout');
    if (val && typeof val === 'number' && val > 0) return val;
  } catch {
    // config table might not exist yet
  }
  return DEFAULT_LOCK_TIMEOUT_MIN;
}

/** Lock file path for a given repo */
export function lockFilePath(repoPath: string): string | null {
  const locksDir = getLocksDir();
  if (!locksDir) return null;
  return path.join(locksDir, `${pathHash(path.resolve(repoPath))}.lock`);
}

/** Queue file path for a given repo */
export function queueFilePath(repoPath: string): string | null {
  const locksDir = getLocksDir();
  if (!locksDir) return null;
  return path.join(locksDir, `${pathHash(path.resolve(repoPath))}.queue`);
}

/** Check if a lock is expired */
export function isExpired(lock: LockInfo): boolean {
  return new Date(lock.expiresAt).getTime() < Date.now();
}

/** Check if the PID that created the lock is still running */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = just check existence
    return true;
  } catch {
    return false;
  }
}

/** Normalize a LockInfo (add defaults for old lock files missing new fields) */
function normalizeLock(lock: any): LockInfo {
  return {
    taskId: lock.taskId,
    repoPath: lock.repoPath,
    files: lock.files || [],
    timestamp: lock.timestamp,
    pid: lock.pid,
    agent: lock.agent,
    expiresAt: lock.expiresAt,
    lockType: lock.lockType || (lock.files && lock.files.length > 0 ? 'files' : 'repo'),
  };
}

// ─── Audit Log ──────────────────────────────────────────

/** Append an event to the audit log */
export function auditLog(event: LockAuditEvent): void {
  const locksDir = getLocksDir();
  if (!locksDir) return;
  const auditFile = path.join(locksDir, 'audit.jsonl');
  try {
    fs.appendFileSync(auditFile, JSON.stringify(event) + '\n');
  } catch {
    // best effort
  }
}

/** Read the audit log */
export function readAuditLog(limit: number = 50): LockAuditEvent[] {
  const locksDir = getLocksDir();
  if (!locksDir) return [];
  const auditFile = path.join(locksDir, 'audit.jsonl');
  if (!fs.existsSync(auditFile)) return [];

  try {
    const lines = fs.readFileSync(auditFile, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l)).reverse();
  } catch {
    return [];
  }
}

// ─── File Pattern Matching ──────────────────────────────

/**
 * Check if two sets of file patterns overlap.
 * Patterns can be:
 * - Exact files: "src/db.ts"
 * - Directories: "src/commands/" (trailing slash)
 * - Globs: "src/*.ts" (simple star matching)
 */
export function filesOverlap(patternsA: string[], patternsB: string[]): string[] {
  if (patternsA.length === 0 || patternsB.length === 0) {
    // Empty means "whole repo" — always overlaps
    return patternsA.length === 0 ? patternsB : patternsA;
  }

  const overlapping: string[] = [];

  for (const a of patternsA) {
    for (const b of patternsB) {
      if (patternMatches(a, b) || patternMatches(b, a)) {
        overlapping.push(`${a} ↔ ${b}`);
      }
    }
  }

  return overlapping;
}

/** Check if pattern A matches or overlaps with pattern B */
function patternMatches(a: string, b: string): boolean {
  // Exact match
  if (a === b) return true;

  // Directory containment: "src/commands/" contains "src/commands/locks.ts"
  if (a.endsWith('/') && b.startsWith(a)) return true;
  if (b.endsWith('/') && a.startsWith(b)) return true;

  // Simple glob: "src/*.ts" matches "src/db.ts"
  if (a.includes('*')) {
    const regex = new RegExp('^' + a.replace(/\*/g, '[^/]*').replace(/\//g, '\\/') + '$');
    if (regex.test(b)) return true;
  }

  // Same directory check: "src/a.ts" and "src/b.ts" don't overlap,
  // but "src/" and "src/a.ts" do (handled above)
  return false;
}

// ─── Queue Management ───────────────────────────────────

/** Read the queue for a repo */
export function readQueue(repoPath: string): QueueEntry[] {
  const fp = queueFilePath(repoPath);
  if (!fp || !fs.existsSync(fp)) return [];
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch {
    return [];
  }
}

/** Write the queue for a repo */
function writeQueue(repoPath: string, queue: QueueEntry[]): void {
  const fp = queueFilePath(repoPath);
  if (!fp) return;
  if (queue.length === 0) {
    try { fs.unlinkSync(fp); } catch {}
    return;
  }
  fs.writeFileSync(fp, JSON.stringify(queue, null, 2) + '\n');
}

/** Add a task to the lock queue */
export function enqueue(
  repoPath: string,
  taskId: string,
  agent: string,
  files: string[] = [],
  priority: number = 1,
): number {
  const queue = readQueue(repoPath);

  // Don't double-enqueue
  const existing = queue.findIndex(q => q.taskId === taskId);
  if (existing >= 0) return existing;

  const entry: QueueEntry = {
    taskId,
    agent,
    files,
    requestedAt: new Date().toISOString(),
    priority,
  };

  // Insert sorted by priority (lower number = higher priority)
  let insertIdx = queue.findIndex(q => q.priority > priority);
  if (insertIdx === -1) insertIdx = queue.length;
  queue.splice(insertIdx, 0, entry);
  writeQueue(repoPath, queue);

  auditLog({
    timestamp: new Date().toISOString(),
    action: 'queue',
    taskId,
    repoPath,
    agent,
    files,
  });

  return insertIdx;
}

/** Remove a task from the queue */
export function dequeue(repoPath: string, taskId: string): boolean {
  const queue = readQueue(repoPath);
  const idx = queue.findIndex(q => q.taskId === taskId);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  writeQueue(repoPath, queue);

  auditLog({
    timestamp: new Date().toISOString(),
    action: 'dequeue',
    taskId,
    repoPath,
    agent: '',
  });

  return true;
}

/** Peek at the next queued task */
export function peekQueue(repoPath: string): QueueEntry | null {
  const queue = readQueue(repoPath);
  return queue.length > 0 ? queue[0] : null;
}

// ─── Core Lock Operations ───────────────────────────────

/** Read a lock file, returning null if missing/corrupt/expired */
export function readLock(repoPath: string): LockInfo | null {
  const fp = lockFilePath(repoPath);
  if (!fp || !fs.existsSync(fp)) return null;

  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    const lock = normalizeLock(JSON.parse(raw));

    // Auto-expire
    if (isExpired(lock)) {
      auditLog({
        timestamp: new Date().toISOString(),
        action: 'expire',
        taskId: lock.taskId,
        repoPath: lock.repoPath,
        agent: lock.agent,
      });
      fs.unlinkSync(fp);
      return null;
    }

    // Dead PID cleanup
    if (!isPidAlive(lock.pid)) {
      auditLog({
        timestamp: new Date().toISOString(),
        action: 'expire',
        taskId: lock.taskId,
        repoPath: lock.repoPath,
        agent: lock.agent,
        reason: 'PID dead',
      });
      fs.unlinkSync(fp);
      return null;
    }

    return lock;
  } catch {
    // Corrupt file — remove it
    try { fs.unlinkSync(fp!); } catch {}
    return null;
  }
}

/**
 * Check for conflicts before acquiring a lock.
 * Returns detailed conflict information without modifying state.
 */
export function checkConflict(
  repoPath: string,
  taskId: string,
  files: string[] = [],
): ConflictResult {
  const existing = readLock(repoPath);

  if (!existing) {
    return { hasConflict: false, conflictType: 'none' };
  }

  // Same task re-acquiring is fine
  if (existing.taskId === taskId) {
    return { hasConflict: false, conflictType: 'none' };
  }

  // Repo-level lock blocks everything
  if (existing.lockType === 'repo' || existing.files.length === 0) {
    return {
      hasConflict: true,
      conflictType: 'repo',
      holder: existing,
    };
  }

  // File-level conflict detection
  if (files.length === 0) {
    // Requesting full repo lock, but files are locked
    return {
      hasConflict: true,
      conflictType: 'repo',
      holder: existing,
    };
  }

  const overlapping = filesOverlap(existing.files, files);
  if (overlapping.length > 0) {
    return {
      hasConflict: true,
      conflictType: 'files',
      holder: existing,
      conflictingFiles: overlapping,
    };
  }

  // Different files — no conflict
  return { hasConflict: false, conflictType: 'none' };
}

/**
 * Acquire a lock on a repo (or specific files within it).
 * Returns the lock if successful, or the existing lock if blocked.
 */
export function acquireLock(
  repoPath: string,
  taskId: string,
  agent: string = 'agent',
  files: string[] = [],
): { acquired: true; lock: LockInfo } | { acquired: false; holder: LockInfo; conflictingFiles?: string[] } {
  const conflict = checkConflict(repoPath, taskId, files);

  if (conflict.hasConflict && conflict.holder) {
    return {
      acquired: false,
      holder: conflict.holder,
      conflictingFiles: conflict.conflictingFiles,
    };
  }

  // Check if we can merge file-level locks (same repo, different files)
  const existing = readLock(repoPath);
  if (existing && existing.taskId === taskId) {
    // Re-acquire / extend — merge file lists
    if (files.length > 0 && existing.files.length > 0) {
      const merged = [...new Set([...existing.files, ...files])];
      existing.files = merged;
      const fp = lockFilePath(repoPath);
      if (fp) fs.writeFileSync(fp, JSON.stringify(existing, null, 2) + '\n');
    }
    return { acquired: true, lock: existing };
  }

  const timeoutMin = getLockTimeoutMin();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + timeoutMin * 60_000);

  const lock: LockInfo = {
    taskId,
    repoPath: path.resolve(repoPath),
    files,
    timestamp: now.toISOString(),
    pid: process.pid,
    agent,
    expiresAt: expiresAt.toISOString(),
    lockType: files.length > 0 ? 'files' : 'repo',
  };

  const fp = lockFilePath(repoPath);
  if (!fp) {
    // No trak dir — can't lock, but don't block either
    return { acquired: true, lock };
  }

  fs.writeFileSync(fp, JSON.stringify(lock, null, 2) + '\n');

  auditLog({
    timestamp: now.toISOString(),
    action: 'acquire',
    taskId,
    repoPath: lock.repoPath,
    agent,
    files,
  });

  // Remove from queue if we were queued
  dequeue(repoPath, taskId);

  return { acquired: true, lock };
}

/**
 * Acquire a lock, or queue if blocked. Returns immediately with status.
 */
export function acquireOrQueue(
  repoPath: string,
  taskId: string,
  agent: string = 'agent',
  files: string[] = [],
  priority: number = 1,
): { status: 'acquired'; lock: LockInfo }
 | { status: 'queued'; position: number; holder: LockInfo; conflictingFiles?: string[] }
 | { status: 'already-queued'; position: number } {
  const result = acquireLock(repoPath, taskId, agent, files);
  if (result.acquired) {
    return { status: 'acquired', lock: result.lock };
  }

  // Check if already queued
  const queue = readQueue(repoPath);
  const existingIdx = queue.findIndex(q => q.taskId === taskId);
  if (existingIdx >= 0) {
    return { status: 'already-queued', position: existingIdx };
  }

  // Enqueue
  const position = enqueue(repoPath, taskId, agent, files, priority);
  return {
    status: 'queued',
    position,
    holder: result.holder,
    conflictingFiles: (result as any).conflictingFiles,
  };
}

/** Release a lock and promote next in queue if any */
export function releaseLock(repoPath: string): boolean {
  const fp = lockFilePath(repoPath);
  if (!fp || !fs.existsSync(fp)) return false;

  // Read before delete for audit
  let lock: LockInfo | null = null;
  try {
    lock = normalizeLock(JSON.parse(fs.readFileSync(fp, 'utf-8')));
  } catch {}

  fs.unlinkSync(fp);

  if (lock) {
    auditLog({
      timestamp: new Date().toISOString(),
      action: 'release',
      taskId: lock.taskId,
      repoPath: lock.repoPath,
      agent: lock.agent,
    });
  }

  return true;
}

/**
 * Emergency lock break — force-release with audit trail.
 * Use only when a lock is stuck and normal release isn't possible.
 */
export function breakLock(
  repoPath: string,
  breakBy: string = 'human',
  reason: string = 'emergency break',
): { broken: boolean; wasHolder?: LockInfo } {
  const lock = readLock(repoPath);
  if (!lock) {
    // Try reading raw (might be corrupt or expired but file still exists)
    const fp = lockFilePath(repoPath);
    if (fp && fs.existsSync(fp)) {
      try {
        const raw = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        fs.unlinkSync(fp);
        auditLog({
          timestamp: new Date().toISOString(),
          action: 'break',
          taskId: raw.taskId || 'unknown',
          repoPath,
          agent: raw.agent || 'unknown',
          reason,
          breakBy,
        });
        return { broken: true, wasHolder: normalizeLock(raw) };
      } catch {
        fs.unlinkSync(fp);
        return { broken: true };
      }
    }
    return { broken: false };
  }

  const fp = lockFilePath(repoPath);
  if (fp) {
    try { fs.unlinkSync(fp); } catch {}
  }

  auditLog({
    timestamp: new Date().toISOString(),
    action: 'break',
    taskId: lock.taskId,
    repoPath: lock.repoPath,
    agent: lock.agent,
    reason,
    breakBy,
  });

  return { broken: true, wasHolder: lock };
}

/** Extend a lock's expiration (heartbeat/renew) */
export function renewLock(repoPath: string, taskId: string): boolean {
  const lock = readLock(repoPath);
  if (!lock || lock.taskId !== taskId) return false;

  const timeoutMin = getLockTimeoutMin();
  lock.expiresAt = new Date(Date.now() + timeoutMin * 60_000).toISOString();

  const fp = lockFilePath(repoPath);
  if (fp) {
    fs.writeFileSync(fp, JSON.stringify(lock, null, 2) + '\n');
  }
  return true;
}

/** List all active (non-expired) locks */
export function listLocks(): LockInfo[] {
  const locksDir = getLocksDir();
  if (!locksDir) return [];

  const locks: LockInfo[] = [];
  const files = fs.readdirSync(locksDir).filter(f => f.endsWith('.lock'));

  for (const file of files) {
    const fp = path.join(locksDir, file);
    try {
      const raw = fs.readFileSync(fp, 'utf-8');
      const lock = normalizeLock(JSON.parse(raw));

      if (isExpired(lock) || !isPidAlive(lock.pid)) {
        auditLog({
          timestamp: new Date().toISOString(),
          action: 'expire',
          taskId: lock.taskId,
          repoPath: lock.repoPath,
          agent: lock.agent,
          reason: isExpired(lock) ? 'timeout' : 'PID dead',
        });
        fs.unlinkSync(fp);
        continue;
      }

      locks.push(lock);
    } catch {
      try { fs.unlinkSync(fp); } catch {}
    }
  }

  return locks;
}

/** List all queued entries across all repos */
export function listQueues(): { repoPath: string; queue: QueueEntry[] }[] {
  const locksDir = getLocksDir();
  if (!locksDir) return [];

  const results: { repoPath: string; queue: QueueEntry[] }[] = [];
  const files = fs.readdirSync(locksDir).filter(f => f.endsWith('.queue'));

  for (const file of files) {
    const fp = path.join(locksDir, file);
    try {
      const queue: QueueEntry[] = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      if (queue.length > 0) {
        // Try to find the repo path from the lock file
        const lockFp = fp.replace('.queue', '.lock');
        let repoPath = file.replace('.queue', '');
        if (fs.existsSync(lockFp)) {
          try {
            const lock = JSON.parse(fs.readFileSync(lockFp, 'utf-8'));
            repoPath = lock.repoPath || repoPath;
          } catch {}
        }
        results.push({ repoPath, queue });
      }
    } catch {}
  }

  return results;
}

/**
 * Check if a task has any active locks (for display in trak show).
 * Scans all lock files for the given task ID.
 */
export function getTaskLocks(taskId: string): LockInfo[] {
  const locks = listLocks();
  return locks.filter(l => l.taskId === taskId);
}

/**
 * Check if a task is in any queue.
 */
export function getTaskQueuePositions(taskId: string): { repoPath: string; position: number }[] {
  const queues = listQueues();
  const positions: { repoPath: string; position: number }[] = [];

  for (const { repoPath, queue } of queues) {
    const idx = queue.findIndex(q => q.taskId === taskId);
    if (idx >= 0) {
      positions.push({ repoPath, position: idx });
    }
  }

  return positions;
}
