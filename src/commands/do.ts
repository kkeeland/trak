import { getDb, Task, afterWrite } from '../db.js';
import { generateId, c, STATUS_EMOJI } from '../utils.js';
import { ensureConvoyTable, convoyCreateCommand } from './convoy.js';

export interface DoOptions {
  project?: string;
  ai?: boolean;
}

interface DecomposedStep {
  title: string;
  description: string;
  inputs: string;
  outputs: string;
}

interface DecompositionTemplate {
  pattern: RegExp;
  steps: DecomposedStep[];
}

const TEMPLATES: DecompositionTemplate[] = [
  {
    pattern: /landing\s*page/i,
    steps: [
      { title: 'Design layout and wireframes', description: 'Create wireframes showing the page layout, hero section, features grid, and CTA placement. Define the visual hierarchy and responsive breakpoints.', inputs: 'none', outputs: 'wireframes.md with layout specs and section descriptions' },
      { title: 'Write copy and content', description: 'Write all page copy: headline, subheadline, feature descriptions, testimonials, and CTA text. Ensure consistent tone and clear value proposition.', inputs: 'wireframes.md with section layout', outputs: 'copy.md with all text content organized by section' },
      { title: 'Build the page', description: 'Implement the landing page using the wireframes and copy. Build responsive HTML/CSS/JS with all sections, images, and interactive elements.', inputs: 'wireframes.md and copy.md', outputs: 'Working landing page files (index.html, styles.css, etc.)' },
      { title: 'Test and review', description: 'Test the page across browsers (Chrome, Firefox, Safari) and devices (mobile, tablet, desktop). Check accessibility, load time, and all links/CTAs.', inputs: 'Built landing page files', outputs: 'test-results.md with issues found and fixes applied' },
      { title: 'Deploy to production', description: 'Deploy the tested landing page to production hosting. Verify DNS, SSL, analytics tracking, and all functionality works in production.', inputs: 'Tested and fixed landing page', outputs: 'Live URL and deployment confirmation' },
    ],
  },
  {
    pattern: /fix\s*bug|bugfix|debug/i,
    steps: [
      { title: 'Reproduce the bug', description: 'Create a reliable reproduction of the bug. Document exact steps, environment, and expected vs actual behavior.', inputs: 'none', outputs: 'reproduction-steps.md with exact repro scenario' },
      { title: 'Identify root cause', description: 'Trace through code to find the root cause. Use debugging tools, logs, and tests to isolate the problem.', inputs: 'Reproduction steps', outputs: 'Root cause analysis with file/line references' },
      { title: 'Implement fix', description: 'Write the minimal, correct fix for the root cause. Ensure the fix doesn\'t introduce regressions.', inputs: 'Root cause analysis', outputs: 'Code changes (diff) implementing the fix' },
      { title: 'Test the fix', description: 'Verify the fix resolves the bug using the reproduction steps. Add a regression test to prevent recurrence.', inputs: 'Code changes and reproduction steps', outputs: 'Passing tests and verified fix' },
    ],
  },
  {
    pattern: /write\s*(an?\s+)?article|blog\s*post|write\s*up/i,
    steps: [
      { title: 'Research topic and gather sources', description: 'Research the topic thoroughly. Collect 5-10 credible sources, key statistics, and expert quotes.', inputs: 'none', outputs: 'research-notes.md with sources, key facts, and angles' },
      { title: 'Create outline', description: 'Structure the article with a clear thesis, logical section flow, and key points per section. Include intro hook and conclusion.', inputs: 'research-notes.md', outputs: 'outline.md with sections, key points, and source placement' },
      { title: 'Write first draft', description: 'Write the full article following the outline. Target appropriate word count with engaging prose, transitions, and sourced claims.', inputs: 'outline.md and research-notes.md', outputs: 'draft.md — complete first draft' },
      { title: 'Edit and revise', description: 'Edit for clarity, grammar, flow, and accuracy. Cut filler, strengthen weak sections, verify all facts and links.', inputs: 'draft.md', outputs: 'final.md — polished article ready to publish' },
      { title: 'Publish', description: 'Format and publish the article to the target platform. Add meta description, tags, featured image, and social sharing preview.', inputs: 'final.md', outputs: 'Published URL with confirmed formatting' },
    ],
  },
  {
    pattern: /api|endpoint|backend|server/i,
    steps: [
      { title: 'Design API schema/routes', description: 'Define all REST/GraphQL endpoints, request/response schemas, authentication, and error codes. Document in OpenAPI or equivalent format.', inputs: 'none', outputs: 'api-design.md with routes, schemas, and auth strategy' },
      { title: 'Implement endpoints', description: 'Build all API endpoints with proper routing, controllers, and data layer. Follow the schema design exactly.', inputs: 'api-design.md', outputs: 'Working endpoint code with all routes responding' },
      { title: 'Add validation and error handling', description: 'Add input validation, proper HTTP status codes, error messages, rate limiting, and edge case handling to all endpoints.', inputs: 'Working endpoint code', outputs: 'Hardened endpoints with validation and error handling' },
      { title: 'Write tests', description: 'Write unit tests for business logic and integration tests for all endpoints. Cover happy paths, edge cases, and error scenarios. Target >80% coverage.', inputs: 'Hardened endpoint code', outputs: 'Test suite with all tests passing' },
      { title: 'Document the API', description: 'Write API documentation with endpoint descriptions, example requests/responses, authentication guide, and quick-start tutorial.', inputs: 'Tested API code', outputs: 'README.md or docs/ with complete API documentation' },
    ],
  },
  {
    pattern: /test|testing/i,
    steps: [
      { title: 'Identify test scenarios', description: 'Analyze the codebase and requirements to identify all test scenarios: happy paths, edge cases, error conditions, and boundary values.', inputs: 'none', outputs: 'test-plan.md with categorized test scenarios' },
      { title: 'Write unit tests', description: 'Write unit tests for individual functions and modules. Mock external dependencies. Cover all identified scenarios.', inputs: 'test-plan.md', outputs: 'Unit test files with passing tests' },
      { title: 'Write integration tests', description: 'Write integration tests that verify components work together. Test API endpoints, database operations, and service interactions.', inputs: 'test-plan.md and unit tests', outputs: 'Integration test files with passing tests' },
      { title: 'Run full test suite and fix failures', description: 'Run the complete test suite, analyze failures, fix flaky tests, and ensure >80% code coverage.', inputs: 'All test files', outputs: 'All tests passing with coverage report' },
    ],
  },
  {
    pattern: /deploy|release|ship/i,
    steps: [
      { title: 'Pre-deployment checks', description: 'Run full test suite, check for security vulnerabilities, verify environment variables, and review recent changes.', inputs: 'none', outputs: 'pre-deploy-checklist.md with all checks passed' },
      { title: 'Update configuration', description: 'Update deployment configs, environment variables, feature flags, and version numbers for the target environment.', inputs: 'pre-deploy-checklist.md', outputs: 'Updated config files ready for deployment' },
      { title: 'Deploy to staging', description: 'Deploy to staging environment using the deployment pipeline. Verify the build succeeds and the app starts.', inputs: 'Updated config files', outputs: 'Running staging deployment with URL' },
      { title: 'Verify staging', description: 'Run smoke tests on staging. Verify all critical paths, new features, and no regressions. Check logs for errors.', inputs: 'Staging URL', outputs: 'staging-verification.md with test results' },
      { title: 'Deploy to production', description: 'Deploy to production. Monitor error rates, response times, and key metrics for 30 minutes post-deploy. Have rollback plan ready.', inputs: 'Verified staging build', outputs: 'Production deployment confirmed with monitoring dashboard' },
    ],
  },
  {
    pattern: /refactor|clean\s*up|reorganize/i,
    steps: [
      { title: 'Audit current code', description: 'Analyze the current codebase for code smells, duplication, complexity, and architectural issues. Document findings.', inputs: 'none', outputs: 'audit-report.md with issues ranked by severity' },
      { title: 'Plan refactoring approach', description: 'Design the target architecture and plan incremental refactoring steps. Ensure each step keeps the code working.', inputs: 'audit-report.md', outputs: 'refactor-plan.md with ordered steps and risk assessment' },
      { title: 'Implement refactoring', description: 'Execute the refactoring plan step by step. Make small, focused commits. Keep all tests passing throughout.', inputs: 'refactor-plan.md', outputs: 'Refactored code with clean commits' },
      { title: 'Test for regressions', description: 'Run the full test suite. Manually verify critical user flows. Compare behavior before and after refactoring.', inputs: 'Refactored code', outputs: 'All tests passing, no regressions confirmed' },
    ],
  },
  {
    pattern: /design|ui|ux|interface/i,
    steps: [
      { title: 'Research and gather inspiration', description: 'Research competitor designs, UI patterns, and user expectations. Collect a mood board of 10+ reference designs.', inputs: 'none', outputs: 'inspiration.md with links, screenshots, and pattern notes' },
      { title: 'Create wireframes', description: 'Create low-fidelity wireframes for all screens/states. Define layout, navigation, and interaction patterns.', inputs: 'inspiration.md', outputs: 'wireframes/ directory with all screen wireframes' },
      { title: 'Design high-fidelity mockups', description: 'Create pixel-perfect mockups with final colors, typography, spacing, and imagery. Include hover/active states.', inputs: 'wireframes/', outputs: 'mockups/ directory with all final designs' },
      { title: 'Review and iterate', description: 'Review designs for consistency, accessibility (WCAG AA), and usability. Iterate based on feedback.', inputs: 'mockups/', outputs: 'Revised mockups with review notes addressed' },
      { title: 'Hand off to development', description: 'Prepare design specs: spacing, colors, fonts, assets, and interaction notes. Export all assets in required formats.', inputs: 'Final mockups', outputs: 'design-specs.md and assets/ directory' },
    ],
  },
  {
    pattern: /migrate|migration/i,
    steps: [
      { title: 'Analyze current state', description: 'Document the current system: data schemas, dependencies, integrations, and traffic patterns. Identify migration risks.', inputs: 'none', outputs: 'current-state.md with system analysis and risk assessment' },
      { title: 'Plan migration strategy', description: 'Design the migration approach (big bang vs incremental). Plan data transformation, rollback procedures, and testing strategy.', inputs: 'current-state.md', outputs: 'migration-plan.md with step-by-step procedure and rollback plan' },
      { title: 'Implement migration', description: 'Build migration scripts, data transformers, and compatibility layers. Test with production-like data volumes.', inputs: 'migration-plan.md', outputs: 'Migration scripts and compatibility code' },
      { title: 'Validate data integrity', description: 'Run migration on a copy of production data. Verify row counts, data accuracy, relationship integrity, and no data loss.', inputs: 'Migration scripts and test data', outputs: 'validation-report.md confirming data integrity' },
      { title: 'Switch over', description: 'Execute the production migration during the maintenance window. Verify all systems, update DNS/configs, and monitor for issues.', inputs: 'Validated migration scripts', outputs: 'Completed migration with monitoring confirmation' },
    ],
  },
];

