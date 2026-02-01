import fs from 'fs';
import path from 'path';
import { getDb, initDb, afterWrite } from '../db.js';
import { JsonlTask, importFromJsonl, getJsonlPath, exportToJsonl } from '../jsonl.js';
import { c } from '../utils.js';

/**
 * Parse a conflicted JSONL file with git conflict markers.
 * Returns { ours, theirs } arrays of JsonlTask records.
 */
export function parseConflictedJsonl(content: string): { ours: JsonlTask[]; theirs: JsonlTask[] } {
  const ours: JsonlTask[] = [];
  const theirs: JsonlTask[] = [];

  const lines = content.split('\n');
  let section: 'before' | 'ours' | 'theirs' | 'after' = 'before';

  for (const line of lines) {
    const trimmed = line.trim();

    // Git conflict markers
    if (trimmed.startsWith('<<<<<<<')) {
      section = 'ours';
      continue;
    }
    if (trimmed === '=======') {
      section = 'theirs';
      continue;
    }
    if (trimmed.startsWith('>>>>>>>')) {
      section = 'after'; // back to non-conflicted
      continue;
    }

    if (!trimmed) continue;

    try {
      const record = JSON.parse(trimmed) as JsonlTask;
      switch (section) {
        case 'before':
        case 'after':
          // Non-conflicted lines go into both sides
          ours.push(record);
          theirs.push(record);
          break;
        case 'ours':
          ours.push(record);
          break;
        case 'theirs':
          theirs.push(record);
          break;
      }
    } catch {
      // Skip unparseable lines (conflict markers, empty lines, etc.)
    }
  }

  return { ours, theirs };
}

/**
 * Merge two arrays of JSONL records using last-write-wins for tasks.
 * Journal/log entries are unioned (deduplicated by timestamp+entry).
 * Claims are unioned (deduplicated by agent+claimed_at).
 * Deps are unioned.
 */
export function mergeJsonlRecords(ours: JsonlTask[], theirs: JsonlTask[]): JsonlTask[] {
  const oursMap = new Map<string, JsonlTask>();
  const theirsMap = new Map<string, JsonlTask>();

  for (const r of ours) oursMap.set(r.id, r);
  for (const r of theirs) theirsMap.set(r.id, r);

  // Collect all unique IDs preserving insertion order
  const allIds = new Set<string>();
  for (const r of ours) allIds.add(r.id);
  for (const r of theirs) allIds.add(r.id);

  const merged: JsonlTask[] = [];

  for (const id of allIds) {
    const o = oursMap.get(id);
    const t = theirsMap.get(id);

    if (o && !t) {
      merged.push(o);
      continue;
    }
    if (t && !o) {
      merged.push(t);
      continue;
    }

    // Both exist — last-write-wins on the task fields
    const oTime = new Date(o!.updated_at).getTime();
    const tTime = new Date(t!.updated_at).getTime();
    const winner = tTime > oTime ? { ...t! } : { ...o! };

    // Merge journal entries from both sides (union, dedup by timestamp+entry)
    const journalKey = (j: { timestamp: string; entry: string }) => `${j.timestamp}::${j.entry}`;
    const journalSet = new Set<string>();
    const mergedJournal: { timestamp: string; entry: string; author: string }[] = [];
    for (const j of [...(o!.journal || []), ...(t!.journal || [])]) {
      const key = journalKey(j);
      if (!journalSet.has(key)) {
        journalSet.add(key);
        mergedJournal.push(j);
      }
    }
    // Sort by timestamp
    mergedJournal.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    winner.journal = mergedJournal;

    // Merge deps (union)
    const depsSet = new Set<string>([...(o!.deps || []), ...(t!.deps || [])]);
    winner.deps = [...depsSet];

    // Merge claims (union, dedup by agent+claimed_at)
    const claimKey = (cl: { agent: string; claimed_at: string }) => `${cl.agent}::${cl.claimed_at}`;
    const claimSet = new Set<string>();
    const mergedClaims: { agent: string; model: string; status: string; claimed_at: string; released_at: string | null }[] = [];
    for (const cl of [...(o!.claims || []), ...(t!.claims || [])]) {
      const key = claimKey(cl);
      if (!claimSet.has(key)) {
        claimSet.add(key);
        mergedClaims.push(cl);
      }
    }
    mergedClaims.sort((a, b) => a.claimed_at.localeCompare(b.claimed_at));
    winner.claims = mergedClaims;

    merged.push(winner);
  }

  // Sort by created_at for consistent output
  merged.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return merged;
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

export function mergeCommand(): void {
  // Find the JSONL file
  const dbPath = findDbPath();
  let jsonlPath: string;

  if (dbPath) {
    jsonlPath = getJsonlPath(dbPath);
  } else {
    jsonlPath = path.join(process.cwd(), '.trak', 'trak.jsonl');
  }

  if (!fs.existsSync(jsonlPath)) {
    console.error(`${c.red}No trak.jsonl found at ${jsonlPath}${c.reset}`);
    process.exit(1);
  }

  const content = fs.readFileSync(jsonlPath, 'utf-8');

  // Check if the file actually has conflict markers
  const hasConflicts = content.includes('<<<<<<<') && content.includes('=======') && content.includes('>>>>>>>');

  if (!hasConflicts) {
    console.log(`${c.dim}No conflict markers found in ${jsonlPath} — nothing to merge${c.reset}`);
    console.log(`${c.dim}Tip: use 'trak pull' to rebuild DB from a clean JSONL${c.reset}`);
    return;
  }

  // Parse conflicted file
  console.log(`${c.dim}Parsing conflicted JSONL...${c.reset}`);
  const { ours, theirs } = parseConflictedJsonl(content);
  console.log(`  Ours: ${ours.length} records, Theirs: ${theirs.length} records`);

  // Merge
  const merged = mergeJsonlRecords(ours, theirs);
  console.log(`  Merged: ${merged.length} records`);

  // Count how many were resolved by last-write-wins
  const oursMap = new Map(ours.map(r => [r.id, r]));
  const theirsMap = new Map(theirs.map(r => [r.id, r]));
  let conflicts = 0;
  for (const r of merged) {
    if (oursMap.has(r.id) && theirsMap.has(r.id)) {
      const o = oursMap.get(r.id)!;
      const t = theirsMap.get(r.id)!;
      if (o.updated_at !== t.updated_at) conflicts++;
    }
  }
  if (conflicts > 0) {
    console.log(`  ${c.yellow}${conflicts} task(s) resolved by last-write-wins${c.reset}`);
  }

  // Write clean JSONL
  const lines = merged.map(r => JSON.stringify(r));
  const tmpPath = jsonlPath + '.tmp';
  fs.writeFileSync(tmpPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  fs.renameSync(tmpPath, jsonlPath);
  console.log(`${c.green}✓${c.reset} Wrote clean ${path.basename(jsonlPath)}`);

  // Re-import into SQLite
  let db;
  try {
    db = getDb();
  } catch {
    db = initDb();
  }

  const result = importFromJsonl(db, merged);
  afterWrite(db);

  console.log(`${c.green}✓${c.reset} Rebuilt database from merged JSONL`);
  console.log(`  ${result.tasks} tasks, ${result.deps} dependencies, ${result.logs} log entries, ${result.claims} claims`);
  console.log(`\n${c.dim}Tip: run 'git add .trak/trak.jsonl && git commit' to finalize the merge${c.reset}`);
}
