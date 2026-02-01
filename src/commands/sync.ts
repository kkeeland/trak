import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db.js';
import { exportToJsonl, getJsonlPath } from '../jsonl.js';
import { c } from '../utils.js';

export interface SyncOptions {
  push?: boolean;
}

function findDbPath(): string | null {
  if (process.env.TRAK_DB && fs.existsSync(process.env.TRAK_DB)) return process.env.TRAK_DB;
  
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, '.trak', 'trak.db');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getRepoRoot(dbPath: string): string | null {
  const trakDir = path.dirname(dbPath);
  const projectDir = path.dirname(trakDir);
  try {
    return execSync('git rev-parse --show-toplevel', {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function syncCommand(opts: SyncOptions): void {
  const dbPath = findDbPath();
  if (!dbPath) {
    console.error(`${c.red}No trak database found. Run \`trak init\` first.${c.reset}`);
    process.exit(1);
  }

  const db = getDb();
  
  // 1. Export to JSONL
  exportToJsonl(db, dbPath);
  const jsonlPath = getJsonlPath(dbPath);
  
  if (!fs.existsSync(jsonlPath)) {
    console.error(`${c.red}JSONL export failed${c.reset}`);
    process.exit(1);
  }

  const repoRoot = getRepoRoot(dbPath);
  if (!repoRoot) {
    console.log(`${c.green}✓${c.reset} Exported to ${jsonlPath}`);
    console.log(`${c.yellow}⚠ Not in a git repository — skipping commit${c.reset}`);
    return;
  }

  // 2. Git add
  try {
    execSync(`git add "${jsonlPath}"`, {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e: any) {
    console.error(`${c.red}git add failed: ${e.message}${c.reset}`);
    process.exit(1);
  }

  // 3. Check if there are staged changes to the JSONL file
  try {
    execSync(`git diff --cached --quiet "${jsonlPath}"`, {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // If this succeeds, there are no changes
    console.log(`${c.dim}Nothing to sync — JSONL is up to date${c.reset}`);
    return;
  } catch {
    // Exit code 1 means there ARE changes — continue
  }

  // 4. Commit
  const taskCount = db.prepare('SELECT COUNT(*) as cnt FROM tasks').get() as { cnt: number };
  const msg = `trak: sync ${taskCount.cnt} tasks`;
  
  try {
    execSync(`git commit -m "${msg}" -- "${jsonlPath}"`, {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e: any) {
    console.error(`${c.red}git commit failed: ${e.message}${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.green}✓${c.reset} Synced — committed ${c.bold}trak.jsonl${c.reset} (${taskCount.cnt} tasks)`);

  // 5. Push if requested
  if (opts.push) {
    try {
      execSync('git push', {
        cwd: repoRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
      });
      console.log(`${c.green}✓${c.reset} Pushed to remote`);
    } catch (e: any) {
      console.error(`${c.yellow}⚠ Push failed: ${e.message}${c.reset}`);
      console.error(`${c.dim}Commit was created locally. Push manually when ready.${c.reset}`);
    }
  }
}
