import { describe, it, expect, beforeEach } from 'vitest';
import { run, runOrThrow, extractId, tmpDir } from './helpers';

let cwd: string;

beforeEach(() => {
  cwd = tmpDir();
  run('init', cwd);
});

describe('trak do', () => {
  it('decomposes a landing page task', () => {
    const out = runOrThrow('do "build a landing page for trak" --project trak', cwd);
    expect(out).toContain('trak do');
    expect(out).toContain('decomposed into 5 subtasks');
    expect(out).toContain('Design layout');
    expect(out).toContain('Write copy');
    expect(out).toContain('Build the page');
    expect(out).toContain('Deploy to production');
    expect(out).toContain('READY');
    expect(out).toContain('convoy-');
  });

  it('decomposes a bug fix task', () => {
    const out = runOrThrow('do "fix bug in login flow"', cwd);
    expect(out).toContain('decomposed into 4 subtasks');
    expect(out).toContain('Reproduce');
    expect(out).toContain('root cause');
    expect(out).toContain('Implement fix');
  });

  it('decomposes an article writing task', () => {
    const out = runOrThrow('do "write an article about AI agents"', cwd);
    expect(out).toContain('decomposed into 5 subtasks');
    expect(out).toContain('Research');
    expect(out).toContain('outline');
    expect(out).toContain('draft');
  });

  it('uses default decomposition for unknown input', () => {
    const out = runOrThrow('do "something completely random"', cwd);
    expect(out).toContain('decomposed into 4 subtasks');
    expect(out).toContain('Plan approach');
    expect(out).toContain('Implement');
    expect(out).toContain('Test');
    expect(out).toContain('Document');
  });

  it('creates tasks with auto autonomy and deps', () => {
    const out = runOrThrow('do "fix bug in auth" --project myproj', cwd);
    // Extract the first task ID
    const ids = out.match(/trak-[a-f0-9]{6}/g);
    expect(ids).toBeTruthy();
    expect(ids!.length).toBeGreaterThanOrEqual(4);

    // First task should be ready (no deps blocking it)
    const firstId = ids![0];
    const show = runOrThrow(`show ${firstId}`, cwd);
    expect(show).toContain('auto');
    expect(show).toContain('myproj');

    // Second task should depend on first
    const secondId = ids![1];
    const show2 = runOrThrow(`show ${secondId}`, cwd);
    expect(show2).toContain(firstId);
  });

  it('creates a convoy for the subtasks', () => {
    runOrThrow('do "build landing page"', cwd);
    const convoys = runOrThrow('convoy list', cwd);
    expect(convoys).toContain('build landing page');
  });

  it('all generated tasks have do tag', () => {
    const out = runOrThrow('do "fix bug in parser"', cwd);
    const ids = out.match(/trak-[a-f0-9]{6}/g)!;
    for (const id of ids) {
      const show = runOrThrow(`show ${id}`, cwd);
      expect(show).toContain('do');
    }
  });
});
