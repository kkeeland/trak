/**
 * Clawdbot Gateway client — native dispatch via /tools/invoke HTTP API.
 *
 * Discovery order:
 *   1. Environment: CLAWDBOT_GATEWAY_URL, CLAWDBOT_GATEWAY_TOKEN
 *   2. Config file: ~/.clawdbot/clawdbot.json
 *   3. Defaults: http://127.0.0.1:18789 (no token)
 *
 * Features:
 *   - Auto-discover gateway from env/config
 *   - Spawn sub-agents via sessions_spawn
 *   - Poll session status until completion
 *   - List active sessions
 *   - Retry with exponential backoff
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ────────────────────────────────────────────────

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

export interface SessionInfo {
  key: string;
  label?: string;
  channel?: string;
  model?: string;
  totalTokens?: number;
  updatedAt?: number;
  abortedLastRun?: boolean;
}

export interface InvokeResult {
  ok: boolean;
  result?: any;
  error?: string;
}

// ─── Gateway Discovery ───────────────────────────────────

/** Cached gateway config — avoids re-reading config file every call. */
let _cachedGw: GatewayConfig | null = null;

/**
 * Resolve the gateway URL and auth token from env / config file.
 */
export function discoverGateway(): GatewayConfig {
  if (_cachedGw) return _cachedGw;

  // 1. Environment overrides
  const envUrl = process.env.CLAWDBOT_GATEWAY_URL;
  const envToken = process.env.CLAWDBOT_GATEWAY_TOKEN;

  if (envUrl) {
    _cachedGw = { url: envUrl.replace(/\/$/, ''), token: envToken || null };
    return _cachedGw;
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
      host = resolveTailnetIp() || '127.0.0.1';
    } else if (bind === '0.0.0.0' || bind === '::') {
      host = '127.0.0.1';
    } else {
      host = bind;
    }

    const proto = gw.tls?.enabled ? 'https' : 'http';
    _cachedGw = { url: `${proto}://${host}:${port}`, token };
    return _cachedGw;
  } catch {
    // Config not readable — use defaults
  }

  // 3. Defaults
  _cachedGw = { url: 'http://127.0.0.1:18789', token: envToken || null };
  return _cachedGw;
}

/** Clear the cached gateway config (for testing). */
export function resetGatewayCache(): void {
  _cachedGw = null;
}

// ─── Helpers ──────────────────────────────────────────────

function resolveTailnetIp(): string | null {
  try {
    const { execSync } = require('child_process');
    const ip = execSync('tailscale ip -4 2>/dev/null', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  } catch {}

  try {
    const { execSync } = require('child_process');
    const ips = execSync('hostname -I 2>/dev/null', { encoding: 'utf-8', timeout: 2000 }).trim().split(/\s+/);
    const tsIp = ips.find((ip: string) => ip.startsWith('100.'));
    if (tsIp) return tsIp;
  } catch {}

  return null;
}

function buildHeaders(gw: GatewayConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (gw.token) headers['Authorization'] = `Bearer ${gw.token}`;
  return headers;
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Core API ─────────────────────────────────────────────

/**
 * Invoke a tool on the gateway. Low-level — use higher-level helpers below.
 */
export async function invokeGatewayTool(
  gw: GatewayConfig,
  tool: string,
  args: Record<string, unknown>,
  opts?: { timeout?: number; sessionKey?: string },
): Promise<InvokeResult> {
  const body = JSON.stringify({
    tool,
    args,
    ...(opts?.sessionKey ? { sessionKey: opts.sessionKey } : {}),
  });

  const resp = await fetch(`${gw.url}/tools/invoke`, {
    method: 'POST',
    headers: buildHeaders(gw),
    body,
    signal: AbortSignal.timeout(opts?.timeout || 15000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { ok: false, error: `HTTP ${resp.status}: ${text}` };
  }

  const data = await resp.json() as any;

  if (!data.ok) {
    return { ok: false, error: data.error?.message || 'Unknown gateway error' };
  }

  return { ok: true, result: data.result };
}

/**
 * Invoke a tool with retry (exponential backoff).
 */
export async function invokeWithRetry(
  gw: GatewayConfig,
  tool: string,
  args: Record<string, unknown>,
  opts?: { timeout?: number; sessionKey?: string; maxRetries?: number },
): Promise<InvokeResult> {
  const maxRetries = opts?.maxRetries ?? 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await invokeGatewayTool(gw, tool, args, opts);

      // Don't retry on auth errors or tool-level rejections
      if (!result.ok && result.error?.includes('401')) return result;
      if (!result.ok && result.error?.includes('403')) return result;

      if (result.ok) return result;

      // Retry on transient errors
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
        continue;
      }

      return result;
    } catch (err: any) {
      if (attempt < maxRetries) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      return { ok: false, error: err.message || String(err) };
    }
  }

  return { ok: false, error: 'Max retries exceeded' };
}

// ─── Session Operations ───────────────────────────────────

/**
 * Spawn a sub-agent via sessions_spawn.
 */
export async function spawnAgent(gw: GatewayConfig, req: SpawnRequest): Promise<SpawnResult> {
  const result = await invokeWithRetry(
    gw,
    'sessions_spawn',
    {
      task: req.task,
      label: req.label,
      cleanup: req.cleanup || 'keep',
      runTimeoutSeconds: req.runTimeoutSeconds || 0,
      ...(req.model ? { model: req.model } : {}),
    },
    { sessionKey: 'agent:main:main', timeout: 15000 },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  // Parse spawn result from gateway response
  const details = result.result?.details;
  if (details) {
    return {
      ok: true,
      status: details.status,
      runId: details.runId,
      childSessionKey: details.childSessionKey,
    };
  }

  // Fallback: parse from text content
  const text = result.result?.content?.[0]?.text;
  if (text) {
    try {
      const parsed = JSON.parse(text);
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
 * List active sessions.
 */
export async function listSessions(gw: GatewayConfig): Promise<SessionInfo[]> {
  const result = await invokeGatewayTool(gw, 'sessions_list', {}, { timeout: 10000 });

  if (!result.ok) return [];

  const details = result.result?.details;
  if (details?.sessions) {
    return details.sessions.map((s: any) => ({
      key: s.key,
      label: s.label,
      channel: s.channel,
      model: s.model,
      totalTokens: s.totalTokens,
      updatedAt: s.updatedAt,
      abortedLastRun: s.abortedLastRun,
    }));
  }

  return [];
}

/**
 * Check if a specific session (by label prefix) is still running.
 */
export async function isSessionActive(gw: GatewayConfig, labelPrefix: string): Promise<boolean> {
  const sessions = await listSessions(gw);
  return sessions.some(s => s.label?.startsWith(labelPrefix));
}

/**
 * Probe the gateway to check connectivity.
 */
export async function probeGateway(gw: GatewayConfig): Promise<boolean> {
  try {
    const resp = await fetch(`${gw.url}/tools/invoke`, {
      method: 'POST',
      headers: buildHeaders(gw),
      body: JSON.stringify({ tool: 'sessions_list', args: {} }),
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Quick check: is the gateway reachable? Returns config if yes, null if no.
 */
export async function ensureGateway(): Promise<GatewayConfig | null> {
  const gw = discoverGateway();
  const ok = await probeGateway(gw);
  return ok ? gw : null;
}
