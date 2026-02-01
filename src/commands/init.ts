import { initDb, getGlobalDbDir, findTrakDir } from '../db.js';
import { c } from '../utils.js';
import path from 'path';
import fs from 'fs';

export function initCommand(opts?: { global?: boolean }): void {
  const isGlobal = opts?.global ?? false;

  if (isGlobal) {
    const globalDir = getGlobalDbDir();
    const globalDbPath = path.join(globalDir, 'trak.db');
    if (fs.existsSync(globalDbPath)) {
      console.log(`${c.yellow}⚠ Global trak database already exists at ${globalDbPath}${c.reset}`);
      return;
    }
    initDb(true);
    console.log(`${c.green}✓${c.reset} Initialized global trak database at ${c.dim}${globalDbPath}${c.reset}`);
    return;
  }

  // Check if .trak/ already exists locally (in CWD specifically, not via upward walk)
  const localTrakDir = path.join(process.cwd(), '.trak');
  if (fs.existsSync(path.join(localTrakDir, 'trak.db'))) {
    console.log(`${c.yellow}⚠ trak database already exists at ${localTrakDir}/trak.db${c.reset}`);
    return;
  }

  initDb();

  // Create .trak/.gitignore to exclude SQLite but track JSONL
  const gitignorePath = path.join(localTrakDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '# Track JSONL (portable), ignore SQLite (binary)\ntrak.db\ntrak.db-journal\ntrak.db-wal\ntrak.db-shm\n!trak.jsonl\n');
  }

  // If there's a JSONL file already (e.g. from git clone), auto-import it
  const jsonlPath = path.join(localTrakDir, 'trak.jsonl');
  if (fs.existsSync(jsonlPath)) {
    try {
      const jsonl = require('../jsonl.js');
      const db = require('../db.js').getDb();
      const records = jsonl.parseJsonl(jsonlPath);
      const result = jsonl.importFromJsonl(db, records);
      console.log(`${c.green}✓${c.reset} Initialized trak database at ${c.dim}.trak/trak.db${c.reset}`);
      console.log(`  ${c.dim}Imported ${result.tasks} tasks from existing trak.jsonl${c.reset}`);
      return;
    } catch {
      // Best-effort import
    }
  }

  console.log(`${c.green}✓${c.reset} Initialized trak database at ${c.dim}.trak/trak.db${c.reset}`);
}
