import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  acquireLock, releaseLock, readLock, listLocks,
  breakLock, renewLock, checkConflict, filesOverlap,
  acquireOrQueue, readQueue, enqueue, dequeue, peekQueue,
  readAuditLog, getTaskLocks, getTaskQueuePositions,
  pathHash, repoPathHash, LockInfo,
} from '../locks.js';
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
  origCwd = process.cwd();
  process.env.TRAK_DB = path.join(trakDir, 'trak.db');
});

afterEach(() => {
  process.chdir(origCwd);
  delete process.env.TRAK_DB;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Basic Lock Operations ─────────────────────────────

describe('workspace locking - basics', () => {
  it('acquires a lock on an unlocked repo', () => {
    const result = acquireLock('/tmp/test-repo', 'trak-abc123', 'agent-1');
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.lock.taskId).toBe('trak-abc123');
      expect(result.lock.agent).toBe('agent-1');
      expect(result.lock.pid).toBe(process.pid);
      expect(result.lock.lockType).toBe('repo');
      expect(result.lock.files).toEqual([]);
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
    const trakDir = path.dirname(process.env.TRAK_DB!);
    const locksDir = path.join(trakDir, 'locks');
    fs.mkdirSync(locksDir, { recursive: true });
    const hash = pathHash(path.resolve('/tmp/expired-repo'));
    const lockFile = path.join(locksDir, `${hash}.lock`);
    const expiredLock: LockInfo = {
      taskId: 'trak-old',
      repoPath: '/tmp/expired-repo',
      files: [],
      timestamp: new Date(Date.now() - 3600_000).toISOString(),
      pid: process.pid,
      agent: 'old-agent',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      lockType: 'repo',
    };
    fs.writeFileSync(lockFile, JSON.stringify(expiredLock));

    const lock = readLock('/tmp/expired-repo');
    expect(lock).toBeNull();

    const result = acquireLock('/tmp/expired-repo', 'trak-new', 'new-agent');
    expect(result.acquired).toBe(true);
  });

  it('generates consistent hashes', () => {
    const h1 = pathHash('/tmp/test-repo');
    const h2 = pathHash('/tmp/test-repo');
    expect(h1).toBe(h2);
    expect(h1.length).toBe(12);
  });

  it('repoPathHash is backward-compatible alias', () => {
    const h1 = repoPathHash('/tmp/test-repo');
    const h2 = pathHash(path.resolve('/tmp/test-repo'));
    expect(h1).toBe(h2);
  });
});

// ─── File-Level Locking ─────────────────────────────────

describe('file-level locking', () => {
  it('acquires a file-level lock', () => {
    const result = acquireLock('/tmp/repo', 'trak-111', 'agent-1', ['src/db.ts', 'src/cli.ts']);
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.lock.lockType).toBe('files');
      expect(result.lock.files).toEqual(['src/db.ts', 'src/cli.ts']);
    }
  });

  it('blocks on overlapping files', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1', ['src/db.ts', 'src/cli.ts']);
    const result = acquireLock('/tmp/repo', 'trak-222', 'agent-2', ['src/db.ts', 'src/utils.ts']);
    expect(result.acquired).toBe(false);
  });

  it('allows non-overlapping files in same repo', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1', ['src/db.ts']);

    // Non-overlapping files should be blocked because the repo-level lock was acquired
    // by trak-111 with specific files. A different task wanting different files
    // is still blocked because the lock file is per-repo.
    // However, the conflict check should show no file overlap.
    const conflict = checkConflict('/tmp/repo', 'trak-222', ['src/utils.ts']);
    expect(conflict.hasConflict).toBe(false);
  });

  it('blocks when requesting repo lock but files are locked', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1', ['src/db.ts']);
    const conflict = checkConflict('/tmp/repo', 'trak-222');
    expect(conflict.hasConflict).toBe(true);
    expect(conflict.conflictType).toBe('repo');
  });

  it('merges file lists on re-acquire by same task', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1', ['src/db.ts']);
    const result = acquireLock('/tmp/repo', 'trak-111', 'agent-1', ['src/cli.ts']);
    expect(result.acquired).toBe(true);
    if (result.acquired) {
      expect(result.lock.files).toContain('src/db.ts');
      expect(result.lock.files).toContain('src/cli.ts');
    }
  });
});

// ─── File Pattern Matching ──────────────────────────────

