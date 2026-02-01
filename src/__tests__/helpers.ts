import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const TRAK_BIN = path.resolve(__dirname, '../../dist/cli.js');

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trak-test-'));
}

export const TEST_ENV = { ...process.env, NODE_ENV: 'test', NO_COLOR: '1', HOME: '/tmp/trak-no-home' };

export function run(cmd: string, cwd: string): string {
  try {
    return execSync(`node ${TRAK_BIN} ${cmd}`, {
      cwd,
      env: TEST_ENV,
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch (e: any) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

export function runOrThrow(cmd: string, cwd: string): string {
  return execSync(`node ${TRAK_BIN} ${cmd}`, {
    cwd,
    env: TEST_ENV,
    encoding: 'utf-8',
    timeout: 5000,
  });
}

export function extractId(output: string): string {
  const match = output.match(/trak-[a-f0-9]{6}/);
  if (!match) throw new Error(`No task ID found in: ${output}`);
  return match[0];
}
