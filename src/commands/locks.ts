import {
  listLocks, releaseLock, readLock, breakLock, renewLock,
  acquireLock, acquireOrQueue, checkConflict,
  readQueue, listQueues, readAuditLog,
  LockInfo, QueueEntry, LockAuditEvent,
} from '../locks.js';
import { c, formatDate } from '../utils.js';
import path from 'path';

export function locksCommand(): void {
  const locks = listLocks();
  const queues = listQueues();

  if (locks.length === 0 && queues.every(q => q.queue.length === 0)) {
    console.log(`${c.dim}No active workspace locks or queues.${c.reset}`);
    return;
  }

  if (locks.length > 0) {
    console.log(`\n${c.bold}🔒 Active Workspace Locks${c.reset}\n`);

    for (const lock of locks) {
      const remaining = Math.max(0, Math.round(
        (new Date(lock.expiresAt).getTime() - Date.now()) / 60_000
      ));
      const repoName = path.basename(lock.repoPath);
      const typeLabel = lock.lockType === 'files' ? `${c.cyan}[files]${c.reset}` : `${c.yellow}[repo]${c.reset}`;

      console.log(`  ${typeLabel} ${c.yellow}${repoName}${c.reset} ${c.dim}(${lock.repoPath})${c.reset}`);
      console.log(`    Task: ${c.bold}${lock.taskId}${c.reset}  Agent: ${lock.agent}  PID: ${lock.pid}`);
      if (lock.files && lock.files.length > 0) {
        console.log(`    Files: ${c.cyan}${lock.files.join(', ')}${c.reset}`);
      }
      console.log(`    Locked: ${formatDate(lock.timestamp)}  Expires in: ${c.cyan}${remaining}m${c.reset}`);

      // Show queue for this repo
      const repoQueue = queues.find(q => q.repoPath === lock.repoPath);
      if (repoQueue && repoQueue.queue.length > 0) {
        console.log(`    ${c.dim}Queue (${repoQueue.queue.length} waiting):${c.reset}`);
        for (let i = 0; i < repoQueue.queue.length; i++) {
          const q = repoQueue.queue[i];
          console.log(`      ${c.dim}${i + 1}.${c.reset} ${q.taskId} ${c.dim}(${q.agent}, P${q.priority})${c.reset}`);
        }
      }
      console.log();
    }
  }

  // Show orphaned queues (queue exists but lock was released/expired)
  const orphanQueues = queues.filter(q =>
    q.queue.length > 0 && !locks.some(l => l.repoPath === q.repoPath)
  );
  if (orphanQueues.length > 0) {
    console.log(`${c.yellow}⚠ Orphaned queues (lock released, tasks still queued):${c.reset}\n`);
    for (const { repoPath, queue } of orphanQueues) {
      console.log(`  ${c.dim}${repoPath}${c.reset}`);
      for (const q of queue) {
        console.log(`    ${q.taskId} ${c.dim}(${q.agent})${c.reset} — can acquire now`);
      }
    }
    console.log();
  }

  console.log(`${c.dim}Commands: trak unlock <repo>  |  trak lock break <repo>  |  trak lock audit${c.reset}\n`);
}

export function unlockCommand(repoPath: string): void {
  // Try direct path first
  let released = releaseLock(repoPath);

  if (!released) {
    // Maybe they passed a basename — try to match
    const locks = listLocks();
    const match = locks.find(l =>
      path.basename(l.repoPath) === repoPath ||
      l.repoPath.includes(repoPath) ||
      l.taskId === repoPath  // also allow unlocking by task ID
    );
    if (match) {
      released = releaseLock(match.repoPath);
    }
  }

  if (released) {
    console.log(`${c.green}✓${c.reset} Lock released for ${c.bold}${repoPath}${c.reset}`);
  } else {
    console.log(`${c.yellow}⚠${c.reset} No active lock found for ${c.bold}${repoPath}${c.reset}`);
  }
}

