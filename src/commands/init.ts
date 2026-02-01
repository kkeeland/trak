import { initDb, dbExists, getDbPath, getGlobalDbDir } from '../db.js';
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

  if (dbExists()) {
    console.log(`${c.yellow}⚠ trak database already exists${c.reset}`);
    return;
  }
  initDb();

  // Create .trak/.gitignore to exclude SQLite but track JSONL
  const gitignorePath = path.join(process.cwd(), '.trak', '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '# Track JSONL (portable), ignore SQLite (binary)\ntrak.db\ntrak.db-journal\ntrak.db-wal\ntrak.db-shm\n!trak.jsonl\n');
  }

  console.log(`${c.green}✓${c.reset} Initialized trak database at ${c.dim}.trak/trak.db${c.reset}`);
}
