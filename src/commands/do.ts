import { getDb, Task, afterWrite } from '../db.js';
import { generateId, c, STATUS_EMOJI } from '../utils.js';
import { ensureConvoyTable, convoyCreateCommand } from './convoy.js';

export interface DoOptions {
  project?: string;
  ai?: boolean;
  chain?: boolean;
}

interface TemplateMatch {
  pattern: RegExp;
  tasks: string[];
}

const TEMPLATES: TemplateMatch[] = [
  {
    pattern: /landing\s*page/i,
    tasks: ['Design layout and wireframes', 'Write copy and content', 'Build the page', 'Test and review', 'Deploy to production'],
  },
  {
    pattern: /fix\s*bug|bugfix|debug/i,
    tasks: ['Reproduce the bug', 'Identify root cause', 'Implement fix', 'Test the fix'],
  },
  {
    pattern: /write\s*(an?\s+)?article|blog\s*post|write\s*up/i,
    tasks: ['Research topic and gather sources', 'Create outline', 'Write first draft', 'Edit and revise', 'Publish'],
  },
  {
    pattern: /api|endpoint|backend|server/i,
    tasks: ['Design API schema/routes', 'Implement endpoints', 'Add validation and error handling', 'Write tests', 'Document the API'],
  },
  {
    pattern: /test|testing/i,
    tasks: ['Identify test scenarios', 'Write unit tests', 'Write integration tests', 'Run full test suite and fix failures'],
  },
  {
    pattern: /deploy|release|ship/i,
    tasks: ['Pre-deployment checks', 'Update configuration', 'Deploy to staging', 'Verify staging', 'Deploy to production'],
  },
  {
    pattern: /refactor|clean\s*up|reorganize/i,
    tasks: ['Audit current code', 'Plan refactoring approach', 'Implement refactoring', 'Test for regressions'],
  },
  {
    pattern: /design|ui|ux|interface/i,
    tasks: ['Research and gather inspiration', 'Create wireframes', 'Design high-fidelity mockups', 'Review and iterate', 'Hand off to development'],
  },
  {
    pattern: /migrate|migration/i,
    tasks: ['Analyze current state', 'Plan migration strategy', 'Implement migration', 'Validate data integrity', 'Switch over'],
  },
];

const DEFAULT_TASKS: string[] = ['Plan approach', 'Implement', 'Test', 'Document'];

interface AiResult {
  topology: 'single' | 'parallel';
  tasks?: string[];
}

function templateDecompose(input: string): string[] {
  for (const template of TEMPLATES) {
    if (template.pattern.test(input)) {
      return template.tasks;
    }
  }
  return DEFAULT_TASKS;
}

function contextualizeSteps(tasks: string[], input: string): string[] {
  const shortInput = input.length > 40 ? input.slice(0, 40) + '...' : input;
  return tasks.map(t => `${t} — ${shortInput}`);
}

async function aiDecompose(input: string): Promise<AiResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set. Use template mode (without --ai) or set the key.');
  }

  const systemPrompt = `You are a work analyzer. Given a goal, decide:
1. Can this be done by ONE agent in one session? (topology: "single")
2. Or does it break into INDEPENDENT parallel tasks? (topology: "parallel", tasks: ["title1", "title2", ...])

Rules:
- If tasks must be done sequentially, choose "single" (one agent handles the whole flow)
- Only choose "parallel" when tasks are truly independent and can run simultaneously
- 3-8 tasks max for parallel
- Each task title should be a short, actionable phrase`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: input }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            topology: { type: 'STRING', enum: ['single', 'parallel'] },
            tasks: {
              type: 'ARRAY',
              items: { type: 'STRING' },
            },
          },
          required: ['topology'],
        },
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json() as any;
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned no content');
  }

  const result = JSON.parse(text);
  if (!result.topology || !['single', 'parallel'].includes(result.topology)) {
    throw new Error('Gemini returned invalid topology');
  }

  if (result.topology === 'parallel') {
    if (!Array.isArray(result.tasks) || result.tasks.length === 0) {
      throw new Error('Gemini returned parallel topology but no tasks');
    }
    return {
      topology: 'parallel',
      tasks: result.tasks.map((t: any) => String(t)),
    };
  }

  return { topology: 'single' };
}

