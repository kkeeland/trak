import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export const TRAK_BIN = path.resolve(__dirname, '../../dist/cli.js');
const NODE = process.execPath;

export function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'trak-test-'));
}

export const TEST_ENV = { ...process.env, NODE_ENV: 'test', NO_COLOR: '1', HOME: '/tmp/trak-no-home' };

// Simple arg parser that respects quotes
function parseArgs(cmd: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (inQuote) {
      if (c === quoteChar) { inQuote = false; }
      else { current += c; }
    } else if (c === '"' || c === "'") {
      inQuote = true;
      quoteChar = c;
    } else if (c === ' ') {
      if (current) { args.push(current); current = ''; }
    } else {
      current += c;
    }
  }
  if (current) args.push(current);
  return args;
}

export function run(cmd: string, cwd: string): string {
  try {
    return execFileSync(NODE, [TRAK_BIN, ...parseArgs(cmd)], {
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
  return execFileSync(NODE, [TRAK_BIN, ...parseArgs(cmd)], {
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
