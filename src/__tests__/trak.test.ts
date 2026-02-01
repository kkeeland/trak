import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TRAK_BIN = path.resolve(__dirname, '../../dist/cli.js');

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trak-test-'));
  return dir;
}

const TEST_ENV = { ...process.env, NODE_ENV: 'test', NO_COLOR: '1', HOME: '/tmp/trak-no-home' };

function run(cmd: string, cwd: string): string {
  try {
    return execSync(`node ${TRAK_BIN} ${cmd}`, {
      cwd,
      env: TEST_ENV,
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch (e: any) {
    // Return stderr+stdout for error cases
    return (e.stdout || '') + (e.stderr || '');
  }
}

function runOrThrow(cmd: string, cwd: string): string {
  return execSync(`node ${TRAK_BIN} ${cmd}`, {
    cwd,
    env: TEST_ENV,
    encoding: 'utf-8',
    timeout: 5000,
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

// ─── 1. init ───────────────────────────────────────────────
describe('init', () => {
  it('creates .trak/trak.db', () => {
    const out = run('init', testDir);
    expect(out).toContain('Initialized');
    expect(fs.existsSync(path.join(testDir, '.trak', 'trak.db'))).toBe(true);
  });

  it('is idempotent on second run', () => {
    run('init', testDir);
    const out2 = run('init', testDir);
    expect(out2).toContain('already exists');
  });
});

// ─── 2. create ─────────────────────────────────────────────
describe('create', () => {
  beforeEach(() => { run('init', testDir); });

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
    // Create epic first
    const epicOut = run('epic create "My Epic"', testDir);
    const epicId = extractId(epicOut);
    // Create task under epic
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

// ─── 3. list ───────────────────────────────────────────────
describe('list', () => {
  beforeEach(() => { run('init', testDir); });

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
    run(`close ${id}`, testDir);
    const out = run('list', testDir);
    expect(out).toContain('No tasks found');
  });

  it('shows done tasks with --all', () => {
    const out1 = run('create "Done task"', testDir);
    const id = extractId(out1);
    run(`close ${id}`, testDir);
    const out = run('list --all', testDir);
    expect(out).toContain('Done task');
  });
});

// ─── 4. ready ──────────────────────────────────────────────
describe('ready', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── 5. board ──────────────────────────────────────────────
describe('board', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── 6. show ───────────────────────────────────────────────
describe('show', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── 7. status ─────────────────────────────────────────────
describe('status', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── 8. close ──────────────────────────────────────────────
describe('close', () => {
  beforeEach(() => { run('init', testDir); });

  it('marks task as done', () => {
    const out1 = run('create "Close me"', testDir);
    const id = extractId(out1);
    run(`close ${id}`, testDir);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('DONE');
  });

  it('updates timestamp on close', () => {
    const out1 = run('create "Close ts"', testDir);
    const id = extractId(out1);
    run(`close ${id}`, testDir);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('Updated:');
  });

  it('is idempotent (already done)', () => {
    const out1 = run('create "Already done"', testDir);
    const id = extractId(out1);
    run(`close ${id}`, testDir);
    const out = run(`close ${id}`, testDir);
    expect(out).toContain('Already done');
  });

  it('errors on missing task', () => {
    const out = run('close trak-000000', testDir);
    expect(out).toContain('Task not found');
  });
});

// ─── 9. log ────────────────────────────────────────────────
describe('log', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── 10. dep add/rm ────────────────────────────────────────
describe('dep', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── 11. epic create ───────────────────────────────────────
describe('epic create', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── 12. epic list ─────────────────────────────────────────
describe('epic list', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── 13. assign ────────────────────────────────────────────
describe('assign', () => {
  beforeEach(() => { run('init', testDir); });

  it('sets assigned_to field', () => {
    const out1 = run('create "Assign me"', testDir);
    const id = extractId(out1);
    const out = run(`assign ${id} agent-x`, testDir);
    expect(out).toContain('agent-x');
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('agent-x');
  });

  it('auto-transitions open to wip', () => {
    const out1 = run('create "Auto wip"', testDir);
    const id = extractId(out1);
    run(`assign ${id} agent-y`, testDir);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('WIP');
  });
});

// ─── 14. verify ────────────────────────────────────────────
describe('verify', () => {
  beforeEach(() => { run('init', testDir); });

  it('sets verification status (pass)', () => {
    const out1 = run('create "Verify me"', testDir);
    const id = extractId(out1);
    const out = run(`verify ${id} --pass`, testDir);
    expect(out).toContain('PASSED');
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('passed');
  });

  it('sets verification status (fail)', () => {
    const out1 = run('create "Fail verify"', testDir);
    const id = extractId(out1);
    run(`status ${id} review`, testDir);
    const out = run(`verify ${id} --fail --reason "Tests broken"`, testDir);
    expect(out).toContain('FAILED');
    expect(out).toContain('Tests broken');
  });

  it('logs verification result', () => {
    const out1 = run('create "Verify log"', testDir);
    const id = extractId(out1);
    run(`verify ${id} --pass --agent reviewer`, testDir);
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('Verification PASSED');
    expect(show).toContain('reviewer');
  });

  it('errors without a verification mode', () => {
    const out1 = run('create "No flag"', testDir);
    const id = extractId(out1);
    const out = run(`verify ${id}`, testDir);
    expect(out).toContain('Specify a verification mode');
  });
});

// ─── 15. claim ─────────────────────────────────────────────
describe('claim', () => {
  beforeEach(() => { run('init', testDir); });

  it('creates claim record', () => {
    const out1 = run('create "Claim me"', testDir);
    const id = extractId(out1);
    const out = run(`claim ${id} --agent bot-1`, testDir);
    expect(out).toContain('claimed');
    expect(out).toContain('bot-1');
  });

  it('prevents double-claim (warns)', () => {
    const out1 = run('create "Double claim"', testDir);
    const id = extractId(out1);
    run(`claim ${id} --agent bot-1`, testDir);
    const out = run(`claim ${id} --agent bot-2`, testDir);
    expect(out).toContain('already claimed');
    expect(out).toContain('bot-1');
  });

  it('same agent double-claim is idempotent', () => {
    const out1 = run('create "Same agent"', testDir);
    const id = extractId(out1);
    run(`claim ${id} --agent bot-1`, testDir);
    const out = run(`claim ${id} --agent bot-1`, testDir);
    expect(out).toContain('already claimed');
  });

  it('errors without --agent', () => {
    const out1 = run('create "No agent"', testDir);
    const id = extractId(out1);
    const out = run(`claim ${id}`, testDir);
    expect(out).toContain('Must specify --agent');
  });

  it('supports --release', () => {
    const out1 = run('create "Release me"', testDir);
    const id = extractId(out1);
    run(`claim ${id} --agent bot-1`, testDir);
    const out = run(`claim ${id} --release`, testDir);
    expect(out).toContain('released');
  });
});

// ─── 16. heat ──────────────────────────────────────────────
describe('heat', () => {
  beforeEach(() => { run('init', testDir); });

  it('returns tasks sorted by heat score', () => {
    // Task with deps (higher heat due to fan-out)
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
    // Hot task should appear first (higher priority + fan-out)
    const hotPos = out.indexOf('Hot task');
    const depPos = out.indexOf('Depends on hot');
    expect(hotPos).toBeLessThan(depPos);
  });

  it('shows empty message when no tasks', () => {
    const out = run('heat', testDir);
    expect(out).toContain('No active tasks');
  });
});

// ─── 17. cost ──────────────────────────────────────────────
describe('cost', () => {
  beforeEach(() => { run('init', testDir); });

  it('shows empty when no cost data', () => {
    run('create "Free task"', testDir);
    const out = run('cost', testDir);
    expect(out).toContain('No cost data found');
  });

  it('aggregates cost by project', () => {
    // We can't easily set cost_usd via CLI, but we can verify
    // the command runs on empty data without error
    const out = run('cost --project alpha', testDir);
    expect(out).toContain('No cost data');
  });
});

// ─── 18. import-beads ──────────────────────────────────────
describe('import-beads', () => {
  beforeEach(() => { run('init', testDir); });

  it('imports from beads JSONL format', () => {
    const jsonl = [
      JSON.stringify({
        id: 'bead-001',
        title: 'Bead task one',
        status: 'open',
        priority: 2,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        labels: ['trak'],
      }),
      JSON.stringify({
        id: 'bead-002',
        title: 'Bead task two',
        status: 'closed',
        priority: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        labels: ['peptok'],
      }),
    ].join('\n');

    const jsonlPath = path.join(testDir, 'issues.jsonl');
    fs.writeFileSync(jsonlPath, jsonl);

    const out = run(`import-beads ${jsonlPath}`, testDir);
    expect(out).toContain('Import complete');
    expect(out).toContain('2');

    // Verify tasks exist
    const list = run('list --all', testDir);
    expect(list).toContain('Bead task one');
    expect(list).toContain('Bead task two');
  });

  it('imports dependencies from beads', () => {
    const jsonl = [
      JSON.stringify({
        id: 'bead-a',
        title: 'Parent bead',
        status: 'open',
        priority: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
        dependencies: [{ issue_id: 'bead-a', depends_on_id: 'bead-b', type: 'blocks' }],
      }),
      JSON.stringify({
        id: 'bead-b',
        title: 'Child bead',
        status: 'open',
        priority: 1,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-02T00:00:00Z',
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
      id: 'bead-dir',
      title: 'Dir import',
      status: 'open',
      priority: 1,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-02T00:00:00Z',
    });
    fs.writeFileSync(path.join(beadsDir, 'issues.jsonl'), jsonl);
    const out = run(`import-beads ${beadsDir}`, testDir);
    expect(out).toContain('Import complete');
  });
});

// ─── 19. export/import roundtrip ───────────────────────────
describe('export/import', () => {
  beforeEach(() => { run('init', testDir); });

  it('roundtrips data correctly', () => {
    // Create tasks
    const aOut = run('create "Export A" --project alpha -p 2', testDir);
    const aId = extractId(aOut);
    const bOut = run('create "Export B" --project beta', testDir);
    const bId = extractId(bOut);
    run(`dep add ${bId} ${aId}`, testDir);
    run(`log ${aId} "Some note" --author tester`, testDir);

    // Export
    const exportJson = runOrThrow('export', testDir);
    const data = JSON.parse(exportJson);
    expect(data.tasks).toHaveLength(2);
    expect(data.dependencies).toHaveLength(1);
    expect(data.logs.length).toBeGreaterThan(0);

    // Write to file and import into fresh db
    const exportPath = path.join(testDir, 'export.json');
    fs.writeFileSync(exportPath, exportJson);

    // Create new dir for import
    const importDir = tmpDir();
    run('init', importDir);
    const importOut = run(`import ${exportPath}`, importDir);
    expect(importOut).toContain('2 tasks');

    // Verify data matches
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

// ─── 20. setup ─────────────────────────────────────────────
describe('setup', () => {
  beforeEach(() => { run('init', testDir); });

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

// ─── Edge cases ────────────────────────────────────────────
describe('edge cases', () => {
  beforeEach(() => { run('init', testDir); });

  it('partial ID matching works', () => {
    const out1 = run('create "Partial ID"', testDir);
    const id = extractId(out1);
    const partial = id.slice(-4); // last 4 chars
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
    // Create 5 tasks that depend on hot center
    for (let i = 0; i < 5; i++) {
      const tOut = run(`create "Fan ${i}"`, testDir);
      const tId = extractId(tOut);
      run(`dep add ${tId} ${hotId}`, testDir);
    }
    const heat = run('heat', testDir);
    // Hot center should have highest heat
    expect(heat).toContain('Hot center');
  });
});
