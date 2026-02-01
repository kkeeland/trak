/**
 * trak review — Review Gate & Action Queue
 *
 * Staged approval pipeline between sandbox and production.
 * Every expert output goes to a review queue (never direct to production).
 *
 * Subcommands:
 *   list        — Show pending review items with age/SLA indicators
 *   show <id>   — Show review item detail with diff view
 *   approve     — Approve a review item (moves to done)
 *   reject      — Reject a review item (moves back to open)
 *   request     — Request changes on a review item
 *   batch       — Batch approve multiple low-risk items
 *   rules       — Manage auto-approve rules engine
 *   sla         — Show SLA tracking dashboard
 */

import { getDb, Task, afterWrite, getConfigValue, setConfigValue } from '../db.js';
import { c, formatDate, truncate, STATUS_EMOJI } from '../utils.js';
import { hookTaskStatusChanged, hookTaskClosed } from '../hooks.js';

// ─── Types ────────────────────────────────────────────────

export interface ReviewItem {
  task: Task;
  queuedAt: string;       // When it entered review status
  ageMinutes: number;      // How long in queue
  riskTier: RiskTier;      // Calculated risk tier
  autoApprovable: boolean; // Whether auto-approve rules match
  slaBreached: boolean;    // Whether SLA is breached
}

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface AutoApproveRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: RuleCondition[];
  maxRiskTier: RiskTier;
  createdAt: string;
}

export interface RuleCondition {
  field: string;          // 'project' | 'tags' | 'priority' | 'agent' | 'cost_usd' | 'tokens_used'
  operator: string;       // 'eq' | 'neq' | 'contains' | 'lt' | 'gt' | 'lte' | 'gte'
  value: string | number;
}

export interface ReviewListOptions {
  project?: string;
  risk?: string;
  breached?: boolean;
  all?: boolean;
  json?: boolean;
}

export interface ReviewApproveOptions {
  agent?: string;
  reason?: string;
  force?: boolean;
}

export interface ReviewRejectOptions {
  agent?: string;
  reason?: string;
}

export interface ReviewRequestOptions {
  agent?: string;
  message?: string;
}

export interface ReviewBatchOptions {
  project?: string;
  risk?: string;
  dryRun?: boolean;
  agent?: string;
  limit?: string;
}

export interface ReviewRulesOptions {
  json?: boolean;
}

export interface ReviewSlaOptions {
  project?: string;
  json?: boolean;
}

// ─── Risk Tier Calculation ────────────────────────────────

const RISK_TIER_ORDER: RiskTier[] = ['low', 'medium', 'high', 'critical'];

function riskTierIndex(tier: RiskTier): number {
  return RISK_TIER_ORDER.indexOf(tier);
}

function riskTierColor(tier: RiskTier): string {
  switch (tier) {
    case 'low': return c.green;
    case 'medium': return c.yellow;
    case 'high': return c.red;
    case 'critical': return `${c.bgRed}${c.white}`;
    default: return c.white;
  }
}

function riskTierEmoji(tier: RiskTier): string {
  switch (tier) {
    case 'low': return '🟢';
    case 'medium': return '🟡';
    case 'high': return '🔴';
    case 'critical': return '🚨';
    default: return '⚪';
  }
}

/**
 * Calculate risk tier for a task based on multiple signals.
 * Risk factors:
 *   - Priority (P3 = critical, P2 = high, P1 = medium, P0 = low)
 *   - Cost threshold (> $1 = high, > $0.10 = medium)
 *   - Token usage (> 100k = high, > 10k = medium)
 *   - Has dependencies (fan-out increases risk)
 *   - Project-level risk config
 */
