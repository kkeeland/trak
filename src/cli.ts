#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { searchCommand, SearchOptions } from './commands/search.js';
import { createCommand, CreateOptions } from './commands/create.js';
import { listCommand, ListOptions } from './commands/list.js';
import { readyCommand, ReadyOptions } from './commands/ready.js';
import { boardCommand } from './commands/board.js';
import { showCommand } from './commands/show.js';
import { statusCommand } from './commands/status.js';
import { logCommand, LogOptions } from './commands/log.js';
import { depAddCommand, depRmCommand } from './commands/dep.js';
import { closeCommand, CloseOptions } from './commands/close.js';
import { digestCommand } from './commands/digest.js';
import { staleCommand } from './commands/stale.js';
import { costCommand, CostOptions, costTrendCommand, CostTrendOptions, costModelsCommand, CostModelsOptions, costBudgetCommand, CostBudgetOptions, costTopCommand, CostTopOptions, costExportCommand, CostExportOptions, costPricesCommand } from './commands/cost.js';
import { heatCommand } from './commands/heat.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';
import { importBeadsCommand } from './commands/import-beads.js';
import { setupCommand } from './commands/setup.js';
import { configGetCommand, configSetCommand, configListCommand } from './commands/config.js';
import { syncCommand, SyncOptions } from './commands/sync.js';
import { pullCommand } from './commands/pull.js';
import { traceCommand, TraceOptions } from './commands/trace.js';
import { historyCommand } from './commands/history.js';
import { contextCommand } from './commands/context.js';
import { onboardCommand } from './commands/onboard.js';
import { epicCreateCommand, epicListCommand, epicShowCommand, EpicListOptions } from './commands/epic.js';
import { assignCommand } from './commands/assign.js';
import { verifyCommand, VerifyOptions } from './commands/verify.js';
import { claimCommand, ClaimOptions } from './commands/claim.js';
import { claimsCommand, ClaimsOptions } from './commands/claims.js';
import { pipelineCommand } from './commands/pipeline.js';
import { statsCommand, StatsOptions } from './commands/stats.js';
import { nextCommand, NextOptions } from './commands/next.js';
import { doCommand, DoOptions } from './commands/do.js';
import { convoyCreateCommand, convoyAddCommand, convoyShowCommand, convoyReadyCommand, convoyListCommand } from './commands/convoy.js';
import { mailSendCommand, mailCheckCommand, mailReadCommand, mailListCommand, MailSendOptions, MailCheckOptions, MailListOptions } from './commands/mail.js';
import { slingCommand, SlingOptions } from './commands/sling.js';
import { runCommand, RunOptions } from './commands/run.js';
import { planCommand, PlanOptions } from './commands/plan.js';
import { polecatCommand, PolecatOptions } from './commands/polecat.js';
import { helpCommand } from './commands/help-request.js';
import { mergeCommand } from './commands/merge.js';
import { retryCommand, failCommand, RetryOptions } from './commands/retry.js';
import {
  locksCommand, unlockCommand,
  lockAcquireCommand, lockReleaseCommand, lockBreakCommand,
  lockCheckCommand, lockRenewCommand, lockAuditCommand, lockQueueCommand,
} from './commands/locks.js';

const program = new Command();

program
  .name('trak')
  .description('AI-native task tracker — tasks are conversations, not tickets')
  .version('0.2.0');

program
  .command('init')
  .description('Initialize trak database in .trak/')
  .option('-g, --global', 'Create global database at ~/.trak/trak.db')
  .action((opts: { global?: boolean }) => initCommand(opts));

program
  .command('create')
  .description('Create a new task')
  .argument('<title>', 'Task title')
  .option('-b, --project <project>', 'Project grouping')
  .option('-p, --priority <n>', 'Priority 0-3', '1')
  .option('-d, --description <text>', 'Task description')
  .option('--parent <id>', 'Parent task ID (for subtasks)')
  .option('--epic <id>', 'Parent epic ID')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-s, --session <label>', 'Agent session label')
  .option('--auto', 'Set autonomy to auto (agent can execute without approval)')
  .option('--review', 'Set autonomy to review (agent executes, human reviews)')
  .option('--approve', 'Set autonomy to approve (human must approve before execution)')
  .option('--budget <amount>', 'Budget ceiling in USD')
  .option('--timeout <duration>', 'Agent timeout for this task (e.g. 30m, 1h, 900)')
  .option('--no-retry', 'Disable automatic retries for this task (max_retries=0)')
  .option('--max-retries <n>', 'Maximum retry attempts (default: config or 3)')
  .action((title: string, opts: CreateOptions) => createCommand(title, opts));

