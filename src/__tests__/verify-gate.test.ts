import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
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

  it('allows close with --verify when journal has activity', () => {
    const out = run('create "Verify test"', testDir);
    const id = extractId(out);

    // Add a journal entry so journal-activity check passes
    run(`log ${id} "Did the work"`, testDir);

    const closeOut = run(`close ${id} --verify`, testDir);
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

  it('records verification results in journal when --verify is used', () => {
    const out = run('create "Verify journal test"', testDir);
    const id = extractId(out);

    // Add journal activity so it passes
    run(`log ${id} "Completed implementation"`, testDir);

    run(`close ${id} --verify`, testDir);

    const history = run(`history ${id}`, testDir);
    expect(history).toContain('Verification gate');
  });

  it('--force logs force bypass in journal', () => {
    const out = run('create "Force journal test"', testDir);
    const id = extractId(out);

    run(`close ${id} --force`, testDir);

    const history = run(`history ${id}`, testDir);
    expect(history).toContain('[force]');
  });

  it('--verify with --proof records proof artifact', () => {
    const out = run('create "Proof test"', testDir);
    const id = extractId(out);

    // Add journal activity
    run(`log ${id} "Work done"`, testDir);

    const closeOut = run(`close ${id} --verify --proof "https://github.com/repo/pull/42"`, testDir);
    expect(closeOut).toContain('proof-artifact');

    const history = run(`history ${id}`, testDir);
    expect(history).toContain('proof-artifact');
    expect(history).toContain('https://github.com/repo/pull/42');
  });

  it('rejects --verify when no checks pass and no journal activity', () => {
    const out = run('create "Empty task"', testDir);
    const id = extractId(out);

    // Don't add any journal entries or proof — should fail
    const closeOut = run(`close ${id} --verify`, testDir);
    // With no hard checks and no soft checks passing, gate should fail
    expect(closeOut).toContain('journal-activity');

    const show = run(`show ${id}`, testDir);
    // If gate failed, should be open not done
    expect(show).not.toContain('DONE');
  });

  it('close is idempotent on already-done tasks', () => {
    const out = run('create "Idem test"', testDir);
    const id = extractId(out);

    run(`close ${id} --force`, testDir);
    const closeAgain = run(`close ${id}`, testDir);
    expect(closeAgain).toContain('Already done');
  });

  it('blocks repeated close attempts (no --verify) and keeps review status', () => {
    const out = run('create "Repeated block"', testDir);
    const id = extractId(out);

    // First attempt — blocked
    run(`close ${id}`, testDir);
    const show1 = run(`show ${id}`, testDir);
    expect(show1).toContain('REVIEW');

    // Second attempt — still blocked (review → review)
    const close2 = run(`close ${id}`, testDir);
    expect(close2).toContain('Close blocked');
  });
});

describe('verification gate with git', () => {
  let gitDir: string;

  beforeEach(() => {
    gitDir = tmpDir();
    // Initialize a git repo with at least one commit
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
      cwd: gitDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    fs.writeFileSync(path.join(gitDir, 'README.md'), '# Test');
    execSync('git add -A && git commit -m "initial"', {
      cwd: gitDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    run('init', gitDir);
  });

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('passes git-proof when commits reference task ID', () => {
    const out = run('create "Git proof test"', gitDir);
    const id = extractId(out);

    // Add a journal entry for journal-activity check
    run(`log ${id} "Working on it"`, gitDir);

    // Create a commit mentioning the task ID
    fs.writeFileSync(path.join(gitDir, 'work.txt'), 'proof of work');
    execSync(`git add -A && git commit -m "${id}: implemented feature"`, {
      cwd: gitDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });

    const closeOut = run(`close ${id} --verify`, gitDir);
    expect(closeOut).toContain('git-proof');
    expect(closeOut).toContain('✓');

    const show = run(`show ${id}`, gitDir);
    expect(show).toContain('DONE');
  });

  it('passes git-proof with explicit --commit hash', () => {
    const out = run('create "Commit hash test"', gitDir);
    const id = extractId(out);

    // Add journal activity
    run(`log ${id} "Done"`, gitDir);

    // Make a commit and get its hash
    fs.writeFileSync(path.join(gitDir, 'feature.txt'), 'new feature');
    execSync('git add -A && git commit -m "feature work"', {
      cwd: gitDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    const commitHash = execSync('git rev-parse HEAD', {
      cwd: gitDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const closeOut = run(`close ${id} --verify --commit ${commitHash}`, gitDir);
    expect(closeOut).toContain('git-proof');
    expect(closeOut).toContain('Commit verified');

    const show = run(`show ${id}`, gitDir);
    expect(show).toContain('DONE');
  });

  it('fails git-proof with invalid --commit hash', () => {
    const out = run('create "Bad commit test"', gitDir);
    const id = extractId(out);

    run(`log ${id} "Done"`, gitDir);

    const closeOut = run(`close ${id} --verify --commit deadbeef123456`, gitDir);
    expect(closeOut).toContain('Commit not found');
  });

  it('detects recent commits even without task ID reference', () => {
    const out = run('create "Recent commit test"', gitDir);
    const id = extractId(out);

    run(`log ${id} "Working"`, gitDir);

    // Make a recent commit (not mentioning task ID)
    fs.writeFileSync(path.join(gitDir, 'stuff.txt'), 'work');
    execSync('git add -A && git commit -m "did some work"', {
      cwd: gitDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });

    const closeOut = run(`close ${id} --verify`, gitDir);
    expect(closeOut).toContain('git-proof');

    const show = run(`show ${id}`, gitDir);
    expect(show).toContain('DONE');
  });
});

describe('verify command', () => {
  it('--pass sets verification_status to passed', () => {
    const out = run('create "Verify pass"', testDir);
    const id = extractId(out);

    const verifyOut = run(`verify ${id} --pass --agent reviewer`, testDir);
    expect(verifyOut).toContain('PASSED');

    // Can now close without --verify
    const closeOut = run(`close ${id}`, testDir);
    expect(closeOut).not.toContain('Close blocked');
  });

  it('--fail sets verification_status to failed and reverts to open', () => {
    const out = run('create "Verify fail"', testDir);
    const id = extractId(out);

    // Set to wip first
    run(`status ${id} wip`, testDir);

    const verifyOut = run(`verify ${id} --fail --agent reviewer --reason "Tests broken"`, testDir);
    expect(verifyOut).toContain('FAILED');

    const show = run(`show ${id}`, testDir);
    expect(show).toContain('OPEN');
  });

  it('--checklist logs items to journal', () => {
    const out = run('create "Checklist test"', testDir);
    const id = extractId(out);

    run(`verify ${id} --checklist "tests pass,docs updated,code reviewed"`, testDir);

    const history = run(`history ${id}`, testDir);
    expect(history).toContain('tests pass');
    expect(history).toContain('docs updated');
    expect(history).toContain('code reviewed');
  });

  it('errors without a verification mode', () => {
    const out = run('create "No mode"', testDir);
    const id = extractId(out);

    const verifyOut = run(`verify ${id}`, testDir);
    expect(verifyOut).toContain('Specify a verification mode');
  });
});
