import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { tmpDir, run, extractId } from './helpers';

let testDir: string;
beforeEach(() => { testDir = tmpDir(); run('init', testDir); });
afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

// ─── assign ────────────────────────────────────────────
describe('assign', () => {
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

// ─── verify ────────────────────────────────────────────
describe('verify', () => {
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

// ─── claim ─────────────────────────────────────────────
describe('claim', () => {
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