export function calculateRiskTier(db: ReturnType<typeof getDb>, task: Task): RiskTier {
  let riskScore = 0;

  // Priority signal
  riskScore += task.priority; // P0=0, P1=1, P2=2, P3=3

  // Cost signal
  if (task.cost_usd > 1.0) riskScore += 2;
  else if (task.cost_usd > 0.10) riskScore += 1;

  // Token signal
  const totalTokens = task.tokens_used || (task.tokens_in + task.tokens_out);
  if (totalTokens > 100000) riskScore += 2;
  else if (totalTokens > 10000) riskScore += 1;

  // Fan-out signal (tasks that depend on this one)
  const dependents = db.prepare('SELECT COUNT(*) as cnt FROM dependencies WHERE parent_id = ?')
    .get(task.id) as { cnt: number };
  if (dependents.cnt > 3) riskScore += 2;
  else if (dependents.cnt > 0) riskScore += 1;

  // Project-level risk override
  const projectRisk = getConfigValue(`review.risk.${task.project}`);
  if (projectRisk && RISK_TIER_ORDER.includes(projectRisk)) {
    const overrideIdx = riskTierIndex(projectRisk as RiskTier);
    return RISK_TIER_ORDER[Math.max(overrideIdx, riskScore >= 5 ? 3 : riskScore >= 3 ? 2 : riskScore >= 1 ? 1 : 0)];
  }

  // Map score to tier
  if (riskScore >= 5) return 'critical';
  if (riskScore >= 3) return 'high';
  if (riskScore >= 1) return 'medium';
  return 'low';
}

// ─── SLA Configuration ───────────────────────────────────

interface SlaConfig {
  low: number;      // minutes
  medium: number;
  high: number;
  critical: number;
}

function getSlaConfig(): SlaConfig {
  const config = getConfigValue('review.sla');
  if (config && typeof config === 'object') {
    return {
      low: config.low ?? 1440,       // 24h
      medium: config.medium ?? 480,   // 8h
      high: config.high ?? 120,       // 2h
      critical: config.critical ?? 30, // 30min
    };
  }
  return { low: 1440, medium: 480, high: 120, critical: 30 };
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.floor(minutes % 60)}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

// ─── Queue Helpers ────────────────────────────────────────

function getReviewQueue(db: ReturnType<typeof getDb>, opts?: { project?: string; risk?: string }): ReviewItem[] {
  let query = "SELECT * FROM tasks WHERE status = 'review'";
  const params: any[] = [];

  if (opts?.project) {
    query += ' AND project = ?';
    params.push(opts.project);
  }

  query += ' ORDER BY priority DESC, updated_at ASC';

  const tasks = db.prepare(query).all(...params) as Task[];
  const slaConfig = getSlaConfig();

  return tasks.map(task => {
    // Find when the task entered review status from journal
    const reviewLog = db.prepare(
      "SELECT timestamp FROM task_log WHERE task_id = ? AND (entry LIKE '%status%review%' OR entry LIKE '%Close blocked%' OR entry LIKE '%review%') ORDER BY timestamp DESC LIMIT 1"
    ).get(task.id) as { timestamp: string } | undefined;

    const queuedAt = reviewLog?.timestamp || task.updated_at;
    const ageMs = Date.now() - new Date(queuedAt).getTime();
    const ageMinutes = ageMs / 60000;

    const riskTier = calculateRiskTier(db, task);
    const slaMinutes = slaConfig[riskTier];
    const slaBreached = ageMinutes > slaMinutes;

    const autoApprovable = checkAutoApproveRules(db, task, riskTier);

    return { task, queuedAt, ageMinutes, riskTier, autoApprovable, slaBreached };
  }).filter(item => {
    if (opts?.risk) {
      return item.riskTier === opts.risk;
    }
    return true;
  });
}

// ─── Auto-Approve Rules Engine ────────────────────────────

function getAutoApproveRules(): AutoApproveRule[] {
  const rules = getConfigValue('review.autoApproveRules');
  if (Array.isArray(rules)) return rules;
  return [];
}

function setAutoApproveRules(rules: AutoApproveRule[]): void {
  setConfigValue('review.autoApproveRules', rules);
}

function evaluateCondition(task: Task, condition: RuleCondition): boolean {
  let fieldValue: any;
  switch (condition.field) {
    case 'project': fieldValue = task.project; break;
    case 'tags': fieldValue = task.tags; break;
    case 'priority': fieldValue = task.priority; break;
    case 'agent':
    case 'assigned_to': fieldValue = task.assigned_to; break;
    case 'cost_usd': fieldValue = task.cost_usd; break;
    case 'tokens_used': fieldValue = task.tokens_used || (task.tokens_in + task.tokens_out); break;
    case 'autonomy': fieldValue = task.autonomy; break;
    case 'verification_status': fieldValue = task.verification_status; break;
    default: return false;
  }

  const val = condition.value;
  switch (condition.operator) {
    case 'eq': return String(fieldValue) === String(val);
    case 'neq': return String(fieldValue) !== String(val);
    case 'contains': return String(fieldValue).includes(String(val));
    case 'lt': return Number(fieldValue) < Number(val);
    case 'gt': return Number(fieldValue) > Number(val);
    case 'lte': return Number(fieldValue) <= Number(val);
    case 'gte': return Number(fieldValue) >= Number(val);
    default: return false;
  }
}