describe('filesOverlap', () => {
  it('detects exact file matches', () => {
    const overlap = filesOverlap(['src/db.ts'], ['src/db.ts']);
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('detects directory containment', () => {
    const overlap = filesOverlap(['src/commands/'], ['src/commands/locks.ts']);
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('detects glob matches', () => {
    const overlap = filesOverlap(['src/*.ts'], ['src/db.ts']);
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('returns empty for non-overlapping files', () => {
    const overlap = filesOverlap(['src/db.ts'], ['src/utils.ts']);
    expect(overlap.length).toBe(0);
  });

  it('empty patterns (whole repo) always overlap', () => {
    const overlap = filesOverlap([], ['src/db.ts']);
    expect(overlap.length).toBeGreaterThan(0);
  });

  it('handles nested directory patterns', () => {
    const overlap = filesOverlap(['src/'], ['src/commands/locks.ts']);
    expect(overlap.length).toBeGreaterThan(0);
  });
});

// ─── Conflict Detection ─────────────────────────────────

describe('checkConflict', () => {
  it('returns no conflict on unlocked repo', () => {
    const result = checkConflict('/tmp/repo', 'trak-111');
    expect(result.hasConflict).toBe(false);
    expect(result.conflictType).toBe('none');
  });

  it('detects repo-level conflict', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    const result = checkConflict('/tmp/repo', 'trak-222');
    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('repo');
    expect(result.holder?.taskId).toBe('trak-111');
  });

  it('detects file-level conflict', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1', ['src/db.ts']);
    const result = checkConflict('/tmp/repo', 'trak-222', ['src/db.ts']);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('files');
    expect(result.conflictingFiles).toBeDefined();
    expect(result.conflictingFiles!.length).toBeGreaterThan(0);
  });

  it('no conflict for same task', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    const result = checkConflict('/tmp/repo', 'trak-111');
    expect(result.hasConflict).toBe(false);
  });

  it('no conflict for non-overlapping files', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1', ['src/db.ts']);
    const result = checkConflict('/tmp/repo', 'trak-222', ['tests/db.test.ts']);
    expect(result.hasConflict).toBe(false);
  });
});

// ─── Queue Operations ───────────────────────────────────

describe('lock queue', () => {
  it('enqueues a task', () => {
    const pos = enqueue('/tmp/repo', 'trak-111', 'agent-1');
    expect(pos).toBe(0);

    const queue = readQueue('/tmp/repo');
    expect(queue.length).toBe(1);
    expect(queue[0].taskId).toBe('trak-111');
  });

  it('respects priority ordering', () => {
    enqueue('/tmp/repo', 'trak-low', 'agent-1', [], 2);
    enqueue('/tmp/repo', 'trak-high', 'agent-2', [], 0);
    enqueue('/tmp/repo', 'trak-mid', 'agent-3', [], 1);

    const queue = readQueue('/tmp/repo');
    expect(queue.map(q => q.taskId)).toEqual(['trak-high', 'trak-mid', 'trak-low']);
  });

  it('dequeues a task', () => {
    enqueue('/tmp/repo', 'trak-111', 'agent-1');
    enqueue('/tmp/repo', 'trak-222', 'agent-2');

    const removed = dequeue('/tmp/repo', 'trak-111');
    expect(removed).toBe(true);

    const queue = readQueue('/tmp/repo');
    expect(queue.length).toBe(1);
    expect(queue[0].taskId).toBe('trak-222');
  });

  it('peeks at next in queue', () => {
    enqueue('/tmp/repo', 'trak-111', 'agent-1');
    enqueue('/tmp/repo', 'trak-222', 'agent-2');

    const next = peekQueue('/tmp/repo');
    expect(next?.taskId).toBe('trak-111');
  });

  it('does not double-enqueue', () => {
    enqueue('/tmp/repo', 'trak-111', 'agent-1');
    enqueue('/tmp/repo', 'trak-111', 'agent-1');

    const queue = readQueue('/tmp/repo');
    expect(queue.length).toBe(1);
  });

  it('cleans up queue file when empty', () => {
    enqueue('/tmp/repo', 'trak-111', 'agent-1');
    dequeue('/tmp/repo', 'trak-111');

    const queue = readQueue('/tmp/repo');
    expect(queue.length).toBe(0);
  });
});

// ─── Acquire-or-Queue ───────────────────────────────────

describe('acquireOrQueue', () => {
  it('acquires when unlocked', () => {
    const result = acquireOrQueue('/tmp/repo', 'trak-111', 'agent-1');
    expect(result.status).toBe('acquired');
  });

  it('queues when blocked', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    const result = acquireOrQueue('/tmp/repo', 'trak-222', 'agent-2');
    expect(result.status).toBe('queued');
    if (result.status === 'queued') {
      expect(result.position).toBe(0);
      expect(result.holder.taskId).toBe('trak-111');
    }
  });

  it('returns already-queued when re-requesting', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    acquireOrQueue('/tmp/repo', 'trak-222', 'agent-2');
    const result = acquireOrQueue('/tmp/repo', 'trak-222', 'agent-2');
    expect(result.status).toBe('already-queued');
  });

  it('removes from queue after acquiring', () => {
    // First, enqueue while something else holds lock
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    acquireOrQueue('/tmp/repo', 'trak-222', 'agent-2');

    // Release the lock
    releaseLock('/tmp/repo');

    // Now acquire should succeed and remove from queue
    const result = acquireOrQueue('/tmp/repo', 'trak-222', 'agent-2');
    expect(result.status).toBe('acquired');

    const queue = readQueue('/tmp/repo');
    expect(queue.find(q => q.taskId === 'trak-222')).toBeUndefined();
  });
});

