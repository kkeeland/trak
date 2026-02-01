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
});
