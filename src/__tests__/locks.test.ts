import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { acquireLock, releaseLock, readLock, listLocks, repoPathHash, LockInfo } from '../locks.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use a temp dir as a fake trak workspace
let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trak-lock-test-'));
  const trakDir = path.join(tmpDir, '.trak');
  fs.mkdirSync(trakDir, { recursive: true });
  // Set TRAK_DB so findTrakDir works
  origCwd = process.cwd();
  process.env.TRAK_DB = path.join(trakDir, 'trak.db');
});

afterEach(() => {
  process.chdir(origCwd);
  delete process.env.TRAK_DB;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('workspace locking', () => {
  it('acquires a lock on an unlocked repo', () => {
    const result = acquireLock('/tmp/test-repo', 'trak-abc123', 'agent-1');
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.lock.taskId).toBe('trak-abc123');
      expect(result.lock.agent).toBe('agent-1');
      expect(result.lock.pid).toBe(process.pid);
    }
  });

  it('blocks when repo is already locked by different task', () => {
    const first = acquireLock('/tmp/test-repo', 'trak-111', 'agent-1');
    expect(first.acquired).toBe(true);

    const second = acquireLock('/tmp/test-repo', 'trak-222', 'agent-2');
    expect(second.acquired).toBe(false);
    if (!second.acquired) {
      expect(second.holder.taskId).toBe('trak-111');
    }
  });

  it('allows same task to re-acquire', () => {
    const first = acquireLock('/tmp/test-repo', 'trak-111', 'agent-1');
    expect(first.acquired).toBe(true);

    const second = acquireLock('/tmp/test-repo', 'trak-111', 'agent-1');
    expect(second.acquired).toBe(true);
  });

  it('releases a lock', () => {
    acquireLock('/tmp/test-repo', 'trak-111', 'agent-1');
    const released = releaseLock('/tmp/test-repo');
    expect(released).toBe(true);

    // Now another task can acquire
    const result = acquireLock('/tmp/test-repo', 'trak-222', 'agent-2');
    expect(result.acquired).toBe(true);
  });

  it('lists active locks', () => {
    acquireLock('/tmp/repo-a', 'trak-aaa', 'agent-1');
    acquireLock('/tmp/repo-b', 'trak-bbb', 'agent-2');

    const locks = listLocks();
    expect(locks.length).toBe(2);
    const taskIds = locks.map(l => l.taskId).sort();
    expect(taskIds).toEqual(['trak-aaa', 'trak-bbb']);
  });

  it('auto-expires old locks', () => {
    // Manually write an expired lock
    const trakDir = path.dirname(process.env.TRAK_DB!);
    const locksDir = path.join(trakDir, 'locks');
    fs.mkdirSync(locksDir, { recursive: true });
    const hash = repoPathHash('/tmp/expired-repo');
    const lockFile = path.join(locksDir, `${hash}.lock`);
    const expiredLock: LockInfo = {
      taskId: 'trak-old',
      repoPath: '/tmp/expired-repo',
      timestamp: new Date(Date.now() - 3600_000).toISOString(),
      pid: process.pid,
      agent: 'old-agent',
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired 1s ago
    };
    fs.writeFileSync(lockFile, JSON.stringify(expiredLock));

    // Reading should return null (expired)
    const lock = readLock('/tmp/expired-repo');
    expect(lock).toBeNull();

    // And acquiring should succeed
    const result = acquireLock('/tmp/expired-repo', 'trak-new', 'new-agent');
    expect(result.acquired).toBe(true);
  });

  it('generates consistent hashes', () => {
    const h1 = repoPathHash('/tmp/test-repo');
    const h2 = repoPathHash('/tmp/test-repo');
    expect(h1).toBe(h2);
    expect(h1.length).toBe(12);
  });
});