function checkAutoApproveRules(db: ReturnType<typeof getDb>, task: Task, riskTier: RiskTier): boolean {
  const rules = getAutoApproveRules();
  if (rules.length === 0) return false;

  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Risk tier must be within the rule's max
    if (riskTierIndex(riskTier) > riskTierIndex(rule.maxRiskTier)) continue;

    // All conditions must match
    const allMatch = rule.conditions.every(cond => evaluateCondition(task, cond));
    if (allMatch) return true;
  }

  return false;
}

// ─── Approve / Reject / Request Changes ──────────────────

function approveTask(db: ReturnType<typeof getDb>, task: Task, agent: string, reason?: string): void {
  const oldStatus = task.status;
  db.prepare("UPDATE tasks SET status = 'done', verification_status = 'passed', verified_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(agent, task.id);

  const logEntry = [
    `✅ APPROVED by ${agent}`,
    reason ? `Reason: ${reason}` : '',
    `Review duration: ${formatDuration((Date.now() - new Date(task.updated_at).getTime()) / 60000)}`,
  ].filter(Boolean).join('\n');

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)").run(task.id, logEntry, agent);
  afterWrite(db);

  hookTaskStatusChanged(task, oldStatus, 'done');
  hookTaskClosed(task);

  // Check for unblocked tasks (same pattern as close.ts)
  const unblockedTasks = db.prepare(`
    SELECT t.* FROM tasks t
    JOIN dependencies d ON d.child_id = t.id AND d.parent_id = ?
    WHERE t.status IN ('open', 'wip', 'blocked')
    AND NOT EXISTS (
      SELECT 1 FROM dependencies d2
      JOIN tasks dep ON dep.id = d2.parent_id
      WHERE d2.child_id = t.id
      AND dep.status NOT IN ('done', 'archived')
    )
  `).all(task.id) as Task[];

  if (unblockedTasks.length > 0) {
    console.log(`  ${c.cyan}⚡ Unblocked:${c.reset} ${unblockedTasks.map(t => `${t.id} (${t.title})`).join(', ')}`);
  }
}

function rejectTask(db: ReturnType<typeof getDb>, task: Task, agent: string, reason?: string): void {
  const oldStatus = task.status;
  db.prepare("UPDATE tasks SET status = 'open', verification_status = 'failed', verified_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(agent, task.id);

  const logEntry = [
    `❌ REJECTED by ${agent}`,
    reason ? `Reason: ${reason}` : 'No reason provided',
    `Returned to open for rework`,
  ].join('\n');

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)").run(task.id, logEntry, agent);
  afterWrite(db);

  hookTaskStatusChanged(task, oldStatus, 'open');
}

function requestChangesOnTask(db: ReturnType<typeof getDb>, task: Task, agent: string, message?: string): void {
  // Keep in review status but log the request
  db.prepare("UPDATE tasks SET verification_status = 'changes_requested', verified_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(agent, task.id);

  const logEntry = [
    `🔄 CHANGES REQUESTED by ${agent}`,
    message ? `Details: ${message}` : 'No details provided',
  ].join('\n');

  db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, ?)").run(task.id, logEntry, agent);
  afterWrite(db);
}

// ─── Find task helper ─────────────────────────────────────

function findTask(db: ReturnType<typeof getDb>, id: string): Task {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? OR id LIKE ?').get(id, `%${id}%`) as Task | undefined;
  if (!task) {
    console.error(`${c.red}Task not found: ${id}${c.reset}`);
    process.exit(1);
  }
  return task;
}

// ─── Command Handlers ─────────────────────────────────────

/**
 * trak review list — Show all items in the review queue
 */
