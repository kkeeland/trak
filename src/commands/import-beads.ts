import fs from 'fs';
import path from 'path';
import { getDb } from '../db.js';
import { c } from '../utils.js';

// Label-to-project mapping
const LABEL_PROJECT_MAP: [string[], string][] = [
  [['adapt', 'adaptaphoria'], 'adapt'],
  [['forge', 'platform', 'inner-council'], 'forge'],
  [['peptok'], 'peptok'],
  [['spore', 'hellospore'], 'spore'],
  [['bagtek'], 'bagtek'],
  [['pronoia'], 'pronoia'],
  [['trak'], 'trak'],
];

function mapLabels(labels: string[]): { project: string; tags: string[] } {
  let project = '';
  const remainingTags: string[] = [];

  for (const label of labels) {
    const labelLower = label.toLowerCase();
    let matched = false;

    for (const [keywords, projectName] of LABEL_PROJECT_MAP) {
      if (keywords.some(kw => labelLower === kw || labelLower.includes(kw))) {
        if (!project) {
          project = projectName;
        }
        matched = true;
        break;
      }
    }

    if (!matched) {
      remainingTags.push(label);
    }
  }

  return { project, tags: remainingTags };
}

function mapStatus(beadsStatus: string): string {
  const s = beadsStatus.toLowerCase();
  if (s === 'closed' || s === 'done' || s === '✓') return 'done';
  if (s === 'open' || s === '○') return 'open';
  if (s === 'wip' || s === 'in_progress' || s === 'in-progress') return 'wip';
  if (s === 'blocked') return 'blocked';
  if (s === 'review') return 'review';
  if (s === 'archived') return 'archived';
  return 'open';
}

function mapPriority(p: number | string | undefined): number {
  if (p === undefined || p === null) return 1;
  if (typeof p === 'string') {
    // Handle P0-P3 format
    const match = p.match(/P(\d)/i);
    if (match) return Math.min(parseInt(match[1], 10), 3);
    return parseInt(p, 10) || 1;
  }
  return Math.min(Math.max(p, 0), 3);
}

interface BeadsDep {
  issue_id: string;
  depends_on_id: string;
  type: string;
  created_at?: string;
  created_by?: string;
}

interface BeadsIssue {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority?: number | string;
  issue_type?: string;
  owner?: string;
  created_at: string;
  created_by?: string;
  updated_at: string;
  closed_at?: string;
  close_reason?: string;
  labels?: string[];
  dependencies?: BeadsDep[];
}

export function importBeadsCommand(inputPath: string): void {
  // Resolve the JSONL file
  let jsonlFile: string;
  const resolved = path.resolve(inputPath);

  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    // It's a directory — look for issues.jsonl inside
    jsonlFile = path.join(resolved, 'issues.jsonl');
    if (!fs.existsSync(jsonlFile)) {
      console.error(`${c.red}No issues.jsonl found in ${resolved}${c.reset}`);
      process.exit(1);
    }
  } else if (fs.existsSync(resolved) && resolved.endsWith('.jsonl')) {
    jsonlFile = resolved;
  } else {
    console.error(`${c.red}Path not found or not a .jsonl file: ${inputPath}${c.reset}`);
    process.exit(1);
  }

  console.log(`${c.dim}Reading ${jsonlFile}...${c.reset}`);

  const raw = fs.readFileSync(jsonlFile, 'utf-8');
  const lines = raw.trim().split('\n').filter(l => l.trim());

  const db = getDb();

  const insertTask = db.prepare(`
    INSERT OR REPLACE INTO tasks (id, title, description, status, priority, project, blocked_by, parent_id, created_at, updated_at, agent_session, tokens_used, cost_usd, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDep = db.prepare(`
    INSERT OR IGNORE INTO dependencies (child_id, parent_id) VALUES (?, ?)
  `);

  const insertLog = db.prepare(`
    INSERT INTO task_log (task_id, timestamp, entry, author) VALUES (?, ?, ?, ?)
  `);

  // Check if task exists (for log dedup)
  const taskExists = db.prepare('SELECT id FROM tasks WHERE id = ?');

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let depsImported = 0;
  const allDeps: { child: string; parent: string }[] = [];

  const transaction = db.transaction(() => {
    for (const line of lines) {
      let issue: BeadsIssue;
      try {
        issue = JSON.parse(line);
      } catch {
        errors++;
        continue;
      }

      if (!issue.id || !issue.title) {
        skipped++;
        continue;
      }

      const labels = issue.labels || [];
      const { project, tags } = mapLabels(labels);
      const status = mapStatus(issue.status);
      const priority = mapPriority(issue.priority);

      // Check if already exists
      const existing = taskExists.get(issue.id);

      insertTask.run(
        issue.id,
        issue.title,
        issue.description || '',
        status,
        priority,
        project,
        '',  // blocked_by (we use dep table instead)
        null, // parent_id
        issue.created_at,
        issue.updated_at || issue.created_at,
        '', // agent_session
        0,  // tokens_used
        0,  // cost_usd
        tags.join(',')
      );

      // Add import log entry only for new tasks
      if (!existing) {
        insertLog.run(
          issue.id,
          issue.created_at,
          `Imported from beads: ${issue.id}`,
          'import-beads'
        );
      }

      imported++;

      // Collect dependencies for second pass
      if (issue.dependencies) {
        for (const dep of issue.dependencies) {
          if (dep.type === 'blocks') {
            // In beads: issue_id blocks depends_on_id
            // meaning depends_on_id depends on issue_id
            // In trak deps: child depends on parent
            allDeps.push({ child: dep.depends_on_id, parent: dep.issue_id });
          } else if (dep.type === 'blocked-by' || dep.type === 'blocked_by') {
            allDeps.push({ child: dep.issue_id, parent: dep.depends_on_id });
          }
        }
      }
    }

    // Second pass: insert dependencies (only if both tasks exist)
    for (const dep of allDeps) {
      const childExists = taskExists.get(dep.child);
      const parentExists = taskExists.get(dep.parent);
      if (childExists && parentExists) {
        insertDep.run(dep.child, dep.parent);
        depsImported++;
      }
    }
  });

  transaction();

  console.log(`\n${c.green}${c.bold}✓ Import complete${c.reset}`);
  console.log(`  ${c.green}${imported}${c.reset} imported`);
  if (skipped) console.log(`  ${c.yellow}${skipped}${c.reset} skipped`);
  if (errors) console.log(`  ${c.red}${errors}${c.reset} errors`);
  if (depsImported) console.log(`  ${c.cyan}${depsImported}${c.reset} dependencies`);
}
