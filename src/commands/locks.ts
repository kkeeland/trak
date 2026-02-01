import { listLocks, releaseLock, readLock, LockInfo } from '../locks.js';
import { c, formatDate } from '../utils.js';
import path from 'path';

export function locksCommand(): void {
  const locks = listLocks();

  if (locks.length === 0) {
    console.log(`${c.dim}No active workspace locks.${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}🔒 Active Workspace Locks${c.reset}\n`);

  for (const lock of locks) {
    const remaining = Math.max(0, Math.round(
      (new Date(lock.expiresAt).getTime() - Date.now()) / 60_000
    ));
    const repoName = path.basename(lock.repoPath);

    console.log(`  ${c.yellow}${repoName}${c.reset} ${c.dim}(${lock.repoPath})${c.reset}`);
    console.log(`    Task: ${c.bold}${lock.taskId}${c.reset}  Agent: ${lock.agent}  PID: ${lock.pid}`);
    console.log(`    Locked: ${formatDate(lock.timestamp)}  Expires in: ${c.cyan}${remaining}m${c.reset}`);
    console.log();
  }

  console.log(`${c.dim}Force-release: trak unlock <repo-path>${c.reset}\n`);
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