const DEFAULT_STEPS: DecomposedStep[] = [
  { title: 'Plan approach', description: 'Analyze the goal, define scope, identify requirements, and create an actionable plan with clear milestones.', inputs: 'none', outputs: 'plan.md with requirements, approach, and milestones' },
  { title: 'Implement', description: 'Build the solution following the plan. Write clean, well-structured code or content. Follow best practices.', inputs: 'plan.md', outputs: 'Working implementation with all planned features' },
  { title: 'Test', description: 'Verify the implementation works correctly. Test edge cases, error handling, and integration points.', inputs: 'Working implementation', outputs: 'All tests passing, issues fixed' },
  { title: 'Document', description: 'Write clear documentation covering usage, configuration, architecture decisions, and any gotchas.', inputs: 'Tested implementation', outputs: 'README.md or docs with complete documentation' },
];

function decompose(input: string): DecomposedStep[] {
  for (const template of TEMPLATES) {
    if (template.pattern.test(input)) {
      return template.steps;
    }
  }
  return DEFAULT_STEPS;
}

function contextualizeSteps(steps: DecomposedStep[], input: string): DecomposedStep[] {
  const shortInput = input.length > 40 ? input.slice(0, 40) + '...' : input;
  return steps.map(step => ({ ...step, title: `${step.title} — ${shortInput}` }));
}

