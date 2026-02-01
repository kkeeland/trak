import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TRAK_BIN = path.resolve(__dirname, '../../dist/cli.js');

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trak-sync-test-'));
}

function run(cmd: string, cwd: string, env?: Record<string, string>): string {
  try {
    return execSync(`node ${TRAK_BIN} ${cmd}`, {
      cwd,
      env: { ...process.env, NODE_ENV: 'test', NO_COLOR: '1', HOME: '/tmp/trak-no-home', ...env },
      encoding: 'utf-8',
      timeout: 10000,
    });
  } catch (e: any) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function runOrThrow(cmd: string, cwd: string): string {
  return execSync(`node ${TRAK_BIN} ${cmd}`, {
    cwd,
    env: { ...process.env, NODE_ENV: 'test', NO_COLOR: '1', HOME: '/tmp/trak-no-home' },
    encoding: 'utf-8',
    timeout: 10000,
  });
}

function extractId(output: string): string {
  const match = output.match(/trak-[a-f0-9]{6}/);
  if (!match) throw new Error(`No task ID found in: ${output}`);
  return match[0];
}

let testDir: string;

beforeEach(() => {
  testDir = tmpDir();
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

// ─── JSONL Shadow Write ────────────────────────────────────
describe('JSONL shadow write', () => {
  beforeEach(() => { run('init', testDir); });

  it('creates trak.jsonl on task create', () => {
    run('create "JSONL test"', testDir);
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    expect(fs.existsSync(jsonlPath)).toBe(true);
  });

  it('JSONL contains all task fields', () => {
    const out = run('create "Full fields" --project myproj -p 2 --tags "a,b"', testDir);
    const id = extractId(out);
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record.id).toBe(id);
    expect(record.title).toBe('Full fields');
    expect(record.project).toBe('myproj');
    expect(record.priority).toBe(2);
    expect(record.tags).toBe('a,b');
    expect(record.status).toBe('open');
    expect(record.journal).toHaveLength(1);
    expect(record.journal[0].entry).toContain('Created');
    expect(record.deps).toEqual([]);
    expect(record.claims).toEqual([]);
  });

  it('JSONL updates on status change', () => {
    const out = run('create "Status JSONL"', testDir);
    const id = extractId(out);
    run(`status ${id} wip`, testDir);
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const record = JSON.parse(fs.readFileSync(jsonlPath, 'utf-8').trim());
    expect(record.status).toBe('wip');
  });

  it('JSONL updates on close', () => {
    const out = run('create "Close JSONL"', testDir);
    const id = extractId(out);
    run(`close ${id}`, testDir);
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const record = JSON.parse(fs.readFileSync(jsonlPath, 'utf-8').trim());
    expect(record.status).toBe('done');
    expect(record.journal.length).toBeGreaterThan(1);
  });

  it('JSONL updates on log', () => {
    const out = run('create "Log JSONL"', testDir);
    const id = extractId(out);
    run(`log ${id} "My note"`, testDir);
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const record = JSON.parse(fs.readFileSync(jsonlPath, 'utf-8').trim());
    expect(record.journal.some((j: any) => j.entry === 'My note')).toBe(true);
  });

  it('JSONL includes deps', () => {
    const aOut = run('create "Parent"', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Child"', testDir);
    const bId = extractId(bOut);
    run(`dep add ${bId} ${aId}`, testDir);
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n');
    const child = lines.map(l => JSON.parse(l)).find((r: any) => r.id === bId);
    expect(child.deps).toContain(aId);
  });

  it('multiple tasks produce multiple JSONL lines', () => {
    run('create "Task A"', testDir);
    run('create "Task B"', testDir);
    run('create "Task C"', testDir);
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const lines = fs.readFileSync(jsonlPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);
  });
});

// ─── JSONL Import ──────────────────────────────────────────
describe('JSONL import', () => {
  it('rebuilds DB from JSONL', () => {
    // Create tasks
    run('init', testDir);
    run('create "Import A" --project alpha', testDir);
    const bOut = run('create "Import B"', testDir);
    const bId = extractId(bOut);
    run(`log ${bId} "Note B"`, testDir);

    // Copy JSONL, delete DB
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const dbPath = path.join(testDir, '.trak', 'trak.db');
    const jsonlBackup = path.join(testDir, 'backup.jsonl');
    fs.copyFileSync(jsonlPath, jsonlBackup);
    fs.unlinkSync(dbPath);
    // Remove WAL files too
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}

    // Re-init and import
    run('init', testDir);
    const importOut = run(`import ${jsonlBackup}`, testDir);
    expect(importOut).toContain('2 tasks');

    // Verify data
    const list = run('list --all', testDir);
    expect(list).toContain('Import A');
    expect(list).toContain('Import B');
  });

  it('imports from default .trak/trak.jsonl', () => {
    run('init', testDir);
    run('create "Default import"', testDir);

    // Delete DB but keep JSONL
    const dbPath = path.join(testDir, '.trak', 'trak.db');
    fs.unlinkSync(dbPath);
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}

    // Re-init and import without specifying file
    run('init', testDir);
    const importOut = run('import', testDir);
    expect(importOut).toContain('1 tasks');
  });

  it('import errors on missing file', () => {
    run('init', testDir);
    const out = run('import /nonexistent.jsonl', testDir);
    expect(out).toContain('not found');
  });
});

// ─── Config ────────────────────────────────────────────────
describe('config', () => {
  beforeEach(() => { run('init', testDir); });

  it('sets and gets config values', () => {
    run('config set sync.autocommit true', testDir);
    const out = run('config get sync.autocommit', testDir);
    expect(out).toContain('true');
  });

  it('lists all config', () => {
    run('config set sync.autocommit true', testDir);
    run('config set project.name test', testDir);
    const out = run('config list', testDir);
    expect(out).toContain('sync.autocommit');
    expect(out).toContain('project.name');
  });

  it('reports unset values', () => {
    const out = run('config get nonexistent', testDir);
    expect(out).toContain('not set');
  });
});

// ─── Sync (git-dependent) ──────────────────────────────────
describe('sync', () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = tmpDir();
    // Init git repo
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
      cwd: gitDir,
      stdio: 'pipe',
    });
    // Init trak
    run('init', gitDir);
    // Initial commit so git has HEAD
    execSync('git add -A && git commit -m "init" --allow-empty', {
      cwd: gitDir,
      stdio: 'pipe',
    });
  });

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('commits JSONL to git', () => {
    run('create "Sync task"', gitDir);
    const out = run('sync', gitDir);
    expect(out).toContain('Synced');

    // Verify git log
    const log = execSync('git log --oneline', { cwd: gitDir, encoding: 'utf-8' });
    expect(log).toContain('trak: sync');
  });

  it('is idempotent (no empty commits)', () => {
    run('create "Sync once"', gitDir);
    run('sync', gitDir);
    const out = run('sync', gitDir);
    expect(out).toContain('Nothing to sync');

    // Only 2 commits: init + first sync
    const log = execSync('git log --oneline', { cwd: gitDir, encoding: 'utf-8' });
    const lines = log.trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('shows task count in commit message', () => {
    run('create "Task 1"', gitDir);
    run('create "Task 2"', gitDir);
    run('sync', gitDir);
    const log = execSync('git log --oneline -1', { cwd: gitDir, encoding: 'utf-8' });
    expect(log).toContain('2 tasks');
  });
});