export async function doCommand(input: string, opts?: DoOptions): Promise<void> {
  const db = getDb();
  ensureConvoyTable(db);

  const project = opts?.project || '';
  const chain = opts?.chain || false;

  // AI mode
  if (opts?.ai) {
    try {
      console.log(`\n${c.dim}🤖 AI analyzing...${c.reset}`);
      const result = await aiDecompose(input);

      if (result.topology === 'single') {
        console.log(`\n${c.bold}🎯 Single Agent Recommended${c.reset}\n`);
        console.log(`  This is best handled by a single agent.`);
        console.log(`  Run: ${c.cyan}trak sling --goal '${input}'${c.reset}\n`);
        return;
      }

      // Parallel: create tasks with no deps (unless --chain)
      const tasks = result.tasks!;
      return createTasks(db, input, tasks, project, chain, '🤖 AI');
    } catch (err: any) {
      console.log(`\n${c.dim}⚠ AI analysis failed: ${err.message}${c.reset}`);
      console.log(`${c.dim}  Falling back to template mode${c.reset}`);
    }
  }

  // Template fallback — parallel by default (no deps unless --chain)
  const tasks = templateDecompose(input);
  const contextual = contextualizeSteps(tasks, input);
  return createTasks(db, input, contextual, project, chain, '📋 template');
}

function createTasks(
  db: ReturnType<typeof getDb>,
  input: string,
  tasks: string[],
  project: string,
  chain: boolean,
  modeLabel: string,
): void {
  // Create convoy for this batch
  const convoyId = `convoy-${generateId().split('-')[1]}`;
  db.exec(`CREATE TABLE IF NOT EXISTS convoys (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);
  db.prepare('INSERT INTO convoys (id, name) VALUES (?, ?)').run(convoyId, input);

  const taskIds: string[] = [];

  for (let i = 0; i < tasks.length; i++) {
    const id = generateId();
    const title = tasks[i];
    const description = `Part of: ${input}`;

    db.prepare(`
      INSERT INTO tasks (id, title, description, priority, project, autonomy, convoy, tags)
      VALUES (?, ?, ?, ?, ?, 'auto', ?, 'auto,do')
    `).run(id, title, description, 1, project, convoyId);

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      id, `Created by 'trak do': ${input}`
    );

    taskIds.push(id);
  }

  // Only chain deps if --chain flag is set
  if (chain) {
    for (let i = 1; i < taskIds.length; i++) {
      db.prepare('INSERT INTO dependencies (child_id, parent_id) VALUES (?, ?)').run(taskIds[i], taskIds[i - 1]);
    }
  }

  afterWrite(db);

  // Display the plan
  const topology = chain ? 'sequential' : 'parallel';
  console.log(`\n${c.bold}🚀 trak do${c.reset} — ${tasks.length} subtasks [${topology}] (${modeLabel})\n`);
  console.log(`  ${c.dim}Goal:${c.reset} ${input}`);
  console.log(`  ${c.dim}Convoy:${c.reset} ${convoyId}`);
  if (project) console.log(`  ${c.dim}Project:${c.reset} ${project}`);
  console.log(`\n${c.dim}${'─'.repeat(50)}${c.reset}\n`);

  for (let i = 0; i < taskIds.length; i++) {
    const ready = chain ? (i === 0 ? ` ${c.green}← READY${c.reset}` : '') : ` ${c.green}← READY${c.reset}`;
    const bullet = chain ? (i === 0 ? '▸' : '  →') : '▸';
    console.log(`  ${bullet} ${c.bold}${taskIds[i]}${c.reset} ${tasks[i]}${ready}`);
  }

  if (chain) {
    console.log(`\n${c.green}✓${c.reset} First ready task: ${c.bold}${taskIds[0]}${c.reset}\n`);
  } else {
    console.log(`\n${c.green}✓${c.reset} All ${taskIds.length} tasks ready — run ${c.cyan}trak run${c.reset} to dispatch\n`);
  }
}