export function reviewListCommand(opts: ReviewListOptions): void {
  const db = getDb();
  const items = getReviewQueue(db, { project: opts.project, risk: opts.risk });

  if (opts.json) {
    console.log(JSON.stringify(items.map(item => ({
      id: item.task.id,
      title: item.task.title,
      project: item.task.project,
      priority: item.task.priority,
      riskTier: item.riskTier,
      ageMinutes: Math.round(item.ageMinutes),
      slaBreached: item.slaBreached,
      autoApprovable: item.autoApprovable,
      assignedTo: item.task.assigned_to,
      verificationStatus: item.task.verification_status,
    })), null, 2));
    return;
  }

  if (items.length === 0) {
    console.log(`\n${c.green}✓${c.reset} Review queue is empty — nothing pending\n`);
    return;
  }

  const slaConfig = getSlaConfig();

  // Header
  console.log(`\n${c.bold}📋 REVIEW QUEUE${c.reset} — ${items.length} item${items.length === 1 ? '' : 's'} pending\n`);

  // SLA summary
  const breached = items.filter(i => i.slaBreached).length;
  if (breached > 0) {
    console.log(`  ${c.red}⚠ ${breached} SLA breach${breached === 1 ? '' : 'es'}${c.reset}\n`);
  }

  // Auto-approvable count
  const autoCount = items.filter(i => i.autoApprovable).length;
  if (autoCount > 0) {
    console.log(`  ${c.green}⚡ ${autoCount} auto-approvable${c.reset} (use ${c.bold}trak review batch${c.reset})\n`);
  }

  // Table
  const header = `  ${c.dim}${'ID'.padEnd(14)} ${'TITLE'.padEnd(30)} ${'PROJECT'.padEnd(12)} ${'RISK'.padEnd(10)} ${'AGE'.padEnd(10)} ${'SLA'.padEnd(8)} ${'AGENT'.padEnd(12)}${c.reset}`;
  console.log(header);
  console.log(`  ${c.dim}${'─'.repeat(100)}${c.reset}`);

  for (const item of items) {
    const { task, riskTier, ageMinutes, slaBreached, autoApprovable } = item;
    const slaMinutes = slaConfig[riskTier];
    const slaPercent = Math.round((ageMinutes / slaMinutes) * 100);

    const slaIndicator = slaBreached
      ? `${c.red}BREACH${c.reset}`
      : slaPercent > 75
        ? `${c.yellow}${slaPercent}%${c.reset}`
        : `${c.green}${slaPercent}%${c.reset}`;

    const autoIcon = autoApprovable ? ` ${c.green}⚡${c.reset}` : '';
    const riskLabel = `${riskTierColor(riskTier)}${riskTier.toUpperCase()}${c.reset}`;

    console.log(
      `  ${c.dim}${task.id.padEnd(14)}${c.reset} ` +
      `${truncate(task.title, 30).padEnd(30)} ` +
      `${(task.project || '-').padEnd(12)} ` +
      `${riskTierEmoji(riskTier)} ${riskLabel.padEnd(18)} ` +
      `${formatDuration(ageMinutes).padEnd(10)} ` +
      `${slaIndicator.padEnd(16)} ` +
      `${(task.assigned_to || '-').padEnd(12)}` +
      autoIcon
    );
  }

  console.log(`\n  ${c.dim}SLA targets: low=${formatDuration(slaConfig.low)} med=${formatDuration(slaConfig.medium)} high=${formatDuration(slaConfig.high)} crit=${formatDuration(slaConfig.critical)}${c.reset}\n`);
}

/**
 * trak review show <id> — Detailed view of a review item with diff
 */
