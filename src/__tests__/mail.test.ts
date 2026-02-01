import { describe, it, expect, beforeEach } from 'vitest';
import { run, runOrThrow, extractId, tmpDir, TEST_ENV } from './helpers';
import { execFileSync } from 'child_process';
import path from 'path';

const TRAK_BIN = path.resolve(__dirname, '../../dist/cli.js');
const NODE = process.execPath;

function parseArgs(cmd: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ') {
      if (current) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

function runAs(cmd: string, cwd: string, agent: string): string {
  try {
    return execFileSync(NODE, [TRAK_BIN, ...parseArgs(cmd)], {
      cwd,
      env: { ...TEST_ENV, TRAK_AGENT: agent },
      encoding: 'utf-8',
      timeout: 5000,
    });
  } catch (e: any) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

let cwd: string;

beforeEach(() => {
  cwd = tmpDir();
  run('init', cwd);
});

describe('mailbox system', () => {
  it('sends a message', () => {
    const out = runAs('mail send agent-b "Hello from agent A"', cwd, 'agent-a');
    expect(out).toContain('Message sent');
    expect(out).toContain('agent-b');
  });

  it('checks inbox for unread messages', () => {
    runAs('mail send agent-b "Task is done"', cwd, 'agent-a');
    const check = runAs('mail check --agent agent-b', cwd, 'agent-b');
    expect(check).toContain('1 unread');
    expect(check).toContain('Task is done');
    expect(check).toContain('agent-a');
  });

  it('marks messages as read', () => {
    runAs('mail send agent-b "First message"', cwd, 'agent-a');
    // Get the message ID from the list
    const list = runAs('mail list --agent agent-b', cwd, 'agent-b');
    const idMatch = list.match(/#(\d+)/);
    expect(idMatch).toBeTruthy();
    const mailId = idMatch![1];

    const readOut = runAs(`mail read ${mailId}`, cwd, 'agent-b');
    expect(readOut).toContain('Marked message');
    expect(readOut).toContain('as read');

    // Check should now show no unread
    const check = runAs('mail check --agent agent-b', cwd, 'agent-b');
    expect(check).toContain('No unread');
  });

  it('lists all messages with --all', () => {
    runAs('mail send agent-b "msg 1"', cwd, 'agent-a');
    runAs('mail send agent-c "msg 2"', cwd, 'agent-a');
    const list = runAs('mail list --all', cwd, 'agent-a');
    expect(list).toContain('msg 1');
    expect(list).toContain('msg 2');
  });

  it('supports broadcast messages to all', () => {
    runAs('mail send all "Deployment at 5pm"', cwd, 'ops');
    const checkA = runAs('mail check --agent agent-a', cwd, 'agent-a');
    expect(checkA).toContain('Deployment at 5pm');
    const checkB = runAs('mail check --agent agent-b', cwd, 'agent-b');
    expect(checkB).toContain('Deployment at 5pm');
  });

  it('links a message to a task', () => {
    const taskOut = runOrThrow('create "API endpoint"', cwd);
    const taskId = extractId(taskOut);
    const out = runAs(`mail send agent-b "API is ready" --task ${taskId}`, cwd, 'agent-a');
    expect(out).toContain('Message sent');
    expect(out).toContain(taskId);
  });

  it('shows empty inbox', () => {
    const check = runAs('mail check --agent lonely-agent', cwd, 'lonely-agent');
    expect(check).toContain('No unread');
  });
});