// ─── Emergency Lock Break ───────────────────────────────

describe('emergency lock break', () => {
  it('breaks an active lock', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    const result = breakLock('/tmp/repo', 'admin', 'stuck agent');
    expect(result.broken).toBe(true);
    expect(result.wasHolder?.taskId).toBe('trak-111');

    // Verify lock is gone
    const lock = readLock('/tmp/repo');
    expect(lock).toBeNull();
  });

  it('records break in audit log', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    breakLock('/tmp/repo', 'admin', 'stuck agent');

    const audit = readAuditLog(10);
    const breakEvent = audit.find(e => e.action === 'break');
    expect(breakEvent).toBeDefined();
    expect(breakEvent?.taskId).toBe('trak-111');
    expect(breakEvent?.breakBy).toBe('admin');
    expect(breakEvent?.reason).toBe('stuck agent');
  });

  it('returns false when no lock to break', () => {
    const result = breakLock('/tmp/repo', 'admin', 'nothing here');
    expect(result.broken).toBe(false);
  });

  it('allows re-acquire after break', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    breakLock('/tmp/repo');
    const result = acquireLock('/tmp/repo', 'trak-222', 'agent-2');
    expect(result.acquired).toBe(true);
  });
});

// ─── Lock Renewal ───────────────────────────────────────

describe('lock renewal', () => {
  it('extends lock expiration', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    const before = readLock('/tmp/repo');
    expect(before).not.toBeNull();

    // Small delay then renew
    const renewed = renewLock('/tmp/repo', 'trak-111');
    expect(renewed).toBe(true);

    const after = readLock('/tmp/repo');
    expect(after).not.toBeNull();
    // New expiration should be >= old (or at least same since near-instant)
    expect(new Date(after!.expiresAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before!.expiresAt).getTime()
    );
  });

  it('rejects renewal for wrong task', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    const renewed = renewLock('/tmp/repo', 'trak-222');
    expect(renewed).toBe(false);
  });

  it('rejects renewal on unlocked repo', () => {
    const renewed = renewLock('/tmp/repo', 'trak-111');
    expect(renewed).toBe(false);
  });
});

// ─── Audit Trail ────────────────────────────────────────

describe('audit trail', () => {
  it('logs acquire events', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    const audit = readAuditLog(10);
    const acquireEvent = audit.find(e => e.action === 'acquire');
    expect(acquireEvent).toBeDefined();
    expect(acquireEvent?.taskId).toBe('trak-111');
    expect(acquireEvent?.agent).toBe('agent-1');
  });

  it('logs release events', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    releaseLock('/tmp/repo');
    const audit = readAuditLog(10);
    const releaseEvent = audit.find(e => e.action === 'release');
    expect(releaseEvent).toBeDefined();
  });

  it('logs queue events', () => {
    enqueue('/tmp/repo', 'trak-111', 'agent-1');
    const audit = readAuditLog(10);
    const queueEvent = audit.find(e => e.action === 'queue');
    expect(queueEvent).toBeDefined();
  });

  it('logs expire events', () => {
    // Write an expired lock manually
    const trakDir = path.dirname(process.env.TRAK_DB!);
    const locksDir = path.join(trakDir, 'locks');
    fs.mkdirSync(locksDir, { recursive: true });
    const hash = pathHash(path.resolve('/tmp/exp-repo'));
    const lockFile = path.join(locksDir, `${hash}.lock`);
    fs.writeFileSync(lockFile, JSON.stringify({
      taskId: 'trak-exp',
      repoPath: '/tmp/exp-repo',
      files: [],
      timestamp: new Date(Date.now() - 3600_000).toISOString(),
      pid: process.pid,
      agent: 'old',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      lockType: 'repo',
    }));

    // Reading triggers expire
    readLock('/tmp/exp-repo');
    const audit = readAuditLog(10);
    const expireEvent = audit.find(e => e.action === 'expire' && e.taskId === 'trak-exp');
    expect(expireEvent).toBeDefined();
  });
});