program
  .command('list')
  .alias('ls')
  .description('List tasks with filters')
  .option('-b, --project <project>', 'Filter by project')
  .option('--status <status>', 'Filter by status')
  .option('-t, --tags <tags>', 'Filter by tag')
  .option('--epic <id>', 'Filter by epic')
  .option('-v, --verbose', 'Show details')
  .option('-a, --all', 'Include done/archived')
  .option('--failed', 'Show only failed tasks')
  .action((opts: ListOptions) => listCommand(opts));

program
  .command('ready')
  .description('Show unblocked tasks ready for work (default: P0-P1 only)')
  .option('-b, --project <project>', 'Filter by project')
  .option('-p, --priority <level>', 'Minimum priority level (0-3, default: 1 = P0+P1)')
  .option('-a, --all', 'Show all priorities')
  .action((opts: ReadyOptions) => readyCommand(opts));

program
  .command('next')
  .description('Get the next auto task ready for an agent')
  .option('-b, --project <project>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .action((opts: NextOptions) => nextCommand(opts));

program
  .command('board')
  .description('Board view grouped by project with status colors')
  .argument('[project]', 'Filter to a single project')
  .action((project?: string) => boardCommand(project));

program
  .command('show')
  .description('Show full task detail + journal')
  .argument('<id>', 'Task ID (or partial)')
  .action((id: string) => showCommand(id));

program
  .command('status')
  .description('Change task status')
  .argument('<id>', 'Task ID')
  .argument('<status>', 'New status: open|wip|blocked|review|done|archived')
  .action((id: string, status: string) => statusCommand(id, status));

program
  .command('log')
  .description('Append entry to task journal')
  .argument('<id>', 'Task ID')
  .argument('<entry>', 'Journal entry text')
  .option('-a, --author <name>', 'Author label', 'human')
  .option('--cost <amount>', 'Log cost in USD (additive)')
  .option('--tokens <count>', 'Log token usage (additive)')
  .option('--tokens-in <count>', 'Log input tokens (additive)')
  .option('--tokens-out <count>', 'Log output tokens (additive)')
  .option('--model <name>', 'Model used')
  .option('--duration <seconds>', 'Duration in seconds (additive)')
  .action((id: string, entry: string, opts: LogOptions) => logCommand(id, entry, opts));

const dep = program
  .command('dep')
  .description('Manage task dependencies');

dep
  .command('add')
  .description('Add dependency (child depends on parent)')
  .argument('<child>', 'Child task ID')
  .argument('<parent>', 'Parent task ID (prerequisite)')
  .action((child: string, parent: string) => depAddCommand(child, parent));

dep
  .command('rm')
  .description('Remove dependency')
  .argument('<child>', 'Child task ID')
  .argument('<parent>', 'Parent task ID')
  .action((child: string, parent: string) => depRmCommand(child, parent));

program
  .command('close')
  .description('Mark task as done (requires --verify or prior verification)')
  .argument('<id>', 'Task ID')
  .option('--cost <amount>', 'Log cost in USD (additive)')
  .option('--tokens <count>', 'Log token usage (additive)')
  .option('--tokens-in <count>', 'Log input tokens (additive)')
  .option('--tokens-out <count>', 'Log output tokens (additive)')
  .option('--model <name>', 'Model used for this task')
  .option('--duration <seconds>', 'Duration in seconds (additive)')
  .option('--verify', 'Run verification checks before closing (build, tests, verify_command)')
  .option('--force', 'Bypass verification gate (human override)')
  .option('--proof <artifact>', 'Proof of completion (URL, file path, or description)')
  .option('--commit <hash>', 'Git commit hash as proof of work')
  .action((id: string, opts: CloseOptions) => closeCommand(id, opts));

program
  .command('digest')
  .description('What changed in the last 24 hours')
  .action(() => digestCommand());

program
  .command('stale')
  .description('Show tasks with no activity > N days')
  .argument('[days]', 'Staleness threshold', '7')
  .action((days?: string) => staleCommand(days));

const costCmd = program
  .command('cost')
  .description('Cost tracking — overview, trends, budgets, model breakdown')
  .argument('[id]', 'Task ID to show cost for (optional)')
  .option('-b, --project <project>', 'Filter by project')
  .option('-l, --label <label>', 'Filter by label/tag')
  .option('-w, --week', 'Last 7 days only')
  .option('-m, --month', 'Last 30 days only')
  .option('--agent <name>', 'Filter by agent')
  .action((id: string | undefined, opts: CostOptions) => {
    if (id) {
      costCommand(id, opts);
    } else {
      costCommand(opts);
    }
  });

costCmd
  .command('trend')
  .description('Show daily cost trend with sparkline chart')
  .option('-b, --project <project>', 'Filter by project')
  .option('-d, --days <n>', 'Number of days (default: 30)', '30')
  .action((opts: CostTrendOptions) => costTrendCommand(opts));

costCmd
  .command('models')
  .description('Cost breakdown by AI model')
  .option('-b, --project <project>', 'Filter by project')
  .action((opts: CostModelsOptions) => costModelsCommand(opts));

costCmd
  .command('budget')
  .description('View/set task budgets and alerts')
  .argument('[id]', 'Task ID (optional — omit for overview)')
  .option('--set <amount>', 'Set budget amount in USD')
  .option('-b, --project <project>', 'Filter by project')
  .action((id: string | undefined, opts: CostBudgetOptions) => costBudgetCommand(id, opts));

costCmd
  .command('top')
  .description('Show most expensive tasks')
  .option('-b, --project <project>', 'Filter by project')
  .option('-n, --limit <n>', 'Number of tasks (default: 10)', '10')
  .action((opts: CostTopOptions) => costTopCommand(opts));

costCmd
  .command('export')
  .description('Export cost data as JSON or CSV')
  .option('-b, --project <project>', 'Filter by project')
  .option('--since <date>', 'Start date (ISO format)')
  .option('--csv', 'Export as CSV instead of JSON')
  .action((opts: CostExportOptions) => costExportCommand(opts));

costCmd
  .command('prices')
  .description('Show known model pricing reference')
  .action(() => costPricesCommand());

program
  .command('heat')
  .description('Show tasks by heat score (auto-priority)')
  .action(() => heatCommand());

program
  .command('export')
  .description('Dump all data to JSON (stdout)')
  .action(() => exportCommand());

program
  .command('import')
  .description('Import tasks from JSON/JSONL file')
  .argument('[file]', 'JSON/JSONL file path (defaults to .trak/trak.jsonl)')
  .action((file?: string) => importCommand(file));

program
  .command('import-beads', { hidden: true })
  .description('Import tasks from beads JSONL workspace (deprecated — use scripts/migrate-from-beads.ts)')
  .argument('<path>', 'Path to beads workspace (.beads/ dir) or issues.jsonl file')
  .action((path: string) => importBeadsCommand(path));

program
  .command('setup')
  .description('Configure trak integration for AI coding tools')
  .argument('[tool]', 'Tool to configure: claude, cursor, clawdbot, codex, aider, generic')
  .option('-l, --list', 'Show all supported tools')
  .action((tool?: string, opts?: { list?: boolean }) => setupCommand(tool, opts));

// Epic commands
const epic = program
  .command('epic')
  .description('Manage epics (large task groups)');

epic
  .command('create')
  .description('Create a new epic')
  .argument('<title>', 'Epic title')
  .option('-b, --project <project>', 'Project grouping')
  .option('-p, --priority <n>', 'Priority 0-3', '1')
  .option('-d, --description <text>', 'Epic description')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-s, --session <label>', 'Agent session label')
  .action((title: string, opts: CreateOptions) => epicCreateCommand(title, opts));

epic
  .command('list')
  .alias('ls')
  .description('List all epics')
  .option('-b, --project <project>', 'Filter by project')
  .action((opts: EpicListOptions) => epicListCommand(opts));

epic
  .command('show')
  .description('Show epic detail with progress')
  .argument('<id>', 'Epic ID')
  .action((id: string) => epicShowCommand(id));

// Multi-agent coordination commands
program
  .command('assign')
  .description('Assign a task to an agent')
  .argument('<id>', 'Task ID')
  .argument('<agent>', 'Agent name')
  .action((id: string, agent: string) => assignCommand(id, agent));

program
  .command('verify')
  .description('Verify a task — run commands, diff, checklist, or manual pass/fail')
  .argument('<id>', 'Task ID')
  .option('--run <command>', 'Execute a shell command as verification')
  .option('--diff', 'Show git diff since WIP started')
  .option('--checklist <items>', 'Comma-separated verification criteria to check off')
  .option('--auto', 'Run all configured verifications automatically')
  .option('--pass', 'Manually mark verification as passed')
  .option('--fail', 'Manually mark verification as failed')
  .option('--agent <name>', 'Verifying agent name', 'human')
  .option('--reason <text>', 'Verification reasoning')
  .action((id: string, opts: VerifyOptions) => verifyCommand(id, opts));

program
  .command('claim')
  .description('Claim a task for an agent')
  .argument('<id>', 'Task ID')
  .option('--agent <name>', 'Agent name')
  .option('--model <model>', 'Model name')
  .option('--release', 'Release current claim')
  .action((id: string, opts: ClaimOptions) => claimCommand(id, opts));

program
  .command('claims')
  .description('Show all active claims')
  .option('--agent <name>', 'Filter by agent')
  .action((opts: ClaimsOptions) => claimsCommand(opts));

program
  .command('pipeline')
  .description('Show verification pipeline for an epic')
  .argument('<epic-id>', 'Epic task ID')
  .action((epicId: string) => pipelineCommand(epicId));

program
  .command('stats')
  .description('Agent performance stats')
  .option('--agent <name>', 'Filter by agent')
  .option('--project <project>', 'Filter by project')
  .action((opts: StatsOptions) => statsCommand(opts));

program
  .command('trace')
  .description('Trace task ancestry and downstream through dependency graph')
  .argument('<id>', 'Task ID (or partial)')
  .option('--forward', 'Show only downstream (what this unblocks)')
  .option('--backward', 'Show only upstream (what this depends on)')
  .option('--depth <n>', 'Max depth for graph traversal', '10')
  .action((id: string, opts: TraceOptions) => traceCommand(id, opts));

program
  .command('history')
  .description('Show complete timeline of a task — journal, status changes, cost')
  .argument('<id>', 'Task ID (or partial)')
  .action((id: string) => historyCommand(id));

program
  .command('context')
  .description('Generate onboarding context document for a project')
  .argument('<project>', 'Project name')
  .action((project: string) => contextCommand(project));

program
  .command('onboard')
  .description('Interactive project walkthrough for new agents')
  .argument('<project>', 'Project name')
  .action((project: string) => onboardCommand(project));

program
  .command('search')
  .description('Full-text search across tasks and journal entries')
  .argument('<query>', 'Search query')
  .option('-b, --project <project>', 'Scope to project')
  .option('-a, --all', 'Include done/archived')
  .action((query: string, opts: SearchOptions) => searchCommand(query, opts));

// Config commands
const config = program
  .command('config')
  .description('Manage trak configuration');

config
  .command('get')
  .description('Get a config value')
  .argument('<key>', 'Config key')
  .action((key: string) => configGetCommand(key));

config
  .command('set')
  .description('Set a config value')
  .argument('<key>', 'Config key')
  .argument('<value>', 'Config value')
  .action((key: string, value: string) => configSetCommand(key, value));

config
  .command('list')
  .description('List all config')
  .action(() => configListCommand());

// Sync command
program
  .command('sync')
  .description('Export JSONL and commit to git')
  .option('--push', 'Also push to remote')
  .option('--compact', 'Force full snapshot export instead of event log')
  .action((opts: SyncOptions) => syncCommand(opts));

// Pull command
program
  .command('pull')
  .description('Git pull and rebuild database from JSONL')
  .action(() => pullCommand());

// trak do — decompose and run
program
  .command('do')
  .description('Decompose natural language into subtasks and run')
  .argument('<input>', 'Natural language description of what to do')
  .option('-b, --project <project>', 'Project grouping')
  .option('--ai', 'Use AI to decompose (requires GEMINI_API_KEY)')
  .option('--chain', 'Force sequential dependencies (backward compat)')
  .action((input: string, opts: DoOptions) => { doCommand(input, opts); });

// Sling command — dispatch to agent
program
  .command('sling [task-id]')
  .description('Dispatch a task to an agent for autonomous execution')
  .option('--json', 'Output dispatch payload as JSON')
  .option('-b, --project <project>', 'Filter by project when auto-picking')
  .option('--goal <goal>', 'Create a single task from a goal and dispatch it')
  .option('--dispatch', 'Spawn a Clawdbot sub-agent via native gateway dispatch')
  .option('--execute', 'Alias for --dispatch')
  .option('--model <model>', 'Model for dispatched agent')
  .option('--timeout <seconds>', 'Timeout for dispatched agent')
  .option('--dry-run', 'Preview dispatch without executing')
  .action((taskId: string | undefined, opts: SlingOptions) => slingCommand(taskId, opts));

program
  .command('run')
  .description('Orchestrate: claim ready auto tasks and dispatch agents')
  .option('-b, --project <project>', 'Filter by project')
  .option('--dry-run', 'Preview what would be dispatched')
  .option('--max-agents <n>', 'Max concurrent agents (default: 3)')
  .option('--model <model>', 'Model for spawned agents')
  .option('--timeout <duration>', 'Agent timeout (e.g. 30m, 1h, 900). Overrides task/config defaults')
  .option('-w, --watch', 'Watch mode: poll for newly ready tasks and auto-dispatch')
  .option('--min-priority <level>', 'Minimum priority to dispatch (0-3, default: 1 = P0+P1)')
  .action((opts: RunOptions) => runCommand(opts));

program
  .command('plan')
  .description('Show execution plan — ready vs blocked auto tasks (dry-run for trak run)')
  .option('-b, --project <project>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .action((opts: PlanOptions) => planCommand(opts));

// Polecat — ephemeral worker agent
program
  .command('polecat')
  .description('Run as an ephemeral worker agent for a task (sling dispatches, polecat IS the worker)')
  .argument('<task-id>', 'Task ID to work on')
  .option('--timeout <duration>', 'Kill self after duration (e.g. 30m, 1h, 900). Default: task/config/15m')
  .option('--model <model>', 'Model for the agent runtime')
  .option('--dry-run', 'Show work instruction without executing')
  .action((taskId: string, opts: PolecatOptions) => polecatCommand(taskId, opts));

// Convoy commands
const convoy = program
  .command('convoy')
  .description('Manage convoys (task batches for agent coordination)');

convoy
  .command('create')
  .description('Create a new convoy')
  .argument('<name>', 'Convoy name')
  .action((name: string) => { convoyCreateCommand(name); });

convoy
  .command('add')
  .description('Add tasks to a convoy')
  .argument('<convoy-id>', 'Convoy ID')
  .argument('<task-ids...>', 'Task IDs to add')
  .action((convoyId: string, taskIds: string[]) => convoyAddCommand(convoyId, taskIds));

convoy
  .command('show')
  .description('Show tasks in a convoy')
  .argument('<convoy-id>', 'Convoy ID')
  .action((convoyId: string) => convoyShowCommand(convoyId));

convoy
  .command('ready')
  .description('Show ready tasks in a convoy')
  .argument('<convoy-id>', 'Convoy ID')
  .action((convoyId: string) => convoyReadyCommand(convoyId));

convoy
  .command('list')
  .alias('ls')
  .description('List all convoys')
  .action(() => convoyListCommand());

// Mail commands
const mail = program
  .command('mail')
  .description('Agent-to-agent mailbox system');

mail
  .command('send')
  .description('Send a message to an agent')
  .argument('<to-agent>', 'Recipient agent name (or "all" for broadcast)')
  .argument('<message>', 'Message text')
  .option('-t, --task <id>', 'Link to a task')
  .action((toAgent: string, message: string, opts: MailSendOptions) => mailSendCommand(toAgent, message, opts));

mail
  .command('check')
  .description('Check inbox for unread messages')
  .option('-a, --agent <name>', 'Agent name')
  .action((opts: MailCheckOptions) => mailCheckCommand(opts));

mail
  .command('read')
  .description('Mark a message as read')
  .argument('<mail-id>', 'Message ID')
  .action((mailId: string) => mailReadCommand(mailId));

mail
  .command('list')
  .alias('ls')
  .description('List messages')
  .option('--agent <name>', 'Filter by agent')
  .option('--all', 'Show all messages')
  .action((opts: MailListOptions) => mailListCommand(opts));

// Help request command
program
  .command('help')
  .description('Log a help request on a task (for agents to signal they need assistance)')
  .argument('<task-id>', 'Task ID')
  .argument('<message>', 'Help request message')
  .action((taskId: string, message: string) => helpCommand(taskId, message));

// Retry / fail commands
program
  .command('retry')
  .description('Manually retry a failed task, or list retryable tasks with --list')
  .argument('[id]', 'Task ID (optional if using --list)')
  .option('--no-reset', 'Keep current retry count instead of resetting to 0')
  .option('-l, --list', 'List all failed/retryable tasks')
  .option('-a, --all', 'With --list: include tasks with retry history that are no longer failed')
  .action((id: string | undefined, opts: RetryOptions) => retryCommand(id, opts));

program
  .command('fail')
  .description('Mark a task as failed (triggers auto-retry with backoff if retries remain)')
  .argument('<id>', 'Task ID')
  .option('-r, --reason <text>', 'Failure reason')
  .action((id: string, opts: { reason?: string }) => failCommand(id, opts));

// Merge conflicted JSONL
program
  .command('merge')
  .description('Resolve git merge conflicts in .trak/trak.jsonl (last-write-wins per task)')
  .action(() => mergeCommand());

// Workspace lock commands
program
  .command('locks')
  .description('Show active workspace locks and queues')
  .action(() => locksCommand());

program
  .command('unlock')
  .description('Release a workspace lock (alias for lock release)')
  .argument('<repo>', 'Repo path, basename, or task ID')
  .action((repo: string) => unlockCommand(repo));

const lock = program
  .command('lock')
  .description('Workspace locking for multi-agent conflict prevention');

lock
  .command('acquire')
  .description('Acquire a lock on a repo or specific files')
  .argument('<repo>', 'Repository path')
  .argument('<task-id>', 'Task ID requesting the lock')
  .option('--agent <name>', 'Agent name', 'agent')
  .option('--files <patterns>', 'Comma-separated file patterns to lock (omit for whole repo)')
  .option('--queue', 'Queue if blocked instead of failing')
  .option('-p, --priority <n>', 'Queue priority (0=highest)', '1')
  .action((repo: string, taskId: string, opts: any) => lockAcquireCommand(repo, taskId, opts));

lock
  .command('release')
  .description('Release a workspace lock')
  .argument('<repo>', 'Repo path, basename, or task ID')
  .action((repo: string) => lockReleaseCommand(repo));

lock
  .command('break')
  .description('Emergency force-release a lock (with audit trail)')
  .argument('<repo>', 'Repo path, basename, or task ID')
  .option('--agent <name>', 'Who is breaking the lock', 'human')
  .option('--reason <text>', 'Reason for breaking')
  .action((repo: string, opts: any) => lockBreakCommand(repo, opts));

lock
  .command('check')
  .description('Check if a task would conflict with existing locks')
  .argument('<repo>', 'Repository path')
  .argument('<task-id>', 'Task ID to check')
  .option('--files <patterns>', 'Comma-separated file patterns')
  .action((repo: string, taskId: string, opts: any) => lockCheckCommand(repo, taskId, opts));

lock
  .command('renew')
  .description('Extend a lock\'s expiration (heartbeat)')
  .argument('<repo>', 'Repository path')
  .argument('<task-id>', 'Task ID that holds the lock')
  .action((repo: string, taskId: string) => lockRenewCommand(repo, taskId));

lock
  .command('audit')
  .description('Show lock audit trail')
  .option('-n, --limit <n>', 'Number of events to show', '25')
  .action((opts: any) => lockAuditCommand(opts));

lock
  .command('queue')
  .description('Show all lock queues')
  .action(() => lockQueueCommand());

program.parse();
