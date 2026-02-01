/**
 * Workspace locking — prevent multiple agents from working on the same repo simultaneously.
 *
 * Lock files live in .trak/locks/<repo-path-hash>.lock as JSON:
 *   { taskId, repoPath, timestamp, pid, agent, expiresAt }
 *
 * Default timeout: 30 minutes (configurable via `trak config set lock.timeout <minutes>`).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { findTrakDir } from './db.js';
import { getConfigValue } from './db.js';

export interface LockInfo {
  taskId: string;
  repoPath: string;
  timestamp: string;     // ISO 8601
  pid: number;
  agent: string;
  expiresAt: string;     // ISO 8601
}

const DEFAULT_LOCK_TIMEOUT_MIN = 30;

/** Hash a repo path to a safe filename */
export function repoPathHash(repoPath: string): string {
  return crypto.createHash('sha256').update(path.resolve(repoPath)).digest('hex').slice(0, 12);
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
  return path.join(locksDir, `${repoPathHash(repoPath)}.lock`);
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

/** Read a lock file, returning null if missing/corrupt/expired */
export function readLock(repoPath: string): LockInfo | null {
  const fp = lockFilePath(repoPath);
  if (!fp || !fs.existsSync(fp)) return null;

  try {
    const raw = fs.readFileSync(fp, 'utf-8');
    const lock: LockInfo = JSON.parse(raw);

    // Auto-expire
    if (isExpired(lock)) {
      fs.unlinkSync(fp);
      return null;
    }

    // Dead PID cleanup
    if (!isPidAlive(lock.pid)) {
      fs.unlinkSync(fp);
      return null;
    }

    return lock;
  } catch {
    // Corrupt file — remove it
    try { fs.unlinkSync(fp); } catch {}
    return null;
  }
}

/** Acquire a lock on a repo for a task. Returns the lock if successful, or the existing lock if blocked. */
export function acquireLock(
  repoPath: string,
  taskId: string,
  agent: string = 'agent',
): { acquired: true; lock: LockInfo } | { acquired: false; holder: LockInfo } {
  const existing = readLock(repoPath);
  if (existing) {
    // Same task re-acquiring is fine
    if (existing.taskId === taskId) {
      return { acquired: true, lock: existing };
    }
    return { acquired: false, holder: existing };
  }

  const timeoutMin = getLockTimeoutMin();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + timeoutMin * 60_000);

  const lock: LockInfo = {
    taskId,
    repoPath: path.resolve(repoPath),
    timestamp: now.toISOString(),
    pid: process.pid,
    agent,
    expiresAt: expiresAt.toISOString(),
  };

  const fp = lockFilePath(repoPath);
  if (!fp) {
    // No trak dir — can't lock, but don't block either
    return { acquired: true, lock };
  }

  fs.writeFileSync(fp, JSON.stringify(lock, null, 2) + '\n');
  return { acquired: true, lock };
}

/** Release a lock */
export function releaseLock(repoPath: string): boolean {
  const fp = lockFilePath(repoPath);
  if (!fp || !fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
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
      const lock: LockInfo = JSON.parse(raw);

      if (isExpired(lock) || !isPidAlive(lock.pid)) {
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
