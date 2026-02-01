#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { createCommand, CreateOptions } from './commands/create.js';
import { listCommand, ListOptions } from './commands/list.js';
import { readyCommand, ReadyOptions } from './commands/ready.js';
import { boardCommand } from './commands/board.js';
import { showCommand } from './commands/show.js';
import { statusCommand } from './commands/status.js';
import { logCommand, LogOptions } from './commands/log.js';
import { depAddCommand, depRmCommand } from './commands/dep.js';
import { closeCommand } from './commands/close.js';
import { digestCommand } from './commands/digest.js';
import { staleCommand } from './commands/stale.js';
import { costCommand, CostOptions } from './commands/cost.js';
import { heatCommand } from './commands/heat.js';
import { exportCommand } from './commands/export.js';
import { importCommand } from './commands/import.js';

const program = new Command();

program
  .name('trak')
  .description('AI-native task tracker — tasks are conversations, not tickets')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize trak database in .trak/')
  .action(() => initCommand());

program
  .command('create')
  .description('Create a new task')
  .argument('<title>', 'Task title')
  .option('-b, --brand <brand>', 'Brand/project grouping')
  .option('-p, --priority <n>', 'Priority 0-3', '1')
  .option('-d, --description <text>', 'Task description')
  .option('--parent <id>', 'Parent task ID (for subtasks)')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-s, --session <label>', 'Agent session label')
  .action((title: string, opts: CreateOptions) => createCommand(title, opts));

program
  .command('list')
  .alias('ls')
  .description('List tasks with filters')
  .option('-b, --brand <brand>', 'Filter by brand')
  .option('--status <status>', 'Filter by status')
  .option('-t, --tags <tags>', 'Filter by tag')
  .option('-v, --verbose', 'Show details')
  .option('-a, --all', 'Include done/archived')
  .action((opts: ListOptions) => listCommand(opts));

program
  .command('ready')
  .description('Show unblocked tasks ready for work')
  .option('-b, --brand <brand>', 'Filter by brand')
  .action((opts: ReadyOptions) => readyCommand(opts));

program
  .command('board')
  .description('Board view grouped by brand with status colors')
  .argument('[brand]', 'Filter to a single brand')
  .action((brand?: string) => boardCommand(brand));

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
  .description('Mark task as done')
  .argument('<id>', 'Task ID')
  .action((id: string) => closeCommand(id));

program
  .command('digest')
  .description('What changed in the last 24 hours')
  .action(() => digestCommand());

program
  .command('stale')
  .description('Show tasks with no activity > N days')
  .argument('[days]', 'Staleness threshold', '7')
  .action((days?: string) => staleCommand(days));

program
  .command('cost')
  .description('Cost tracking by brand')
  .option('-b, --brand <brand>', 'Filter by brand')
  .option('-w, --week', 'Last 7 days only')
  .action((opts: CostOptions) => costCommand(opts));

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
  .description('Import tasks from JSON file')
  .argument('<file>', 'JSON file path')
  .action((file: string) => importCommand(file));

program.parse();
