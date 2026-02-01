/**
 * Clawdbot Gateway client for spawning sub-agents via the HTTP API.
 *
 * Discovery order:
 *   1. Environment: CLAWDBOT_GATEWAY_URL, CLAWDBOT_GATEWAY_TOKEN
 *   2. Config file: ~/.clawdbot/clawdbot.json
 *   3. Defaults: http://127.0.0.1:18789 (no token)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface GatewayConfig {
  url: string;
  token: string | null;
}

export interface SpawnRequest {
  task: string;
  label?: string;
  cleanup?: 'delete' | 'keep';
  runTimeoutSeconds?: number;
  model?: string;
}

export interface SpawnResult {
  ok: boolean;
  status?: string;
  runId?: string;
  childSessionKey?: string;
  error?: string;
}

/**
 * Resolve the gateway URL and auth token from env / config file.
 */
export function discoverGateway(): GatewayConfig {
  // 1. Environment overrides
  const envUrl = process.env.CLAWDBOT_GATEWAY_URL;
  const envToken = process.env.CLAWDBOT_GATEWAY_TOKEN;

  if (envUrl) {
    return { url: envUrl.replace(/\/$/, ''), token: envToken || null };
  }

  // 2. Read ~/.clawdbot/clawdbot.json
  try {
    const configPath = join(homedir(), '.clawdbot', 'clawdbot.json');
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    const gw = config.gateway || {};
    const port = gw.port || 18789;
    const bind = gw.bind || '127.0.0.1';
    const token = gw.auth?.token || envToken || null;

    // Resolve bind address
    let host: string;
    if (bind === 'tailnet') {
      // Try to resolve tailnet IP; fall back to 127.0.0.1
      host = resolveTailnetIp() || '127.0.0.1';
    } else if (bind === '0.0.0.0' || bind === '::') {
      host = '127.0.0.1';
    } else {
      host = bind;
    }

    const proto = gw.tls?.enabled ? 'https' : 'http';
    return { url: `${proto}://${host}:${port}`, token };
  } catch {
    // Config not readable — use defaults
  }

  // 3. Defaults
  return { url: 'http://127.0.0.1:18789', token: envToken || null };
}

/**
 * Try to get the tailnet IP from `tailscale ip -4` or hostname -I.
 */
function resolveTailnetIp(): string | null {
  try {
    const { execSync } = require('child_process');
    const ip = execSync('tailscale ip -4 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch {}

  // Fallback: check hostname -I for 100.x.x.x (Tailscale CGNAT range)
  try {
    const { execSync } = require('child_process');
    const ips = execSync('hostname -I 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim().split(/\s+/);
    const tsIp = ips.find((ip: string) => ip.startsWith('100.'));
    if (tsIp) return tsIp;
  } catch {}

  return null;
}

/**
 * Spawn a sub-agent via the gateway /tools/invoke endpoint.
 */
export async function spawnAgent(gw: GatewayConfig, req: SpawnRequest): Promise<SpawnResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (gw.token) {
    headers['Authorization'] = `Bearer ${gw.token}`;
  }

  const body = JSON.stringify({
    tool: 'sessions_spawn',
    args: {
      task: req.task,
      label: req.label,
      cleanup: req.cleanup || 'keep',
      runTimeoutSeconds: req.runTimeoutSeconds || 0,
      ...(req.model ? { model: req.model } : {}),
    },
    sessionKey: 'agent:main:main',
  });

  const resp = await fetch(`${gw.url}/tools/invoke`, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `HTTP ${resp.status}: ${text}` };
  }

  const data = await resp.json() as any;

  if (!data.ok) {
    return { ok: false, error: data.error?.message || 'Unknown gateway error' };
  }

  // Parse the result — sessions_spawn returns { status, runId, childSessionKey } inside result.content
  const result = data.result;
  if (result?.details) {
    return {
      ok: true,
      status: result.details.status,
      runId: result.details.runId,
      childSessionKey: result.details.childSessionKey,
    };
  }

  // Try to parse from text content
  if (result?.content?.[0]?.text) {
    try {
      const parsed = JSON.parse(result.content[0].text);
      return {
        ok: true,
        status: parsed.status,
        runId: parsed.runId,
        childSessionKey: parsed.childSessionKey,
      };
    } catch {}
  }

  return { ok: true, status: 'accepted' };
}

/**
 * Probe the gateway to check connectivity.
 */
export async function probeGateway(gw: GatewayConfig): Promise<boolean> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (gw.token) {
      headers['Authorization'] = `Bearer ${gw.token}`;
    }

    const resp = await fetch(`${gw.url}/tools/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: 'sessions_list', action: 'json', args: {} }),
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
