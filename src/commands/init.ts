import { initDb, dbExists, getDbPath } from '../db.js';
import { c } from '../utils.js';

export function initCommand(): void {
  if (dbExists()) {
    console.log(`${c.yellow}⚠ trak database already exists${c.reset}`);
    return;
  }
  initDb();
  console.log(`${c.green}✓${c.reset} Initialized trak database at ${c.dim}.trak/trak.db${c.reset}`);
}