export function reviewShowCommand(id: string): void {
  const db = getDb();
  const task = findTask(db, id);

  if (task.status !== 'review') {
    console.log(`${c.yellow}⚠${c.reset} Task ${task.id} is not in review (status: ${task.status})`);
  }

  const riskTier = calculateRiskTier(db, task);
  const slaConfig = getSlaConfig();
  const ageMs = Date.now() - new Date(task.updated_at).getTime();
  const ageMinutes = ageMs / 60000;
  const slaMinutes = slaConfig[riskTier];
  const slaBreached = ageMinutes > slaMinutes;

  console.log(`\n${c.bold}📋 REVIEW: ${task.id}${c.reset}`);
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);
  console.log(`  ${c.bold}Title:${c.reset}    ${task.title}`);
  if (task.description) {
    console.log(`  ${c.bold}Desc:${c.reset}     ${task.description}`);
  }
  console.log(`  ${c.bold}Project:${c.reset}  ${task.project || '-'}`);
  console.log(`  ${c.bold}Priority:${c.reset} P${task.priority}`);
  console.log(`  ${c.bold}Risk:${c.reset}     ${riskTierEmoji(riskTier)} ${riskTierColor(riskTier)}${riskTier.toUpperCase()}${c.reset}`);
  console.log(`  ${c.bold}Agent:${c.reset}    ${task.assigned_to || '-'}`);
  console.log(`  ${c.bold}In queue:${c.reset} ${formatDuration(ageMinutes)}`);
  console.log(`  ${c.bold}SLA:${c.reset}      ${slaBreached ? `${c.red}BREACHED${c.reset} (limit: ${formatDuration(slaMinutes)})` : `${c.green}OK${c.reset} (${Math.round((ageMinutes / slaMinutes) * 100)}% of ${formatDuration(slaMinutes)})`}`);

  if (task.verification_status) {
    const vsColor = task.verification_status === 'passed' ? c.green
      : task.verification_status === 'failed' ? c.red
      : c.yellow;
    console.log(`  ${c.bold}Verified:${c.reset} ${vsColor}${task.verification_status}${c.reset}${task.verified_by ? ` by ${task.verified_by}` : ''}`);
  }

  if (task.cost_usd > 0) {
    console.log(`  ${c.bold}Cost:${c.reset}     $${task.cost_usd.toFixed(4)}`);
  }
  if (task.tokens_used > 0 || task.tokens_in > 0) {
    const tokens = task.tokens_used || (task.tokens_in + task.tokens_out);
    console.log(`  ${c.bold}Tokens:${c.reset}   ${tokens.toLocaleString()}`);
  }

  // Show recent journal entries
  const logs = db.prepare(
    'SELECT * FROM task_log WHERE task_id = ? ORDER BY timestamp DESC LIMIT 10'
  ).all(task.id) as { id: number; task_id: string; timestamp: string; entry: string; author: string }[];

  if (logs.length > 0) {
    console.log(`\n  ${c.bold}Recent Activity:${c.reset}`);
    for (const log of logs.reverse()) {
      const age = formatDate(log.timestamp);
      const lines = log.entry.split('\n');
      console.log(`  ${c.dim}${age}${c.reset} ${c.cyan}[${log.author}]${c.reset} ${lines[0]}`);
      for (const line of lines.slice(1, 4)) {
        console.log(`    ${c.dim}${line}${c.reset}`);
      }
      if (lines.length > 4) {
        console.log(`    ${c.dim}... (${lines.length - 4} more lines)${c.reset}`);
      }
    }
  }

  // Show dependents
  const dependents = db.prepare(
    'SELECT t.id, t.title, t.status FROM tasks t JOIN dependencies d ON d.child_id = t.id WHERE d.parent_id = ?'
  ).all(task.id) as { id: string; title: string; status: string }[];

  if (dependents.length > 0) {
    console.log(`\n  ${c.bold}Blocks:${c.reset}`);
    for (const dep of dependents) {
      console.log(`    ${c.dim}${dep.id}${c.reset} ${dep.title} ${c.dim}(${dep.status})${c.reset}`);
    }
  }

  console.log(`\n  ${c.dim}Actions: trak review approve ${task.id} | reject ${task.id} | request ${task.id}${c.reset}\n`);
}

/**
 * trak review approve <id>
 */
export function reviewApproveCommand(id: string, opts: ReviewApproveOptions): void {
  const db = getDb();
  const task = findTask(db, id);
  const agent = opts.agent || 'human';

  if (task.status !== 'review' && !opts.force) {
    console.error(`${c.red}Task ${task.id} is not in review (status: ${task.status}). Use --force to override.${c.reset}`);
    process.exit(1);
  }

  approveTask(db, task, agent, opts.reason);
  console.log(`${c.green}✓${c.reset} ${STATUS_EMOJI.done} ${c.dim}${task.id}${c.reset} ${task.title} — ${c.green}APPROVED${c.reset} by ${c.bold}${agent}${c.reset}`);
}

/**
 * trak review reject <id>
 */
export function reviewRejectCommand(id: string, opts: ReviewRejectOptions): void {
  const db = getDb();
  const task = findTask(db, id);
  const agent = opts.agent || 'human';

  if (task.status !== 'review') {
    console.error(`${c.red}Task ${task.id} is not in review (status: ${task.status})${c.reset}`);
    process.exit(1);
  }

  rejectTask(db, task, agent, opts.reason);
  console.log(`${c.red}✗${c.reset} ${c.dim}${task.id}${c.reset} ${task.title} — ${c.red}REJECTED${c.reset} by ${c.bold}${agent}${c.reset}`);
  if (opts.reason) {
    console.log(`  ${c.dim}reason:${c.reset} ${opts.reason}`);
  }
  console.log(`  ${c.dim}Status reverted to ${c.bold}open${c.reset}`);
}

