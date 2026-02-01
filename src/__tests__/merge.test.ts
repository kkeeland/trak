import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpDir, run, extractId } from './helpers';
import { hasConflictMarkers, resolveConflicts } from '../merge.js';

// ─── unit tests for merge module ────────────────────────
describe('hasConflictMarkers', () => {
  it('returns false for clean content', () => {
    expect(hasConflictMarkers('{"id":"trak-abc123"}\n')).toBe(false);
  });

  it('returns true for conflicted content', () => {
    const content = `{"id":"trak-shared1"}
<<<<<<< HEAD
{"id":"trak-abc123","updated_at":"2026-01-01T10:00:00Z"}
=======
{"id":"trak-abc123","updated_at":"2026-01-01T12:00:00Z"}
>>>>>>> branch
`;
    expect(hasConflictMarkers(content)).toBe(true);
  });
});

describe('resolveConflicts', () => {
  it('parses clean content without conflicts', () => {
    const task = JSON.stringify({
      id: 'trak-aaa111', title: 'Test', description: '', status: 'open',
      priority: 1, project: '', blocked_by: '', parent_id: null,
      epic_id: null, is_epic: 0, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z', agent_session: '', tokens_used: 0,
      cost_usd: 0, tags: '', assigned_to: '', verified_by: '',
      verification_status: '', created_from: '', verify_command: '',
      wip_snapshot: '', journal: [], deps: [], claims: [],
    });
    const result = resolveConflicts(task + '\n');
    expect(result.hadConflicts).toBe(false);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].id).toBe('trak-aaa111');
  });

  it('resolves conflicts using last-write-wins', () => {
    const shared = JSON.stringify({
      id: 'trak-shared', title: 'Shared', description: '', status: 'open',
      priority: 1, project: '', blocked_by: '', parent_id: null,
      epic_id: null, is_epic: 0, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z', agent_session: '', tokens_used: 0,
      cost_usd: 0, tags: '', assigned_to: '', verified_by: '',
      verification_status: '', created_from: '', verify_command: '',
      wip_snapshot: '', journal: [], deps: [], claims: [],
    });
    const ours = JSON.stringify({
      id: 'trak-conflict', title: 'Ours version', description: '', status: 'open',
      priority: 1, project: '', blocked_by: '', parent_id: null,
      epic_id: null, is_epic: 0, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T10:00:00Z', agent_session: '', tokens_used: 0,
      cost_usd: 0, tags: '', assigned_to: '', verified_by: '',
      verification_status: '', created_from: '', verify_command: '',
      wip_snapshot: '', journal: [], deps: [], claims: [],
    });
    const theirs = JSON.stringify({
      id: 'trak-conflict', title: 'Theirs version (newer)', description: '', status: 'open',
      priority: 1, project: '', blocked_by: '', parent_id: null,
      epic_id: null, is_epic: 0, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T12:00:00Z', agent_session: '', tokens_used: 0,
      cost_usd: 0, tags: '', assigned_to: '', verified_by: '',
      verification_status: '', created_from: '', verify_command: '',
      wip_snapshot: '', journal: [], deps: [], claims: [],
    });

    const content = `${shared}
<<<<<<< HEAD
${ours}
=======
${theirs}
>>>>>>> other-branch
`;

    const result = resolveConflicts(content);
    expect(result.hadConflicts).toBe(true);
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].taskId).toBe('trak-conflict');
    expect(result.resolutions[0].winner).toBe('theirs');
    expect(result.records).toHaveLength(2); // shared + conflict winner
    
    const conflictTask = result.records.find(r => r.id === 'trak-conflict');
    expect(conflictTask?.title).toBe('Theirs version (newer)');
  });

  it('keeps tasks unique to one side of a conflict', () => {
    const oursOnly = JSON.stringify({
      id: 'trak-ours01', title: 'Only in ours', description: '', status: 'open',
      priority: 1, project: '', blocked_by: '', parent_id: null,
      epic_id: null, is_epic: 0, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T10:00:00Z', agent_session: '', tokens_used: 0,
      cost_usd: 0, tags: '', assigned_to: '', verified_by: '',
      verification_status: '', created_from: '', verify_command: '',
      wip_snapshot: '', journal: [], deps: [], claims: [],
    });
    const theirsOnly = JSON.stringify({
      id: 'trak-their1', title: 'Only in theirs', description: '', status: 'open',
      priority: 1, project: '', blocked_by: '', parent_id: null,
      epic_id: null, is_epic: 0, created_at: '2026-01-01T01:00:00Z',
      updated_at: '2026-01-01T12:00:00Z', agent_session: '', tokens_used: 0,
      cost_usd: 0, tags: '', assigned_to: '', verified_by: '',
      verification_status: '', created_from: '', verify_command: '',
      wip_snapshot: '', journal: [], deps: [], claims: [],
    });

    const content = `<<<<<<< HEAD
${oursOnly}
=======
${theirsOnly}
>>>>>>> other
`;

    const result = resolveConflicts(content);
    expect(result.hadConflicts).toBe(true);
    expect(result.records).toHaveLength(2); // both kept (different IDs)
    expect(result.records.find(r => r.id === 'trak-ours01')).toBeDefined();
    expect(result.records.find(r => r.id === 'trak-their1')).toBeDefined();
  });
});

// ─── integration test: import with conflict markers ─────
describe('import with conflicts', () => {
  let testDir: string;
  beforeEach(() => { testDir = tmpDir(); run('init', testDir); });
  afterEach(() => { fs.rmSync(testDir, { recursive: true, force: true }); });

  it('import resolves conflicted JSONL and rebuilds DB', () => {
    // Create a task normally
    const out = run('create "Original task" -p 0', testDir);
    const id = extractId(out);
    run('sync', testDir);

    // Read the JSONL and inject a conflict
    const jsonlPath = path.join(testDir, '.trak', 'trak.jsonl');
    const original = fs.readFileSync(jsonlPath, 'utf-8').trim();
    const parsed = JSON.parse(original);
    
    const ours = { ...parsed, title: 'Ours edit', updated_at: '2026-06-01T10:00:00Z' };
    const theirs = { ...parsed, title: 'Theirs edit (newer)', updated_at: '2026-06-01T12:00:00Z' };

    const conflicted = `<<<<<<< HEAD
${JSON.stringify(ours)}
=======
${JSON.stringify(theirs)}
>>>>>>> remote
`;
    fs.writeFileSync(jsonlPath, conflicted);

    // Import should resolve
    const importOut = run('import', testDir);
    expect(importOut).toContain('conflict');
    expect(importOut).toContain('Imported');

    // Verify theirs won
    const showOut = run(`show ${id}`, testDir);
    expect(showOut).toContain('Theirs edit (newer)');

    // Verify JSONL was cleaned up
    const cleaned = fs.readFileSync(jsonlPath, 'utf-8');
    expect(cleaned).not.toContain('<<<<<<<');
    expect(cleaned).not.toContain('>>>>>>>');
  });
});
