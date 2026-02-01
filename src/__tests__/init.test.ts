import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpDir, run } from './helpers';

let testDir: string;
beforeEach(() => { testDir = tmpDir(); });
afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

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

  it('creates .trak/.gitignore with correct content', () => {
    run('init', testDir);
    const gitignorePath = path.join(testDir, '.trak', '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('trak.db');
    expect(content).toContain('!trak.jsonl');
  });

  it('allows local init even when sibling project has .trak/', () => {
    // Create two project dirs
    const projA = path.join(testDir, 'projA');
    const projB = path.join(testDir, 'projB');
    fs.mkdirSync(projA, { recursive: true });
    fs.mkdirSync(projB, { recursive: true });

    run('init', projA);
    expect(fs.existsSync(path.join(projA, '.trak', 'trak.db'))).toBe(true);

    run('init', projB);
    expect(fs.existsSync(path.join(projB, '.trak', 'trak.db'))).toBe(true);
  });

  it('auto-imports existing trak.jsonl on init', () => {
    // Pre-create .trak dir with a JSONL but no DB
    const trakDir = path.join(testDir, '.trak');
    fs.mkdirSync(trakDir, { recursive: true });
    const jsonlContent = JSON.stringify({
      id: 'trak-aaaaaa', title: 'Test task', description: '', status: 'open',
      priority: 1, project: '', blocked_by: '', parent_id: null, epic_id: null,
      is_epic: 0, created_at: '2025-01-01', updated_at: '2025-01-01',
      agent_session: '', tokens_used: 0, cost_usd: 0, tags: '',
      assigned_to: '', verified_by: '', verification_status: '',
      created_from: '', verify_command: '', wip_snapshot: '',
      autonomy: 'manual', budget_usd: null, journal: [], deps: [], claims: []
    }) + '\n';
    fs.writeFileSync(path.join(trakDir, 'trak.jsonl'), jsonlContent);

    const out = run('init', testDir);
    expect(out).toContain('Imported 1 tasks');
    expect(fs.existsSync(path.join(trakDir, 'trak.db'))).toBe(true);
  });
});