/**
 * trak review request <id> — Request changes
 */
export function reviewRequestCommand(id: string, opts: ReviewRequestOptions): void {
  const db = getDb();
  const task = findTask(db, id);
  const agent = opts.agent || 'human';

  if (task.status !== 'review') {
    console.error(`${c.red}Task ${task.id} is not in review (status: ${task.status})${c.reset}`);
    process.exit(1);
  }

  requestChangesOnTask(db, task, agent, opts.message);
  console.log(`${c.yellow}🔄${c.reset} ${c.dim}${task.id}${c.reset} ${task.title} — ${c.yellow}CHANGES REQUESTED${c.reset} by ${c.bold}${agent}${c.reset}`);
  if (opts.message) {
    console.log(`  ${c.dim}message:${c.reset} ${opts.message}`);
  }
}

/**
 * trak review batch — Batch approve low-risk items
 */
export function reviewBatchCommand(opts: ReviewBatchOptions): void {
  const db = getDb();
  const maxRisk = (opts.risk || 'low') as RiskTier;
  const agent = opts.agent || 'system-auto';
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

  const items = getReviewQueue(db, { project: opts.project });
  const eligible = items.filter(item =>
    riskTierIndex(item.riskTier) <= riskTierIndex(maxRisk) &&
    item.autoApprovable
  ).slice(0, limit);

  if (eligible.length === 0) {
    console.log(`\n${c.yellow}No auto-approvable items matching criteria${c.reset}`);
    console.log(`${c.dim}Configure rules: trak review rules add <name> --risk <tier> --condition <field:op:value>${c.reset}\n`);
    return;
  }

  console.log(`\n${c.bold}⚡ BATCH APPROVE${c.reset} — ${eligible.length} item${eligible.length === 1 ? '' : 's'}\n`);

  for (const item of eligible) {
    const { task, riskTier } = item;
    if (opts.dryRun) {
      console.log(`  ${c.dim}[dry-run]${c.reset} ${riskTierEmoji(riskTier)} ${c.dim}${task.id}${c.reset} ${truncate(task.title, 40)} ${c.dim}(${riskTier})${c.reset}`);
    } else {
      approveTask(db, task, agent, `Batch auto-approved (risk: ${riskTier})`);
      console.log(`  ${c.green}✓${c.reset} ${riskTierEmoji(riskTier)} ${c.dim}${task.id}${c.reset} ${truncate(task.title, 40)} ${c.dim}(${riskTier})${c.reset}`);
    }
  }

  if (opts.dryRun) {
    console.log(`\n  ${c.dim}Remove --dry-run to execute${c.reset}`);
  } else {
    console.log(`\n  ${c.green}✓${c.reset} ${eligible.length} item${eligible.length === 1 ? '' : 's'} approved`);
  }
  console.log();
}

/**
 * trak review rules — Manage auto-approve rules
 */
export function reviewRulesListCommand(opts: ReviewRulesOptions): void {
  const rules = getAutoApproveRules();

  if (opts.json) {
    console.log(JSON.stringify(rules, null, 2));
    return;
  }

  if (rules.length === 0) {
    console.log(`\n${c.dim}No auto-approve rules configured${c.reset}`);
    console.log(`${c.dim}Add one: trak review rules add <name> --risk <tier> --condition <field:op:value>${c.reset}\n`);
    return;
  }

  console.log(`\n${c.bold}⚙️  AUTO-APPROVE RULES${c.reset}\n`);

  for (const rule of rules) {
    const status = rule.enabled ? `${c.green}ON${c.reset}` : `${c.red}OFF${c.reset}`;
    console.log(`  ${c.bold}${rule.name}${c.reset} [${status}] — max risk: ${riskTierEmoji(rule.maxRiskTier)} ${rule.maxRiskTier}`);
    console.log(`    ${c.dim}id: ${rule.id}${c.reset}`);
    if (rule.conditions.length === 0) {
      console.log(`    ${c.dim}conditions: (none — matches all)${c.reset}`);
    } else {
      for (const cond of rule.conditions) {
        console.log(`    ${c.dim}condition: ${cond.field} ${cond.operator} ${cond.value}${c.reset}`);
      }
    }
    console.log();
  }
}

/**
 * trak review rules add — Add an auto-approve rule
 */
