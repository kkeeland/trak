import { describe, it, expect, beforeEach } from 'vitest';
import { run, runOrThrow, extractId, tmpDir } from './helpers';
import fs from 'fs';

let cwd: string;

beforeEach(() => {
  cwd = tmpDir();
  run('init', cwd);
});

describe('autonomy flags on create', () => {
  it('defaults to manual autonomy', () => {
    const out = runOrThrow('create "Test task"', cwd);
    const id = extractId(out);
    const show = runOrThrow(`show ${id}`, cwd);
    // manual is not shown (it's the default)
    expect(show).not.toContain('Autonomy:');
  });

  it('sets autonomy=auto with --auto flag', () => {
    const out = runOrThrow('create "Auto task" --auto', cwd);
    expect(out).toContain('autonomy:');
    expect(out).toContain('auto');
    const id = extractId(out);
    const show = runOrThrow(`show ${id}`, cwd);
    expect(show).toContain('auto');
  });

  it('sets autonomy=review with --review flag', () => {
    const out = runOrThrow('create "Review task" --review', cwd);
    expect(out).toContain('review');
  });

  it('sets autonomy=approve with --approve flag', () => {
    const out = runOrThrow('create "Approve task" --approve', cwd);
    expect(out).toContain('approve');
  });

  it('sets budget with --budget flag', () => {
    const out = runOrThrow('create "Budgeted task" --budget 5.00', cwd);
    expect(out).toContain('budget:');
    expect(out).toContain('$5.00');
  });
});

describe('trak next', () => {
  it('returns nothing when no auto tasks (exit 1)', () => {
    runOrThrow('create "Manual task"', cwd);
    const out = run('next', cwd);
    // Should not contain a task ID since it exits 1
    expect(out).not.toMatch(/trak-[a-f0-9]{6} Manual/);
  });

  it('returns the highest priority auto task', () => {
    runOrThrow('create "Low auto" --auto -p 1', cwd);
    const highOut = runOrThrow('create "High auto" --auto -p 3', cwd);
    const highId = extractId(highOut);
    const next = runOrThrow('next', cwd);
    expect(next).toContain(highId);
    expect(next).toContain('High auto');
  });

  it('supports --json output', () => {
    runOrThrow('create "JSON auto" --auto', cwd);
    const out = runOrThrow('next --json', cwd);
    const data = JSON.parse(out);
    expect(data.found).toBe(true);
    expect(data.title).toBe('JSON auto');
    expect(data.autonomy).toBe('auto');
  });

  it('skips blocked tasks', () => {
    const parentOut = runOrThrow('create "Parent" --auto', cwd);
    const parentId = extractId(parentOut);
    const childOut = runOrThrow('create "Child" --auto', cwd);
    const childId = extractId(childOut);
    runOrThrow(`dep add ${childId} ${parentId}`, cwd);
    const next = runOrThrow('next', cwd);
    expect(next).toContain(parentId);
    expect(next).not.toContain(childId);
  });

  it('skips over-budget tasks', () => {
    const out = runOrThrow('create "Expensive" --auto --budget 1.00', cwd);
    const id = extractId(out);
    // Add cost that exceeds budget
    runOrThrow(`log ${id} "work" --cost 2.00`, cwd);
    const next = run('next', cwd);
    expect(next).not.toContain(id);
  });

  it('filters by --project', () => {
    runOrThrow('create "Alpha task" --auto --project alpha', cwd);
    const betaOut = runOrThrow('create "Beta task" --auto --project beta', cwd);
    const betaId = extractId(betaOut);
    const next = runOrThrow('next --project beta', cwd);
    expect(next).toContain(betaId);
    expect(next).toContain('Beta task');
  });
});

describe('event chain on close', () => {
  it('shows unblocked auto tasks after closing', () => {
    const parentOut = runOrThrow('create "Blocker" --auto', cwd);
    const parentId = extractId(parentOut);
    const childOut = runOrThrow('create "Blocked auto" --auto', cwd);
    const childId = extractId(childOut);
    runOrThrow(`dep add ${childId} ${parentId}`, cwd);
    const closeOut = runOrThrow(`close ${parentId}`, cwd);
    expect(closeOut).toContain('⚡ Unblocked auto tasks:');
    expect(closeOut).toContain(childId);
  });

  it('does not show manual unblocked tasks', () => {
    const parentOut = runOrThrow('create "Blocker"', cwd);
    const parentId = extractId(parentOut);
    const childOut = runOrThrow('create "Blocked manual"', cwd);
    const childId = extractId(childOut);
    runOrThrow(`dep add ${childId} ${parentId}`, cwd);
    const closeOut = runOrThrow(`close ${parentId}`, cwd);
    expect(closeOut).not.toContain('⚡ Unblocked auto tasks:');
  });
});

describe('project default autonomy', () => {
  it('inherits autonomy from project config', () => {
    runOrThrow('config set project.myproj.default-autonomy auto', cwd);
    const out = runOrThrow('create "Inherited" --project myproj', cwd);
    expect(out).toContain('autonomy:');
    expect(out).toContain('auto');
  });

  it('explicit flag overrides project default', () => {
    runOrThrow('config set project.myproj.default-autonomy auto', cwd);
    const out = runOrThrow('create "Override" --project myproj --review', cwd);
    expect(out).toContain('review');
  });
});

describe('budget warnings', () => {
  it('shows over-budget warning in show', () => {
    const out = runOrThrow('create "Budget task" --budget 1.00', cwd);
    const id = extractId(out);
    runOrThrow(`log ${id} "expensive work" --cost 2.00`, cwd);
    const show = runOrThrow(`show ${id}`, cwd);
    expect(show).toContain('OVER BUDGET');
    expect(show).toContain('$1.00');
  });

  it('no warning when under budget', () => {
    const out = runOrThrow('create "Budget task" --budget 10.00', cwd);
    const id = extractId(out);
    runOrThrow(`log ${id} "cheap work" --cost 1.00`, cwd);
    const show = runOrThrow(`show ${id}`, cwd);
    expect(show).not.toContain('OVER BUDGET');
  });
});

describe('JSONL roundtrip with autonomy/budget', () => {
  it('preserves autonomy and budget through export/import', () => {
    const out = runOrThrow('create "Roundtrip" --auto --budget 5.00', cwd);
    const id = extractId(out);
    // Check JSONL has the fields
    const jsonlPath = `${cwd}/.trak/trak.jsonl`;
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const record = JSON.parse(content.split('\n').find(l => l.includes(id))!);
    expect(record.autonomy).toBe('auto');
    expect(record.budget_usd).toBe(5.0);

    // Import and verify
    runOrThrow('import', cwd);
    const show = runOrThrow(`show ${id}`, cwd);
    expect(show).toContain('auto');
    expect(show).toContain('$5.00');
  });
});
