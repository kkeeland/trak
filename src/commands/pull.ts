import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getDb, initDb, afterWrite } from '../db.js';
import { importEventsFromJsonl, getJsonlPath } from '../jsonl.js';
import { c } from '../utils.js';

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

export function pullCommand(): void {
  // 1. Git pull
  let repoRoot: string;
  try {
    repoRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    console.error(`${c.red}Not in a git repository${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.dim}Pulling from remote...${c.reset}`);
  try {
    const pullOutput = execSync('git pull --rebase', {
      cwd: repoRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    if (pullOutput.includes('Already up to date')) {
      console.log(`${c.dim}Already up to date${c.reset}`);
    } else {
      console.log(`${c.green}✓${c.reset} Pulled latest changes`);
    }
  } catch (e: any) {
    console.error(`${c.red}git pull failed: ${e.stderr || e.message}${c.reset}`);
    process.exit(1);
  }

  // 2. Find JSONL file
  const dbPath = findDbPath();
  let jsonlPath: string;

  if (dbPath) {
    jsonlPath = getJsonlPath(dbPath);
  } else {
    // No DB yet — look for JSONL in .trak/
    jsonlPath = path.join(process.cwd(), '.trak', 'trak.jsonl');
  }

  if (!fs.existsSync(jsonlPath)) {
    console.log(`${c.dim}No trak.jsonl found — nothing to import${c.reset}`);
    return;
  }

  // 3. Import from JSONL
  let db;
  try {
    db = getDb();
  } catch {
    // DB doesn't exist yet — init it
    db = initDb();
  }

  let result;
  try {
    result = importEventsFromJsonl(db, jsonlPath);
  } catch (e: any) {
    console.error(`${c.red}Failed to import JSONL: ${e.message}${c.reset}`);
    process.exit(1);
  }
  afterWrite(db);

  console.log(`${c.green}✓${c.reset} Rebuilt database from JSONL`);
  console.log(`  ${result.tasks} tasks, ${result.deps} dependencies, ${result.logs} log entries, ${result.claims} claims`);
}
