#!/usr/bin/env npx tsx
/**
 * Migration script: Import tasks from a beads workspace into trak.
 * 
 * Usage:
 *   npx tsx scripts/migrate-from-beads.ts <path-to-.beads-dir-or-issues.jsonl>
 * 
 * Or via trak CLI (hidden command):
 *   trak import-beads .beads/
 */

import { execSync } from 'child_process';
import path from 'path';

const beadsPath = process.argv[2];
if (!beadsPath) {
  console.error('Usage: npx tsx scripts/migrate-from-beads.ts <path>');
  console.error('  <path> can be a .beads/ directory or an issues.jsonl file');
  process.exit(1);
}

const trakBin = path.resolve(__dirname, '../dist/cli.js');
try {
  const out = execSync(`node ${trakBin} import-beads "${beadsPath}"`, {
    encoding: 'utf-8',
    stdio: 'inherit',
  });
} catch (e: any) {
  process.exit(e.status || 1);
}