// ─── JSONL Roundtrip ───────────────────────────────────────
describe('JSONL roundtrip', () => {
  beforeEach(() => { run('init', testDir); });

  it('full roundtrip preserves all data', () => {
    // Create complex state
    const aOut = run('create "Task A" --project proj -p 3 --tags "x,y"', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Task B"', testDir);
    const bId = extractId(bOut);
    run(`dep add ${bId} ${aId}`, testDir);
    run(`log ${aId} "Progress" --author agent-1`, testDir);
    run(`status ${aId} wip`, testDir);
    run(`assign ${bId} bot-2`, testDir);

    // Read JSONL
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const jsonlContent = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = jsonlContent.trim().split('\n');
    expect(lines).toHaveLength(2);

    // Parse and verify
    const taskA = JSON.parse(lines.find(l => l.includes(aId))!);
    const taskB = JSON.parse(lines.find(l => l.includes(bId))!);

    expect(taskA.status).toBe('wip');
    expect(taskA.priority).toBe(3);
    expect(taskA.project).toBe('proj');
    expect(taskA.tags).toBe('x,y');
    expect(taskA.journal.length).toBeGreaterThan(1);

    expect(taskB.deps).toContain(aId);
    expect(taskB.assigned_to).toBe('bot-2');

    // Delete DB, reimport
    const dbPath = path.join(testDir, '.trak', 'trak.db');
    fs.unlinkSync(dbPath);
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}

    run('init', testDir);
    run(`import ${jsonlPath}`, testDir);

    // Verify restored data
    const showA = run(`show ${aId}`, testDir);
    expect(showA).toContain('Task A');
    expect(showA).toContain('WIP');
    expect(showA).toContain('proj');
    expect(showA).toContain('Progress');

    const showB = run(`show ${bId}`, testDir);
    expect(showB).toContain('Task B');
    expect(showB).toContain('bot-2');
  });
});
