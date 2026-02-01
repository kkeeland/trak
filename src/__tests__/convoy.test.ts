import { describe, it, expect, beforeEach } from 'vitest';
import { run, runOrThrow, extractId, tmpDir } from './helpers';

let cwd: string;

beforeEach(() => {
  cwd = tmpDir();
  run('init', cwd);
});

describe('convoy system', () => {
  it('creates a convoy', () => {
    const out = runOrThrow('convoy create "Sprint 1"', cwd);
    expect(out).toContain('Created convoy');
    expect(out).toContain('convoy-');
    expect(out).toContain('Sprint 1');
  });

  it('adds tasks to a convoy', () => {
    const convoyOut = runOrThrow('convoy create "Sprint 1"', cwd);
    const convoyId = convoyOut.match(/convoy-[a-f0-9]{6}/)![0];

    const t1 = extractId(runOrThrow('create "Task 1"', cwd));
    const t2 = extractId(runOrThrow('create "Task 2"', cwd));

    const addOut = runOrThrow(`convoy add ${convoyId} ${t1} ${t2}`, cwd);
    expect(addOut).toContain('Added');
    expect(addOut).toContain(t1);
    expect(addOut).toContain(t2);
  });

  it('shows convoy with tasks', () => {
    const convoyOut = runOrThrow('convoy create "Sprint 1"', cwd);
    const convoyId = convoyOut.match(/convoy-[a-f0-9]{6}/)![0];

    const t1 = extractId(runOrThrow('create "Task Alpha"', cwd));
    runOrThrow(`convoy add ${convoyId} ${t1}`, cwd);

    const showOut = runOrThrow(`convoy show ${convoyId}`, cwd);
    expect(showOut).toContain('Sprint 1');
    expect(showOut).toContain('Task Alpha');
    expect(showOut).toContain('0/1 done');
  });

  it('shows ready tasks in convoy', () => {
    const convoyOut = runOrThrow('convoy create "Sprint 1"', cwd);
    const convoyId = convoyOut.match(/convoy-[a-f0-9]{6}/)![0];

    const t1 = extractId(runOrThrow('create "Ready Task"', cwd));
    const t2 = extractId(runOrThrow('create "Blocked Task"', cwd));
    runOrThrow(`dep add ${t2} ${t1}`, cwd);

    runOrThrow(`convoy add ${convoyId} ${t1} ${t2}`, cwd);

    const readyOut = runOrThrow(`convoy ready ${convoyId}`, cwd);
    expect(readyOut).toContain('Ready Task');
    expect(readyOut).not.toContain('Blocked Task');
  });

  it('lists all convoys', () => {
    runOrThrow('convoy create "Sprint 1"', cwd);
    runOrThrow('convoy create "Sprint 2"', cwd);

    const listOut = runOrThrow('convoy list', cwd);
    expect(listOut).toContain('Sprint 1');
    expect(listOut).toContain('Sprint 2');
  });

  it('shows progress in convoy list', () => {
    const convoyOut = runOrThrow('convoy create "Sprint 1"', cwd);
    const convoyId = convoyOut.match(/convoy-[a-f0-9]{6}/)![0];

    const t1 = extractId(runOrThrow('create "Done Task"', cwd));
    const t2 = extractId(runOrThrow('create "Open Task"', cwd));
    runOrThrow(`convoy add ${convoyId} ${t1} ${t2}`, cwd);
    runOrThrow(`close ${t1} --force`, cwd);

    const listOut = runOrThrow('convoy list', cwd);
    expect(listOut).toContain('1/2 done');
  });

  it('shows empty convoy', () => {
    const convoyOut = runOrThrow('convoy create "Empty Sprint"', cwd);
    const convoyId = convoyOut.match(/convoy-[a-f0-9]{6}/)![0];
    const showOut = runOrThrow(`convoy show ${convoyId}`, cwd);
    expect(showOut).toContain('No tasks');
  });
});