async function aiDecompose(input: string): Promise<DecomposedStep[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set. Use template mode (without --ai) or set the key.');
  }

  const systemPrompt = `You are a project decomposer. Break the user's goal into 3-7 sequential subtasks.
Each task should be specific enough for an AI agent to execute autonomously.
Include concrete acceptance criteria and expected artifacts in each description.
The "inputs" field describes what the task needs from the previous step.
The "outputs" field describes what the task produces for the next step.
Be specific about file names, formats, and quality expectations.`;

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
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              title: { type: 'STRING' },
              description: { type: 'STRING' },
              inputs: { type: 'STRING' },
              outputs: { type: 'STRING' },
            },
            required: ['title', 'description', 'inputs', 'outputs'],
          },
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

  const steps = JSON.parse(text);
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Gemini returned invalid format (expected non-empty array)');
  }

  return steps.map((s: any) => ({
    title: String(s.title || ''),
    description: String(s.description || ''),
    inputs: String(s.inputs || 'none'),
    outputs: String(s.outputs || ''),
  }));
}

export async function doCommand(input: string, opts?: DoOptions): Promise<void> {
  const db = getDb();
  ensureConvoyTable(db);

  let steps: DecomposedStep[];
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
    const step = contextualSteps[i];
    const fullDescription = `${step.description}\n\nInputs: ${step.inputs}\nOutputs: ${step.outputs}\n\nPart of: ${input}`;

    db.prepare(`
      INSERT INTO tasks (id, title, description, priority, project, autonomy, convoy, tags)
      VALUES (?, ?, ?, ?, ?, 'auto', ?, 'auto,do')
    `).run(id, step.title, fullDescription, 1, project, convoyId);

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
    console.log(`  ${arrow} ${c.bold}${taskIds[i]}${c.reset} ${contextualSteps[i].title}${ready}`);
  }

  console.log(`\n${c.green}✓${c.reset} First ready task: ${c.bold}${taskIds[0]}${c.reset}\n`);
}