export function reviewRulesAddCommand(name: string, opts: { risk?: string; condition?: string[] }): void {
  const maxRiskTier = (opts.risk || 'low') as RiskTier;
  if (!RISK_TIER_ORDER.includes(maxRiskTier)) {
    console.error(`${c.red}Invalid risk tier: ${maxRiskTier}. Use: low, medium, high, critical${c.reset}`);
    process.exit(1);
  }

  const conditions: RuleCondition[] = [];
  if (opts.condition) {
    for (const condStr of opts.condition) {
      const parts = condStr.split(':');
      if (parts.length !== 3) {
        console.error(`${c.red}Invalid condition format: ${condStr}. Use field:operator:value${c.reset}`);
        process.exit(1);
      }
      conditions.push({
        field: parts[0],
        operator: parts[1],
        value: parts[2],
      });
    }
  }

  const rules = getAutoApproveRules();
  const id = `rule-${Date.now().toString(36)}`;
  const rule: AutoApproveRule = {
    id,
    name,
    enabled: true,
    conditions,
    maxRiskTier,
    createdAt: new Date().toISOString(),
  };

  rules.push(rule);
  setAutoApproveRules(rules);

  console.log(`${c.green}✓${c.reset} Rule added: ${c.bold}${name}${c.reset}`);
  console.log(`  ${c.dim}id: ${id}, max risk: ${maxRiskTier}, conditions: ${conditions.length}${c.reset}`);
}

/**
 * trak review rules rm — Remove an auto-approve rule
 */
export function reviewRulesRmCommand(ruleId: string): void {
  const rules = getAutoApproveRules();
  const idx = rules.findIndex(r => r.id === ruleId || r.name === ruleId);
  if (idx === -1) {
    console.error(`${c.red}Rule not found: ${ruleId}${c.reset}`);
    process.exit(1);
  }

  const removed = rules.splice(idx, 1)[0];
  setAutoApproveRules(rules);

  console.log(`${c.green}✓${c.reset} Rule removed: ${c.bold}${removed.name}${c.reset} (${removed.id})`);
}

/**
 * trak review rules toggle — Enable/disable a rule
 */
export function reviewRulesToggleCommand(ruleId: string): void {
  const rules = getAutoApproveRules();
  const rule = rules.find(r => r.id === ruleId || r.name === ruleId);
  if (!rule) {
    console.error(`${c.red}Rule not found: ${ruleId}${c.reset}`);
    process.exit(1);
  }

  rule.enabled = !rule.enabled;
  setAutoApproveRules(rules);

  const status = rule.enabled ? `${c.green}enabled${c.reset}` : `${c.red}disabled${c.reset}`;
  console.log(`${c.green}✓${c.reset} Rule ${c.bold}${rule.name}${c.reset} is now ${status}`);
}

/**
 * trak review sla — SLA tracking dashboard
 */
