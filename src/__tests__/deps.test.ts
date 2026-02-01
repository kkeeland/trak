import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { tmpDir, run, extractId } from './helpers';

let testDir: string;
beforeEach(() => { testDir = tmpDir(); run('init', testDir); });
afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

// ─── dep add/rm ────────────────────────────────────────
describe('dep', () => {
  it('creates a dependency', () => {
    const aOut = run('create "Dep A"', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Dep B"', testDir);
    const bId = extractId(bOut);
    const out = run(`dep add ${bId} ${aId}`, testDir);
    expect(out).toContain('depends on');
  });

  it('removes a dependency', () => {
    const aOut = run('create "Rm A"', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Rm B"', testDir);
    const bId = extractId(bOut);
    run(`dep add ${bId} ${aId}`, testDir);
    const out = run(`dep rm ${bId} ${aId}`, testDir);
    expect(out).toContain('Removed');
  });

  it('prevents self-dependency', () => {
    const out1 = run('create "Self dep"', testDir);
    const id = extractId(out1);
    const out = run(`dep add ${id} ${id}`, testDir);
    expect(out).toContain('cannot depend on itself');
  });

  it('handles duplicate dependency gracefully', () => {
    const aOut = run('create "Dup A"', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Dup B"', testDir);
    const bId = extractId(bOut);
    run(`dep add ${bId} ${aId}`, testDir);
    const out = run(`dep add ${bId} ${aId}`, testDir);
    expect(out).toContain('already exists');
  });

  it('errors when removing non-existent dependency', () => {
    const aOut = run('create "No dep A"', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "No dep B"', testDir);
    const bId = extractId(bOut);
    const out = run(`dep rm ${bId} ${aId}`, testDir);
    expect(out).toContain('No such dependency');
  });
});

// ─── ready ──────────────────────────────────────────────
describe('ready', () => {
  it('shows unblocked tasks', () => {
    run('create "Ready task"', testDir);
    const out = run('ready', testDir);
    expect(out).toContain('Ready task');
  });

  it('hides tasks with unfinished deps', () => {
    const pOut = run('create "Parent task"', testDir);
    const parentId = extractId(pOut);
    const cOut = run('create "Child task"', testDir);
    const childId = extractId(cOut);
    run(`dep add ${childId} ${parentId}`, testDir);
    const out = run('ready', testDir);
    expect(out).toContain('Parent task');
    expect(out).not.toContain('Child task');
  });

  it('shows child after parent is done', () => {
    const pOut = run('create "Parent"', testDir);
    const parentId = extractId(pOut);
    const cOut = run('create "Child"', testDir);
    const childId = extractId(cOut);
    run(`dep add ${childId} ${parentId}`, testDir);
    run(`close ${parentId}`, testDir);
    const out = run('ready', testDir);
    expect(out).toContain('Child');
  });

  it('returns empty message with no ready tasks', () => {
    const out = run('ready', testDir);
    expect(out).toContain('No ready tasks');
  });
});

// ─── board ──────────────────────────────────────────────
describe('board', () => {
  it('groups by project', () => {
    run('create "Task A" --project alpha', testDir);
    run('create "Task B" --project beta', testDir);
    const out = run('board', testDir);
    expect(out).toContain('ALPHA');
    expect(out).toContain('BETA');
  });

  it('shows correct counts', () => {
    run('create "A1" --project alpha', testDir);
    run('create "A2" --project alpha', testDir);
    const out = run('board', testDir);
    expect(out).toContain('(2)');
  });

  it('shows empty message when no active tasks', () => {
    const out = run('board', testDir);
    expect(out).toContain('No active tasks');
  });
});

// ─── heat ───────────────────────────────────────────────
describe('heat', () => {
  it('returns tasks sorted by heat score', () => {
    const aOut = run('create "Hot task" -p 3', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Depends on hot"', testDir);
    const bId = extractId(bOut);
    const cOut = run('create "Also depends"', testDir);
    const cId = extractId(cOut);
    run(`dep add ${bId} ${aId}`, testDir);
    run(`dep add ${cId} ${aId}`, testDir);
    const out = run('heat', testDir);
    expect(out).toContain('Heat Map');
    const hotPos = out.indexOf('Hot task');
    const depPos = out.indexOf('Depends on hot');
    expect(hotPos).toBeLessThan(depPos);
  });

  it('shows empty message when no tasks', () => {
    const out = run('heat', testDir);
    expect(out).toContain('No active tasks');
  });
});