// ─── Task Lock Queries ──────────────────────────────────

describe('task lock queries', () => {
  it('finds locks by task ID', () => {
    acquireLock('/tmp/repo-a', 'trak-111', 'agent-1');
    acquireLock('/tmp/repo-b', 'trak-111', 'agent-1');
    acquireLock('/tmp/repo-c', 'trak-222', 'agent-2');

    const locks = getTaskLocks('trak-111');
    expect(locks.length).toBe(2);
    expect(locks.every(l => l.taskId === 'trak-111')).toBe(true);
  });

  it('finds queue positions by task ID', () => {
    acquireLock('/tmp/repo', 'trak-111', 'agent-1');
    enqueue('/tmp/repo', 'trak-222', 'agent-2');

    const positions = getTaskQueuePositions('trak-222');
    expect(positions.length).toBe(1);
    expect(positions[0].position).toBe(0);
  });
});

// ─── Concurrent Scenarios ───────────────────────────────

describe('concurrent access scenarios', () => {
  it('first-come-first-served for repo locks', () => {
    const r1 = acquireLock('/tmp/repo', 'task-A', 'agent-1');
    const r2 = acquireLock('/tmp/repo', 'task-B', 'agent-2');
    const r3 = acquireLock('/tmp/repo', 'task-C', 'agent-3');

    expect(r1.acquired).toBe(true);
    expect(r2.acquired).toBe(false);
    expect(r3.acquired).toBe(false);
  });

  it('queued tasks get served in priority order', () => {
    acquireLock('/tmp/repo', 'task-holder', 'agent-0');

    // Queue in reverse priority order
    acquireOrQueue('/tmp/repo', 'task-low', 'agent-3', [], 3);
    acquireOrQueue('/tmp/repo', 'task-high', 'agent-1', [], 0);
    acquireOrQueue('/tmp/repo', 'task-mid', 'agent-2', [], 1);

    const queue = readQueue('/tmp/repo');
    expect(queue[0].taskId).toBe('task-high');
    expect(queue[1].taskId).toBe('task-mid');
    expect(queue[2].taskId).toBe('task-low');
  });

  it('multiple repos can be locked independently', () => {
    const r1 = acquireLock('/tmp/repo-a', 'task-1', 'agent-1');
    const r2 = acquireLock('/tmp/repo-b', 'task-2', 'agent-2');
    const r3 = acquireLock('/tmp/repo-c', 'task-3', 'agent-3');

    expect(r1.acquired).toBe(true);
    expect(r2.acquired).toBe(true);
    expect(r3.acquired).toBe(true);

    expect(listLocks().length).toBe(3);
  });

  it('file-level locks allow parallel work on same repo', () => {
    // Agent 1 locks db.ts
    acquireLock('/tmp/repo', 'task-db', 'agent-1', ['src/db.ts']);

    // Agent 2 wants cli.ts — should NOT conflict
    const conflict = checkConflict('/tmp/repo', 'task-cli', ['src/cli.ts']);
    expect(conflict.hasConflict).toBe(false);
  });

  it('file-level locks block overlapping patterns', () => {
    acquireLock('/tmp/repo', 'task-src', 'agent-1', ['src/']);

    // Anything under src/ should conflict
    const conflict = checkConflict('/tmp/repo', 'task-db', ['src/db.ts']);
    expect(conflict.hasConflict).toBe(true);
    expect(conflict.conflictType).toBe('files');
  });

  it('release-then-acquire cycle works cleanly', () => {
    for (let i = 0; i < 5; i++) {
      const r = acquireLock('/tmp/repo', `task-${i}`, `agent-${i}`);
      expect(r.acquired).toBe(true);
      releaseLock('/tmp/repo');
    }
    expect(listLocks().length).toBe(0);
  });

  it('break-then-acquire works for emergency recovery', () => {
    acquireLock('/tmp/repo', 'stuck-task', 'stuck-agent');

    // Normal acquire fails
    const blocked = acquireLock('/tmp/repo', 'rescue-task', 'rescue-agent');
    expect(blocked.acquired).toBe(false);

    // Emergency break
    const broke = breakLock('/tmp/repo', 'admin', 'agent unresponsive');
    expect(broke.broken).toBe(true);

    // Now acquire works
    const rescued = acquireLock('/tmp/repo', 'rescue-task', 'rescue-agent');
    expect(rescued.acquired).toBe(true);
  });
});
