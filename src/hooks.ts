/**
 * Trak Webhook Hooks — Fire events to configured endpoints
 *
 * When trak tasks are created, updated, closed, or change status,
 * this module fires webhook POSTs to any configured URL (e.g. Forge SSE ingest).
 *
 * Configure with:
 *   trak config set hooks.webhook.url "http://localhost:4200/api/trak/events"
 *   trak config set hooks.webhook.enabled true
 *
 * Events are fire-and-forget — never block CLI operations.
 */

import { getConfigValue, type Task } from './db.js';

// ─── Types ────────────────────────────────────────────────

export type TrakHookEventType =
  | 'trak.task.created'
  | 'trak.task.status_changed'
  | 'trak.task.closed'
  | 'trak.task.assigned'
  | 'trak.task.logged'
  | 'trak.task.updated';

export interface TrakHookEvent {
  type: TrakHookEventType;
  taskId: string;
  taskTitle: string;
  project: string;
  data: Record<string, unknown>;
  source: string;
}

// ─── Config ───────────────────────────────────────────────

function getWebhookUrl(): string | null {
  try {
    const url = getConfigValue('hooks.webhook.url');
    if (!url || typeof url !== 'string') return null;

    const enabled = getConfigValue('hooks.webhook.enabled');
    // Default to enabled if URL is set but enabled isn't explicitly false
    if (enabled === false || enabled === 'false') return null;

    return url;
  } catch {
    return null;
  }
}

function getWebhookSecret(): string | null {
  try {
    const secret = getConfigValue('hooks.webhook.secret');
    return (secret && typeof secret === 'string') ? secret : null;
  } catch {
    return null;
  }
}

// ─── Fire Webhook ─────────────────────────────────────────

/**
 * Fire a webhook event. Non-blocking, fire-and-forget.
 * Failures are silently ignored to never slow down the CLI.
 */
function fireWebhook(event: TrakHookEvent): void {
  const url = getWebhookUrl();
  if (!url) return;

  const secret = getWebhookSecret();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'trak-cli/1.0',
  };
  if (secret) {
    headers['X-Trak-Secret'] = secret;
  }

  // Use native fetch (Node 18+), fire-and-forget
  fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5000), // 5s timeout
  }).catch(() => {
    // Silently ignore — webhooks must never block CLI
  });
}

// ─── Public Hook Functions ────────────────────────────────

/** Fire when a task is created. */
export function hookTaskCreated(task: Task): void {
  fireWebhook({
    type: 'trak.task.created',
    taskId: task.id,
    taskTitle: task.title,
    project: task.project || '',
    data: {
      status: task.status,
      priority: task.priority,
      autonomy: task.autonomy,
      assigned_to: task.assigned_to || null,
      tags: task.tags || '',
      epic_id: task.epic_id || null,
    },
    source: 'trak-cli',
  });
}

/** Fire when a task status changes. */
export function hookTaskStatusChanged(task: Task, oldStatus: string, newStatus: string): void {
  fireWebhook({
    type: 'trak.task.status_changed',
    taskId: task.id,
    taskTitle: task.title,
    project: task.project || '',
    data: {
      from: oldStatus,
      to: newStatus,
      assigned_to: task.assigned_to || null,
    },
    source: 'trak-cli',
  });
}

/** Fire when a task is closed (done). */
export function hookTaskClosed(task: Task): void {
  fireWebhook({
    type: 'trak.task.closed',
    taskId: task.id,
    taskTitle: task.title,
    project: task.project || '',
    data: {
      previous_status: task.status,
      assigned_to: task.assigned_to || null,
      cost_usd: task.cost_usd || 0,
      tokens_used: task.tokens_used || 0,
    },
    source: 'trak-cli',
  });
}

/** Fire when a task is assigned. */
export function hookTaskAssigned(task: Task, agent: string): void {
  fireWebhook({
    type: 'trak.task.assigned',
    taskId: task.id,
    taskTitle: task.title,
    project: task.project || '',
    data: {
      assigned_to: agent,
      previous_assigned: task.assigned_to || null,
    },
    source: 'trak-cli',
  });
}

/** Fire when a journal entry is logged. */
export function hookTaskLogged(task: Task, entry: string, author: string): void {
  fireWebhook({
    type: 'trak.task.logged',
    taskId: task.id,
    taskTitle: task.title,
    project: task.project || '',
    data: {
      entry,
      author,
    },
    source: 'trak-cli',
  });
}
