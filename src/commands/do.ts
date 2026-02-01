import { getDb, Task, afterWrite } from '../db.js';
import { generateId, c, STATUS_EMOJI } from '../utils.js';
import { ensureConvoyTable, convoyCreateCommand } from './convoy.js';

export interface DoOptions {
  project?: string;
  ai?: boolean;
}

interface DecompositionTemplate {
  pattern: RegExp;
  steps: string[];
}

const TEMPLATES: DecompositionTemplate[] = [
  {
    pattern: /landing\s*page/i,
    steps: ['Design layout and wireframes', 'Write copy and content', 'Build the page', 'Test and review', 'Deploy to production'],
  },
  {
    pattern: /fix\s*bug|bugfix|debug/i,
    steps: ['Reproduce the bug', 'Identify root cause', 'Implement fix', 'Test the fix'],
  },
  {
    pattern: /write\s*(an?\s+)?article|blog\s*post|write\s*up/i,
    steps: ['Research topic and gather sources', 'Create outline', 'Write first draft', 'Edit and revise', 'Publish'],
  },
  {
    pattern: /api|endpoint|backend|server/i,
    steps: ['Design API schema/routes', 'Implement endpoints', 'Add validation and error handling', 'Write tests', 'Document the API'],
  },
  {
    pattern: /test|testing/i,
    steps: ['Identify test scenarios', 'Write unit tests', 'Write integration tests', 'Run full test suite and fix failures'],
  },
  {
    pattern: /deploy|release|ship/i,
    steps: ['Pre-deployment checks', 'Update configuration', 'Deploy to staging', 'Verify staging', 'Deploy to production'],
  },
  {
    pattern: /refactor|clean\s*up|reorganize/i,
    steps: ['Audit current code', 'Plan refactoring approach', 'Implement refactoring', 'Test for regressions'],
  },
  {
    pattern: /design|ui|ux|interface/i,
    steps: ['Research and gather inspiration', 'Create wireframes', 'Design high-fidelity mockups', 'Review and iterate', 'Hand off to development'],
  },
  {
    pattern: /migrate|migration/i,
    steps: ['Analyze current state', 'Plan migration strategy', 'Implement migration', 'Validate data integrity', 'Switch over'],
  },
];

const DEFAULT_STEPS = ['Plan approach', 'Implement', 'Test', 'Document'];

function decompose(input: string): string[] {
  for (const template of TEMPLATES) {
    if (template.pattern.test(input)) {
      return template.steps;
    }
  }
  return DEFAULT_STEPS;
}

function contextualizeSteps(steps: string[], input: string): string[] {
  // Make step titles more specific to the input
  const shortInput = input.length > 40 ? input.slice(0, 40) + '...' : input;
  return steps.map(step => `${step} — ${shortInput}`);
}

async function aiDecompose(input: string): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set. Use template mode (without --ai) or set the key.');
  }

  const prompt = `You are a task decomposition expert. Break down the following goal into 3-7 sequential subtasks.
Each subtask should be a clear, actionable step. Return a JSON array of strings (subtask titles only).
Keep titles concise but specific. Order them sequentially — each depends on the previous one completing.

Goal: "${input}"

Return format: ["step 1 title", "step 2 title", ...]`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
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

  const steps = JSON.parse(text);
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Gemini returned invalid format (expected non-empty array)');
  }

  return steps.map((s: any) => String(s));
}

export async function doCommand(input: string, opts?: DoOptions): Promise<void> {
  const db = getDb();
  ensureConvoyTable(db);

  let steps: string[];
  let usedAi = false;

  if (opts?.ai) {
    try {
      console.log(`\n${c.dim}🤖 AI decomposing...${c.reset}`);
      steps = await aiDecompose(input);
      usedAi = true;
    } catch (err: any) {
      console.log(`\n${c.dim}⚠ AI decomposition failed: ${err.message}${c.reset}`);
      console.log(`${c.dim}  Falling back to template mode${c.reset}`);
      steps = decompose(input);
    }
  } else {
    steps = decompose(input);
  }

  const project = opts?.project || '';

  // Create convoy for this batch
  const convoyId = `convoy-${generateId().split('-')[1]}`;
  db.exec(`CREATE TABLE IF NOT EXISTS convoys (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`);
  db.prepare('INSERT INTO convoys (id, name) VALUES (?, ?)').run(convoyId, input);

  const taskIds: string[] = [];
  const contextualSteps = usedAi ? steps : contextualizeSteps(steps, input);

  // Create subtasks
  for (let i = 0; i < contextualSteps.length; i++) {
    const id = generateId();
    const title = contextualSteps[i];

    db.prepare(`
      INSERT INTO tasks (id, title, description, priority, project, autonomy, convoy, tags)
      VALUES (?, ?, ?, ?, ?, 'auto', ?, 'auto,do')
    `).run(id, title, `Part of: ${input}`, 1, project, convoyId);

    db.prepare("INSERT INTO task_log (task_id, entry, author) VALUES (?, ?, 'system')").run(
      id, `Created by 'trak do': ${input}`
    );

    taskIds.push(id);
  }

  // Chain dependencies: each task depends on the previous
  for (let i = 1; i < taskIds.length; i++) {
    db.prepare('INSERT INTO dependencies (child_id, parent_id) VALUES (?, ?)').run(taskIds[i], taskIds[i - 1]);
  }

  afterWrite(db);

  // Display the plan
  const modeLabel = usedAi ? '🤖 AI' : '📋 template';
  console.log(`\n${c.bold}🚀 trak do${c.reset} — decomposed into ${steps.length} subtasks (${modeLabel})\n`);
  console.log(`  ${c.dim}Goal:${c.reset} ${input}`);
  console.log(`  ${c.dim}Convoy:${c.reset} ${convoyId}`);
  if (project) console.log(`  ${c.dim}Project:${c.reset} ${project}`);
  console.log(`\n${c.dim}${'─'.repeat(50)}${c.reset}\n`);

  for (let i = 0; i < taskIds.length; i++) {
    const arrow = i === 0 ? '▸' : '  →';
    const ready = i === 0 ? ` ${c.green}← READY${c.reset}` : '';
    console.log(`  ${arrow} ${c.bold}${taskIds[i]}${c.reset} ${contextualSteps[i]}${ready}`);
  }

  console.log(`\n${c.green}✓${c.reset} First ready task: ${c.bold}${taskIds[0]}${c.reset}\n`);
}