export function lockAcquireCommand(
  repoPath: string,
  taskId: string,
  opts: { agent?: string; files?: string; queue?: boolean; priority?: string },
): void {
  const agent = opts.agent || 'agent';
  const files = opts.files ? opts.files.split(',').map(f => f.trim()) : [];
  const priority = opts.priority ? parseInt(opts.priority, 10) : 1;

  if (opts.queue) {
    const result = acquireOrQueue(repoPath, taskId, agent, files, priority);

    if (result.status === 'acquired') {
      console.log(`${c.green}✓${c.reset} Lock acquired on ${c.bold}${path.basename(repoPath)}${c.reset} for task ${c.bold}${taskId}${c.reset}`);
      if (files.length > 0) {
        console.log(`  ${c.dim}Files:${c.reset} ${c.cyan}${files.join(', ')}${c.reset}`);
      }
    } else if (result.status === 'queued') {
      console.log(`${c.yellow}⏳${c.reset} Queued at position ${c.bold}#${result.position + 1}${c.reset} for ${c.bold}${path.basename(repoPath)}${c.reset}`);
      console.log(`  ${c.dim}Held by:${c.reset} ${result.holder.taskId} ${c.dim}(${result.holder.agent})${c.reset}`);
      if (result.conflictingFiles) {
        console.log(`  ${c.dim}Conflicts:${c.reset} ${c.red}${result.conflictingFiles.join(', ')}${c.reset}`);
      }
    } else {
      console.log(`${c.dim}Already queued at position #${result.position + 1}${c.reset}`);
    }
  } else {
    const result = acquireLock(repoPath, taskId, agent, files);

    if (result.acquired) {
      console.log(`${c.green}✓${c.reset} Lock acquired on ${c.bold}${path.basename(repoPath)}${c.reset} for task ${c.bold}${taskId}${c.reset}`);
      if (files.length > 0) {
        console.log(`  ${c.dim}Files:${c.reset} ${c.cyan}${files.join(', ')}${c.reset}`);
      }
    } else {
      console.log(`${c.red}✗${c.reset} Lock blocked on ${c.bold}${path.basename(repoPath)}${c.reset}`);
      console.log(`  ${c.dim}Held by:${c.reset} task ${c.bold}${result.holder.taskId}${c.reset} (${result.holder.agent})`);
      if (result.conflictingFiles) {
        console.log(`  ${c.dim}Conflicts:${c.reset} ${c.red}${result.conflictingFiles.join(', ')}${c.reset}`);
      }
      const remaining = Math.max(0, Math.round(
        (new Date(result.holder.expiresAt).getTime() - Date.now()) / 60_000
      ));
      console.log(`  ${c.dim}Expires in:${c.reset} ${remaining}m`);
      console.log(`  ${c.dim}Tip: use --queue to wait, or trak lock break to force${c.reset}`);
      process.exit(1);
    }
  }
}

export function lockReleaseCommand(repoPath: string): void {
  unlockCommand(repoPath);
}

export function lockBreakCommand(
  repoPath: string,
  opts: { agent?: string; reason?: string },
): void {
  const breakBy = opts.agent || 'human';
  const reason = opts.reason || 'emergency break via CLI';

  // Try to match by path, basename, or task ID
  let targetPath = repoPath;
  const locks = listLocks();
  const match = locks.find(l =>
    l.repoPath === repoPath ||
    path.resolve(l.repoPath) === path.resolve(repoPath) ||
    path.basename(l.repoPath) === repoPath ||
    l.repoPath.includes(repoPath) ||
    l.taskId === repoPath
  );
  if (match) targetPath = match.repoPath;

  const result = breakLock(targetPath, breakBy, reason);

  if (result.broken) {
    console.log(`${c.red}⚡${c.reset} Lock ${c.bold}BROKEN${c.reset} on ${c.bold}${targetPath}${c.reset}`);
    if (result.wasHolder) {
      console.log(`  ${c.dim}Was held by:${c.reset} task ${result.wasHolder.taskId} (${result.wasHolder.agent})`);
    }
    console.log(`  ${c.dim}Broken by:${c.reset} ${breakBy}`);
    console.log(`  ${c.dim}Reason:${c.reset} ${reason}`);
    console.log(`  ${c.yellow}⚠ Audit trail recorded in .trak/locks/audit.jsonl${c.reset}`);
  } else {
    console.log(`${c.yellow}⚠${c.reset} No lock found to break for ${c.bold}${repoPath}${c.reset}`);
  }
}

