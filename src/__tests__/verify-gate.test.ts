import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { tmpDir, run, extractId } from './helpers';

let testDir: string;
beforeEach(() => { testDir = tmpDir(); run('init', testDir); });
afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

describe('verification gate', () => {
  it('blocks close without --verify, sets status to review', () => {
    const out = run('create "Gate test"', testDir);
    const id = extractId(out);

    const closeOut = run(`close ${id}`, testDir);
    expect(closeOut).toContain('Close blocked');
    expect(closeOut).toContain('verification required');

    // Task should be in review, not done
    const show = run(`show ${id}`, testDir);
    expect(show).toContain('REVIEW');
    expect(show).not.toContain('DONE');
  });

  it('allows close with --force (human override)', () => {
    const out = run('create "Force test"', testDir);
    const id = extractId(out);

    const closeOut = run(`close ${id} --force`, testDir);
    expect(closeOut).toContain('✓');
    expect(closeOut).not.toContain('Close blocked');

    const show = run(`show ${id}`, testDir);
    expect(show).toContain('DONE');
  });

  it('allows close with --verify when no checks needed', () => {
    const out = run('create "Verify test"', testDir);
    const id = extractId(out);

    const closeOut = run(`close ${id} --verify`, testDir);
    // Should pass since there are no build/test scripts in temp dir
    expect(closeOut).toContain('✓');

    const show = run(`show ${id}`, testDir);
    expect(show).toContain('DONE');
  });

  it('allows close when task already has verification_status=passed', () => {
    const out = run('create "Pre-verified test"', testDir);
    const id = extractId(out);

    // Manually pass verification first
    run(`verify ${id} --pass --agent tester`, testDir);

    // Now close should work without --verify or --force
    const closeOut = run(`close ${id}`, testDir);
    expect(closeOut).toContain('✓');
    expect(closeOut).not.toContain('Close blocked');

    const show = run(`show ${id}`, testDir);
    expect(show).toContain('DONE');
  });

  it('logs verification gate block to journal', () => {
    const out = run('create "Journal test"', testDir);
    const id = extractId(out);

    run(`close ${id}`, testDir);

    const history = run(`history ${id}`, testDir);
    expect(history).toContain('Close blocked');
    expect(history).toContain('no verification');
  });
});
