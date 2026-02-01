import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpDir, run, runOrThrow, extractId } from './helpers';

let testDir: string;
beforeEach(() => { testDir = tmpDir(); run('init', testDir); });
afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

// ─── cost ──────────────────────────────────────────────
describe('cost', () => {
  it('shows empty when no cost data', () => {
    run('create "Free task"', testDir);
    const out = run('cost', testDir);
    expect(out).toContain('No cost data found');
  });

  it('aggregates cost by project', () => {
    const out = run('cost --project alpha', testDir);
    expect(out).toContain('No cost data');
  });
});

// ─── import-beads ──────────────────────────────────────
describe('import-beads', () => {
  it('imports from beads JSONL format', () => {
    const jsonl = [
      JSON.stringify({
        id: 'bead-001', title: 'Bead task one', status: 'open', priority: 2,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z', labels: ['trak'],
      }),
      JSON.stringify({
        id: 'bead-002', title: 'Bead task two', status: 'closed', priority: 1,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z', labels: ['peptok'],
      }),
    ].join('\n');

    const jsonlPath = path.join(testDir, 'issues.jsonl');
    fs.writeFileSync(jsonlPath, jsonl);

    const out = run(`import-beads ${jsonlPath}`, testDir);
    expect(out).toContain('Import complete');
    expect(out).toContain('2');

    const list = run('list --all', testDir);
    expect(list).toContain('Bead task one');
    expect(list).toContain('Bead task two');
  });

  it('imports dependencies from beads', () => {
    const jsonl = [
      JSON.stringify({
        id: 'bead-a', title: 'Parent bead', status: 'open', priority: 1,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z',
        dependencies: [{ issue_id: 'bead-a', depends_on_id: 'bead-b', type: 'blocks' }],
      }),
      JSON.stringify({
        id: 'bead-b', title: 'Child bead', status: 'open', priority: 1,
        created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z',
      }),
    ].join('\n');

    const jsonlPath = path.join(testDir, 'issues.jsonl');
    fs.writeFileSync(jsonlPath, jsonl);

    const out = run(`import-beads ${jsonlPath}`, testDir);
    expect(out).toContain('1');
    expect(out).toContain('dependenc');
  });

  it('handles bad path', () => {
    const out = run('import-beads /nonexistent/path.jsonl', testDir);
    expect(out).toContain('not found');
  });

  it('handles directory with issues.jsonl', () => {
    const beadsDir = path.join(testDir, '.beads');
    fs.mkdirSync(beadsDir);
    const jsonl = JSON.stringify({
      id: 'bead-dir', title: 'Dir import', status: 'open', priority: 1,
      created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00Z',
    });
    fs.writeFileSync(path.join(beadsDir, 'issues.jsonl'), jsonl);
    const out = run(`import-beads ${beadsDir}`, testDir);
    expect(out).toContain('Import complete');
  });
});

// ─── export/import roundtrip ───────────────────────────
describe('export/import', () => {
  it('roundtrips data correctly', () => {
    const aOut = run('create "Export A" --project alpha -p 2', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Export B" --project beta', testDir);
    const bId = extractId(bOut);
    run(`dep add ${bId} ${aId}`, testDir);
    run(`log ${aId} "Some note" --author tester`, testDir);

    const exportJson = runOrThrow('export', testDir);
    const data = JSON.parse(exportJson);
    expect(data.tasks).toHaveLength(2);
    expect(data.dependencies).toHaveLength(1);
    expect(data.logs.length).toBeGreaterThan(0);

    const exportPath = path.join(testDir, 'export.json');
    fs.writeFileSync(exportPath, exportJson);

    const importDir = tmpDir();
    run('init', importDir);
    const importOut = run(`import ${exportPath}`, importDir);
    expect(importOut).toContain('2 tasks');

    const list = run('list --all', importDir);
    expect(list).toContain('Export A');
    expect(list).toContain('Export B');

    fs.rmSync(importDir, { recursive: true, force: true });
  });

  it('export on empty db returns empty arrays', () => {
    const json = runOrThrow('export', testDir);
    const data = JSON.parse(json);
    expect(data.tasks).toHaveLength(0);
    expect(data.dependencies).toHaveLength(0);
    expect(data.logs).toHaveLength(0);
  });

  it('import errors on missing file', () => {
    const out = run('import /nonexistent.json', testDir);
    expect(out).toContain('not found');
  });

  it('import errors on invalid JSON', () => {
    const badPath = path.join(testDir, 'bad.json');
    fs.writeFileSync(badPath, 'not json');
    const out = run(`import ${badPath}`, testDir);
    expect(out).toContain('Invalid JSON');
  });
});

// ─── setup ─────────────────────────────────────────────
describe('setup', () => {
  it('generates correct content for claude', () => {
    const out = run('setup claude', testDir);
    expect(out).toContain('Claude Code');
    expect(fs.existsSync(path.join(testDir, 'CLAUDE.md'))).toBe(true);
    const content = fs.readFileSync(path.join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('trak:setup');
    expect(content).toContain('trak ready');
  });

  it('is idempotent', () => {
    run('setup claude', testDir);
    const out2 = run('setup claude', testDir);
    expect(out2).toContain('already configured');
  });

  it('generates content for cursor', () => {
    run('setup cursor', testDir);
    expect(fs.existsSync(path.join(testDir, '.cursorrules'))).toBe(true);
  });

  it('generic prints to stdout', () => {
    const out = run('setup generic', testDir);
    expect(out).toContain('trak ready');
    expect(out).toContain('Task Tracking');
  });

  it('list shows all tools', () => {
    const out = run('setup --list', testDir);
    expect(out).toContain('claude');
    expect(out).toContain('cursor');
    expect(out).toContain('clawdbot');
  });
});

// ─── edge cases ────────────────────────────────────────
describe('edge cases', () => {
  it('partial ID matching works', () => {
    const out1 = run('create "Partial ID"', testDir);
    const id = extractId(out1);
    const partial = id.slice(-4);
    const show = run(`show ${partial}`, testDir);
    expect(show).toContain('Partial ID');
  });

  it('commands fail without init', () => {
    const noInitDir = tmpDir();
    const out = run('list', noInitDir);
    expect(out).toContain('No trak database');
    fs.rmSync(noInitDir, { recursive: true, force: true });
  });

  it('multiple deps create fan-out for heat', () => {
    const hotOut = run('create "Hot center" -p 3', testDir);
    const hotId = extractId(hotOut);
    for (let i = 0; i < 5; i++) {
      const tOut = run(`create "Fan ${i}"`, testDir);
      const tId = extractId(tOut);
      run(`dep add ${tId} ${hotId}`, testDir);
    }
    const heat = run('heat', testDir);
    expect(heat).toContain('Hot center');
  });
});
