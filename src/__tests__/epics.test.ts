import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { tmpDir, run, extractId } from './helpers';

let testDir: string;
beforeEach(() => { testDir = tmpDir(); run('init', testDir); });
afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

// ─── epic create ───────────────────────────────────────
describe('epic create', () => {
  it('creates a task with is_epic=1', () => {
    const out = run('epic create "Big Epic"', testDir);
    const id = extractId(out);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('EPIC');
  });

  it('supports project flag', () => {
    const out = run('epic create "Proj Epic" --project alpha', testDir);
    expect(out).toContain('alpha');
  });
});

// ─── epic list ─────────────────────────────────────────
describe('epic list', () => {
  it('shows only epics', () => {
    run('epic create "Epic One"', testDir);
    run('create "Normal task"', testDir);
    const out = run('epic list', testDir);
    expect(out).toContain('Epic One');
    expect(out).not.toContain('Normal task');
  });

  it('shows progress', () => {
    const epicOut = run('epic create "Progress Epic"', testDir);
    const epicId = extractId(epicOut);
    const taskOut = run(`create "Sub" --epic ${epicId}`, testDir);
    const taskId = extractId(taskOut);
    run(`close ${taskId}`, testDir);
    const out = run('epic list', testDir);
    expect(out).toContain('1/1');
  });

  it('returns empty when no epics', () => {
    run('create "Not an epic"', testDir);
    const out = run('epic list', testDir);
    expect(out).toContain('No epics found');
  });
});
