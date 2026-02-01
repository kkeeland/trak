import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { tmpDir, run, extractId } from './helpers';

let testDir: string;
beforeEach(() => { testDir = tmpDir(); run('init', testDir); });
afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

// ─── create ─────────────────────────────────────────────
describe('create', () => {
  it('creates a task and returns an ID', () => {
    const out = run('create "Test task"', testDir);
    expect(out).toContain('Created');
    const id = extractId(out);
    expect(id).toMatch(/^trak-[a-f0-9]{6}$/);
  });

  it('sets defaults (status=open, priority=1)', () => {
    const out = run('create "Default task"', testDir);
    const id = extractId(out);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('OPEN');
  });

  it('respects --project flag', () => {
    const out = run('create "Proj task" --project myproj', testDir);
    expect(out).toContain('myproj');
  });

  it('respects -p priority flag', () => {
    const out = run('create "High prio" -p 3', testDir);
    const id = extractId(out);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('P3');
  });

  it('respects --epic flag', () => {
    const epicOut = run('epic create "My Epic"', testDir);
    const epicId = extractId(epicOut);
    const taskOut = run(`create "Sub task" --epic ${epicId}`, testDir);
    const taskId = extractId(taskOut);
    const show = run(`show ${taskId}`, testDir);
    expect(show).toContain(epicId);
  });

  it('rejects invalid priority', () => {
    const out = run('create "Bad prio" -p 5', testDir);
    expect(out).toContain('Priority must be 0-3');
  });
});

// ─── list ───────────────────────────────────────────────
describe('list', () => {
  it('shows all tasks', () => {
    run('create "Task A"', testDir);
    run('create "Task B"', testDir);
    const out = run('list', testDir);
    expect(out).toContain('Task A');
    expect(out).toContain('Task B');
    expect(out).toContain('2 task');
  });

  it('filters by --project', () => {
    run('create "In proj" --project alpha', testDir);
    run('create "No proj"', testDir);
    const out = run('list --project alpha', testDir);
    expect(out).toContain('In proj');
    expect(out).not.toContain('No proj');
  });

  it('filters by --status', () => {
    const out1 = run('create "Open one"', testDir);
    const id = extractId(out1);
    run(`status ${id} wip`, testDir);
    run('create "Still open"', testDir);
    const out = run('list --status wip', testDir);
    expect(out).toContain('Open one');
    expect(out).not.toContain('Still open');
  });

  it('returns empty message for empty DB', () => {
    const out = run('list', testDir);
    expect(out).toContain('No tasks found');
  });

  it('hides done tasks by default', () => {
    const out1 = run('create "Done task"', testDir);
    const id = extractId(out1);
    run(`close ${id} --force`, testDir);
    const out = run('list', testDir);
    expect(out).toContain('No tasks found');
  });

  it('shows done tasks with --all', () => {
    const out1 = run('create "Done task"', testDir);
    const id = extractId(out1);
    run(`close ${id} --force`, testDir);
    const out = run('list --all', testDir);
    expect(out).toContain('Done task');
  });
});

// ─── show ───────────────────────────────────────────────
describe('show', () => {
  it('displays task details', () => {
    const out1 = run('create "Show me" --project demo -p 2', testDir);
    const id = extractId(out1);
    const out = run(`show ${id}`, testDir);
    expect(out).toContain('Show me');
    expect(out).toContain('demo');
    expect(out).toContain('P2');
  });

  it('shows journal entries', () => {
    const out1 = run('create "Log target"', testDir);
    const id = extractId(out1);
    run(`log ${id} "Did something"`, testDir);
    const out = run(`show ${id}`, testDir);
    expect(out).toContain('Journal');
    expect(out).toContain('Did something');
  });

  it('shows dependencies', () => {
    const aOut = run('create "Task A"', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Task B"', testDir);
    const bId = extractId(bOut);
    run(`dep add ${bId} ${aId}`, testDir);
    const out = run(`show ${bId}`, testDir);
    expect(out).toContain('Depends on');
    expect(out).toContain('Task A');
  });

  it('errors on missing task', () => {
    const out = run('show trak-000000', testDir);
    expect(out).toContain('Task not found');
  });
});

// ─── status ─────────────────────────────────────────────
describe('status', () => {
  it('changes task status', () => {
    const out1 = run('create "Status test"', testDir);
    const id = extractId(out1);
    const out = run(`status ${id} wip`, testDir);
    expect(out).toContain('open');
    expect(out).toContain('wip');
  });

  it('logs the status change', () => {
    const out1 = run('create "Status log test"', testDir);
    const id = extractId(out1);
    run(`status ${id} wip`, testDir);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('Status: open');
    expect(show).toContain('wip');
  });

  it('rejects invalid status', () => {
    const out1 = run('create "Bad status"', testDir);
    const id = extractId(out1);
    const out = run(`status ${id} invalid`, testDir);
    expect(out).toContain('Invalid status');
  });
});

// ─── close ──────────────────────────────────────────────
describe('close', () => {
  it('marks task as done', () => {
    const out1 = run('create "Close me"', testDir);
    const id = extractId(out1);
    run(`close ${id} --force`, testDir);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('DONE');
  });

  it('updates timestamp on close', () => {
    const out1 = run('create "Close ts"', testDir);
    const id = extractId(out1);
    run(`close ${id} --force`, testDir);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('Updated:');
  });

  it('is idempotent (already done)', () => {
    const out1 = run('create "Already done"', testDir);
    const id = extractId(out1);
    run(`close ${id} --force`, testDir);
    const out = run(`close ${id} --force`, testDir);
    expect(out).toContain('Already done');
  });

  it('errors on missing task', () => {
    const out = run('close trak-000000', testDir);
    expect(out).toContain('Task not found');
  });
});

// ─── log ────────────────────────────────────────────────
describe('log', () => {
  it('appends journal entry', () => {
    const out1 = run('create "Log test"', testDir);
    const id = extractId(out1);
    const out = run(`log ${id} "Made progress"`, testDir);
    expect(out).toContain('Logged');
    expect(out).toContain('Made progress');
  });

  it('respects --author flag', () => {
    const out1 = run('create "Author test"', testDir);
    const id = extractId(out1);
    run(`log ${id} "Agent work" --author agent-1`, testDir);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('agent-1');
    expect(show).toContain('Agent work');
  });

  it('errors on missing task', () => {
    const out = run('log trak-000000 "nope"', testDir);
    expect(out).toContain('Task not found');
  });
});