export function reviewSlaCommand(opts: ReviewSlaOptions): void {
  const db = getDb();
  const items = getReviewQueue(db, { project: opts.project });
  const slaConfig = getSlaConfig();

  if (opts.json) {
    const stats = {
      total: items.length,
      breached: items.filter(i => i.slaBreached).length,
      byRisk: {
        low: { count: 0, breached: 0, avgAge: 0, slaMinutes: slaConfig.low },
        medium: { count: 0, breached: 0, avgAge: 0, slaMinutes: slaConfig.medium },
        high: { count: 0, breached: 0, avgAge: 0, slaMinutes: slaConfig.high },
        critical: { count: 0, breached: 0, avgAge: 0, slaMinutes: slaConfig.critical },
      } as Record<string, { count: number; breached: number; avgAge: number; slaMinutes: number }>,
    };

    for (const item of items) {
      const tier = stats.byRisk[item.riskTier];
      if (tier) {
        tier.count++;
        if (item.slaBreached) tier.breached++;
        tier.avgAge = (tier.avgAge * (tier.count - 1) + item.ageMinutes) / tier.count;
      }
    }

    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(`\n${c.bold}⏱  SLA DASHBOARD${c.reset}\n`);

  if (items.length === 0) {
    console.log(`  ${c.green}✓${c.reset} No items in queue — all SLAs met\n`);
    return;
  }

  // Summary by risk tier
  const tiers: RiskTier[] = ['critical', 'high', 'medium', 'low'];
  for (const tier of tiers) {
    const tierItems = items.filter(i => i.riskTier === tier);
    if (tierItems.length === 0) continue;

    const breached = tierItems.filter(i => i.slaBreached).length;
    const avgAge = tierItems.reduce((sum, i) => sum + i.ageMinutes, 0) / tierItems.length;
    const maxAge = Math.max(...tierItems.map(i => i.ageMinutes));

    const slaMinutes = slaConfig[tier];
    const header = `${riskTierEmoji(tier)} ${riskTierColor(tier)}${tier.toUpperCase()}${c.reset}`;
    const slaTarget = `SLA: ${formatDuration(slaMinutes)}`;
    const breachedStr = breached > 0
      ? `${c.red}${breached} breached${c.reset}`
      : `${c.green}0 breached${c.reset}`;

    console.log(`  ${header} — ${tierItems.length} item${tierItems.length === 1 ? '' : 's'}, ${breachedStr} (${slaTarget})`);
    console.log(`    ${c.dim}avg age: ${formatDuration(avgAge)}, max: ${formatDuration(maxAge)}${c.reset}`);

    // Show breached items
    if (breached > 0) {
      for (const item of tierItems.filter(i => i.slaBreached)) {
        const overBy = item.ageMinutes - slaMinutes;
        console.log(`    ${c.red}⚠${c.reset} ${c.dim}${item.task.id}${c.reset} ${truncate(item.task.title, 35)} — ${c.red}over by ${formatDuration(overBy)}${c.reset}`);
      }
    }
    console.log();
  }

  // Overall stats
  const totalBreached = items.filter(i => i.slaBreached).length;
  const complianceRate = ((items.length - totalBreached) / items.length * 100).toFixed(1);
  console.log(`  ${c.bold}Overall:${c.reset} ${items.length} in queue, ${c.green}${complianceRate}% SLA compliance${c.reset}`);

  // Historical stats (from done tasks that were in review)
  const recentlyApproved = db.prepare(`
    SELECT t.*, tl.timestamp as approved_at FROM tasks t
    JOIN task_log tl ON tl.task_id = t.id
    WHERE t.status = 'done'
    AND tl.entry LIKE '%APPROVED%'
    AND tl.timestamp > datetime('now', '-7 days')
    ORDER BY tl.timestamp DESC
    LIMIT 20
  `).all() as any[];

  if (recentlyApproved.length > 0) {
    const avgReviewTime = recentlyApproved.reduce((sum: number, t: any) => {
      const reviewMs = new Date(t.approved_at).getTime() - new Date(t.updated_at).getTime();
      return sum + Math.max(0, reviewMs / 60000);
    }, 0) / recentlyApproved.length;

    console.log(`  ${c.bold}Last 7d:${c.reset} ${recentlyApproved.length} approved, avg review time: ${formatDuration(avgReviewTime)}`);
  }

  console.log(`\n  ${c.dim}Configure SLAs: trak config set review.sla '{"low":1440,"medium":480,"high":120,"critical":30}'${c.reset}\n`);
}

/**
 * trak review auto-run — Process auto-approvable items (called by hooks/cron)
 */
export function reviewAutoRunCommand(): void {
  const db = getDb();
  const items = getReviewQueue(db);
  const eligible = items.filter(i => i.autoApprovable);

  if (eligible.length === 0) {
    console.log(`${c.dim}No auto-approvable items${c.reset}`);
    return;
  }

  console.log(`${c.bold}⚡ Auto-approving ${eligible.length} item${eligible.length === 1 ? '' : 's'}${c.reset}\n`);

  for (const item of eligible) {
    approveTask(db, item.task, 'auto-approve', `Auto-approved by rules engine (risk: ${item.riskTier})`);
    console.log(`  ${c.green}✓${c.reset} ${riskTierEmoji(item.riskTier)} ${c.dim}${item.task.id}${c.reset} ${truncate(item.task.title, 40)}`);
  }

  console.log(`\n${c.green}✓${c.reset} ${eligible.length} item${eligible.length === 1 ? '' : 's'} auto-approved`);
}

/**
 * Fire webhook for items entering review queue (for push notifications).
 */
export function fireReviewQueueEvent(task: Task, action: 'queued' | 'approved' | 'rejected' | 'changes_requested'): void {
  // This piggybacks on the existing hook system
  // Notification integrations can listen for status_changed events to 'review'
  hookTaskStatusChanged(task, task.status, action === 'queued' ? 'review' : task.status);
}
