import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { tmpDir, run, extractId } from './helpers';

let testDir: string;

/** Strip ANSI escape codes for reliable string matching */
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

beforeEach(() => {
  testDir = tmpDir();
  run('init', testDir);
});

afterEach(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});

describe('retry mechanism', () => {
  describe('trak fail', () => {
    it('re-queues a task with backoff on first failure', () => {
      const createOut = run('create "Retry test task" -p 1', testDir);
      const id = extractId(createOut);

      run(`status ${id} wip`, testDir);

      const failOut = strip(run(`fail ${id} --reason "Connection timeout"`, testDir));
      expect(failOut).toContain('Retry 1/3');
      expect(failOut).toContain('re-queued with backoff');
      expect(failOut).toContain('Connection timeout');

      const showOut = strip(run(`show ${id}`, testDir));
      expect(showOut).toContain('OPEN');
      expect(showOut).toContain('1/3');
      expect(showOut).toContain('Connection timeout');
    });

    it('permanently fails after max retries exhausted', () => {
      const createOut = run('create "Will fail permanently" -p 1', testDir);
      const id = extractId(createOut);

      run(`fail ${id} --reason "fail 1"`, testDir);
      run(`fail ${id} --reason "fail 2"`, testDir);
      const failOut3 = strip(run(`fail ${id} --reason "fail 3"`, testDir));

      expect(failOut3).toContain('Permanently failed');
      expect(failOut3).toContain('3 attempts');

      const showOut = strip(run(`show ${id}`, testDir));
      expect(showOut).toContain('FAILED');
      expect(showOut).toContain('permanently failed');
    });

    it('does not retry when max_retries is 0 (--no-retry)', () => {
      const createOut = run('create "No retry task" --no-retry', testDir);
      const id = extractId(createOut);

      const failOut = strip(run(`fail ${id} --reason "single shot"`, testDir));
      expect(failOut).toContain('Permanently failed');

      const showOut = strip(run(`show ${id}`, testDir));
      expect(showOut).toContain('FAILED');
    });
  });

  describe('trak retry', () => {
    it('re-queues a failed task', () => {
      const createOut = run('create "Retry target" -p 1', testDir);
      const id = extractId(createOut);

      // Fail enough to permanently fail
      run(`fail ${id} --reason "r1"`, testDir);
      run(`fail ${id} --reason "r2"`, testDir);
      run(`fail ${id} --reason "r3"`, testDir);

      let showOut = strip(run(`show ${id}`, testDir));
      expect(showOut).toContain('FAILED');

      // Manual retry
      const retryOut = strip(run(`retry ${id}`, testDir));
      expect(retryOut).toContain('Re-queued as open');
      expect(retryOut).toContain('retry count reset to 0');

      showOut = strip(run(`show ${id}`, testDir));
      expect(showOut).toContain('OPEN');
    });

    it('preserves retry count with --no-reset', () => {
      const createOut = run('create "Keep count task" -p 1', testDir);
      const id = extractId(createOut);

      run(`fail ${id} --reason "r1"`, testDir);
      run(`fail ${id} --reason "r2"`, testDir);
      run(`fail ${id} --reason "r3"`, testDir);

      const retryOut = strip(run(`retry ${id} --no-reset`, testDir));
      expect(retryOut).toContain('Re-queued as open');
      expect(retryOut).not.toContain('retry count reset to 0');
    });

    it('--list shows failed tasks', () => {
      const c1 = run('create "Good task" -p 1', testDir);
      const id1 = extractId(c1);

      const c2 = run('create "Bad task" -p 1', testDir);
      const id2 = extractId(c2);

      // Fail task 2 permanently
      run(`fail ${id2} --reason "fail1"`, testDir);
      run(`fail ${id2} --reason "fail2"`, testDir);
      run(`fail ${id2} --reason "fail3"`, testDir);

      const listOut = strip(run('retry --list', testDir));
      expect(listOut).toContain('Permanently Failed');
      expect(listOut).toContain(id2);
      expect(listOut).toContain('Bad task');
    });
  });

  describe('trak create --max-retries', () => {
    it('creates task with custom max retries', () => {
      const createOut = run('create "Custom retries" --max-retries 5', testDir);
      const id = extractId(createOut);

      run(`fail ${id} --reason "r1"`, testDir);
      run(`fail ${id} --reason "r2"`, testDir);
      run(`fail ${id} --reason "r3"`, testDir);
      const fail4 = strip(run(`fail ${id} --reason "r4"`, testDir));
      expect(fail4).toContain('Retry 4/5');
      expect(fail4).toContain('re-queued');

      const fail5 = strip(run(`fail ${id} --reason "r5"`, testDir));
      expect(fail5).toContain('Permanently failed');
    });
  });

  describe('ready respects retry_after', () => {
    it('shows retry_after in task show', () => {
      const createOut = run('create "Backoff task" -p 0', testDir);
      const id = extractId(createOut);

      // Fail it — gets re-queued with backoff
      run(`fail ${id} --reason "transient error"`, testDir);

      const showOut = strip(run(`show ${id}`, testDir));
      expect(showOut).toContain('Retry at');
    });
  });

  describe('list --failed filter', () => {
    it('shows only failed tasks', () => {
      const c1 = run('create "Normal" -p 1', testDir);
      const id1 = extractId(c1);
      const c2 = run('create "Doomed" --no-retry', testDir);
      const id2 = extractId(c2);

      run(`fail ${id2} --reason "doom"`, testDir);

      const listOut = strip(run('list --failed', testDir));
      expect(listOut).toContain(id2);
      expect(listOut).not.toContain(id1);
    });
  });
});