export function lockCheckCommand(
  repoPath: string,
  taskId: string,
  opts: { files?: string },
): void {
  const files = opts.files ? opts.files.split(',').map(f => f.trim()) : [];
  const result = checkConflict(repoPath, taskId, files);

  if (!result.hasConflict) {
    console.log(`${c.green}✓${c.reset} No conflict — ${c.bold}${taskId}${c.reset} can proceed on ${c.bold}${path.basename(repoPath)}${c.reset}`);
  } else {
    console.log(`${c.red}✗${c.reset} Conflict detected (${result.conflictType})`);
    if (result.holder) {
      console.log(`  ${c.dim}Held by:${c.reset} task ${c.bold}${result.holder.taskId}${c.reset} (${result.holder.agent})`);
    }
    if (result.conflictingFiles) {
      console.log(`  ${c.dim}Files:${c.reset} ${c.red}${result.conflictingFiles.join(', ')}${c.reset}`);
    }
    process.exit(1);
  }
}

export function lockRenewCommand(repoPath: string, taskId: string): void {
  const renewed = renewLock(repoPath, taskId);
  if (renewed) {
    console.log(`${c.green}✓${c.reset} Lock renewed for ${c.bold}${taskId}${c.reset} on ${c.bold}${path.basename(repoPath)}${c.reset}`);
  } else {
    console.log(`${c.yellow}⚠${c.reset} No matching lock to renew`);
  }
}

export function lockAuditCommand(opts: { limit?: string }): void {
  const limit = opts.limit ? parseInt(opts.limit, 10) : 25;
  const events = readAuditLog(limit);

  if (events.length === 0) {
    console.log(`${c.dim}No lock audit events.${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}📋 Lock Audit Log${c.reset} (last ${limit})\n`);

  const actionColors: Record<string, string> = {
    acquire: c.green,
    release: c.blue,
    expire: c.dim,
    break: c.red,
    queue: c.yellow,
    dequeue: c.cyan,
    conflict: c.red,
  };

  for (const event of events) {
    const color = actionColors[event.action] || c.white;
    const repo = event.repoPath ? path.basename(event.repoPath) : '?';
    const extra: string[] = [];
    if (event.breakBy) extra.push(`by ${event.breakBy}`);
    if (event.reason) extra.push(event.reason);
    if (event.files && event.files.length > 0) extra.push(`files: ${event.files.join(',')}`);

    console.log(`  ${c.dim}${formatDate(event.timestamp)}${c.reset} ${color}${event.action.padEnd(8)}${c.reset} ${c.bold}${event.taskId}${c.reset} on ${c.cyan}${repo}${c.reset} ${c.dim}(${event.agent})${c.reset}${extra.length ? ` ${c.dim}[${extra.join(', ')}]${c.reset}` : ''}`);
  }
  console.log();
}

export function lockQueueCommand(): void {
  const queues = listQueues();
  const nonEmpty = queues.filter(q => q.queue.length > 0);

  if (nonEmpty.length === 0) {
    console.log(`${c.dim}No tasks in lock queues.${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}⏳ Lock Queues${c.reset}\n`);

  for (const { repoPath, queue } of nonEmpty) {
    const repoName = path.basename(repoPath);
    const lock = readLock(repoPath);
    console.log(`  ${c.yellow}${repoName}${c.reset} ${c.dim}(${repoPath})${c.reset}`);
    if (lock) {
      console.log(`    ${c.dim}Held by:${c.reset} ${lock.taskId} (${lock.agent})`);
    }
    for (let i = 0; i < queue.length; i++) {
      const q = queue[i];
      const files = q.files.length > 0 ? ` ${c.dim}[${q.files.join(',')}]${c.reset}` : '';
      console.log(`    ${c.bold}#${i + 1}${c.reset} ${q.taskId} ${c.dim}(${q.agent}, P${q.priority})${c.reset}${files} — queued ${formatDate(q.requestedAt)}`);
    }
    console.log();
  }
}
