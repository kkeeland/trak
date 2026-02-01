import fs from 'fs';
import path from 'path';
import { c } from '../utils.js';

// --- Tool definitions ---

interface ToolDef {
  name: string;
  description: string;
  file: string;
  marker: string;
  content: string;
}

const CLAUDE_CONTENT = `
<!-- trak:setup -->
## Task Tracking (trak)
Use the \`trak\` CLI for persistent task tracking across sessions.
- Start of session: \`trak ready\` to see unblocked tasks
- Pick a task: \`trak status <id> wip\`
- Log progress: \`trak log <id> "what you did"\`
- Finish: \`trak close <id>\`
- Create new tasks: \`trak create "title" --project <name> -p <0-3>\`
- Check the board: \`trak board\`
- See all epics: \`trak epic list\`
`;

const CURSOR_CONTENT = `
# trak:setup
# Task Tracking (trak)
Before starting any task, run \`trak ready\` to see available work.
Pick the highest-priority unblocked task and run \`trak status <id> wip\`.
Log progress with \`trak log <id> "description"\`.
When finished, run \`trak close <id>\`.
To create tasks: \`trak create "title" --project <name> -p <0-3>\`
`;

const AGENTS_CONTENT = `
<!-- trak:setup -->
## Task Tracking (trak)
Use the \`trak\` CLI for persistent task tracking across sessions.
- Start of session: \`trak ready\` to see unblocked tasks
- Pick a task: \`trak status <id> wip\`
- Log progress: \`trak log <id> "what you did"\`
- Finish: \`trak close <id>\`
- Create new tasks: \`trak create "title" --project <name> -p <0-3>\`
- Check the board: \`trak board\`
- See all epics: \`trak epic list\`
`;

const AIDER_CONTENT = `
# trak:setup
# Task Tracking (trak)
# Before starting any task, run \`trak ready\` to see available work.
# Pick the highest-priority unblocked task and run \`trak status <id> wip\`.
# Log progress with \`trak log <id> "description"\`.
# When finished, run \`trak close <id>\`.
# To create tasks: \`trak create "title" --project <name> -p <0-3>\`
`;

const CONVENTIONS_CONTENT = `
<!-- trak:setup -->
## Task Tracking (trak)
Use the \`trak\` CLI for persistent task tracking across sessions.
- Start of session: \`trak ready\` to see unblocked tasks
- Pick a task: \`trak status <id> wip\`
- Log progress: \`trak log <id> "what you did"\`
- Finish: \`trak close <id>\`
- Create new tasks: \`trak create "title" --project <name> -p <0-3>\`
- Check the board: \`trak board\`
`;

const GENERIC_CONTENT = `# Task Tracking (trak)
Use the \`trak\` CLI for persistent task tracking across sessions.
- Start of session: \`trak ready\` to see unblocked tasks
- Pick a task: \`trak status <id> wip\`
- Log progress: \`trak log <id> "what you did"\`
- Finish: \`trak close <id>\`
- Create new tasks: \`trak create "title" --project <name> -p <0-3>\`
- Check the board: \`trak board\`
- See all epics: \`trak epic list\``;

const TOOLS: Record<string, ToolDef> = {
  claude: {
    name: 'Claude Code',
    description: 'Claude Code (CLAUDE.md)',
    file: 'CLAUDE.md',
    marker: 'trak:setup',
    content: CLAUDE_CONTENT,
  },
  cursor: {
    name: 'Cursor',
    description: 'Cursor (.cursorrules)',
    file: '.cursorrules',
    marker: 'trak:setup',
    content: CURSOR_CONTENT,
  },
  clawdbot: {
    name: 'Clawdbot',
    description: 'Clawdbot (AGENTS.md)',
    file: 'AGENTS.md',
    marker: 'trak:setup',
    content: AGENTS_CONTENT,
  },
  codex: {
    name: 'OpenAI Codex',
    description: 'OpenAI Codex (AGENTS.md)',
    file: 'AGENTS.md',
    marker: 'trak:setup',
    content: AGENTS_CONTENT,
  },
  aider: {
    name: 'Aider',
    description: 'Aider (.aider.conf.yml or CONVENTIONS.md)',
    file: '.aider.conf.yml', // primary target
    marker: 'trak:setup',
    content: AIDER_CONTENT,
  },
  generic: {
    name: 'Generic',
    description: 'Generic (prints to stdout)',
    file: '',
    marker: 'trak:setup',
    content: GENERIC_CONTENT,
  },
};

const SUPPORTED_TOOLS = Object.keys(TOOLS).filter(t => t !== 'generic');

// --- Helpers ---

function fileHasMarker(filePath: string, marker: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.includes(marker);
}

function appendToFile(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8');
    fs.writeFileSync(filePath, existing.trimEnd() + '\n' + content);
  } else {
    fs.writeFileSync(filePath, content.trimStart());
  }
}

// --- Setup per tool ---

function setupTool(toolName: string): void {
  const tool = TOOLS[toolName];
  if (!tool) {
    console.error(`${c.red}✗${c.reset} Unknown tool: ${toolName}`);
    console.log(`  Supported tools: ${SUPPORTED_TOOLS.join(', ')}, generic`);
    process.exit(1);
  }

  // Generic: just print to stdout
  if (toolName === 'generic') {
    console.log(GENERIC_CONTENT);
    return;
  }

  // Aider: check for .aider.conf.yml first, fall back to CONVENTIONS.md
  if (toolName === 'aider') {
    const aiderConf = path.resolve('.aider.conf.yml');
    if (fs.existsSync(aiderConf)) {
      if (fileHasMarker(aiderConf, tool.marker)) {
        console.log(`${c.green}✓${c.reset} trak already configured in ${c.dim}.aider.conf.yml${c.reset}`);
        return;
      }
      appendToFile(aiderConf, AIDER_CONTENT);
      console.log(`${c.green}✓${c.reset} Aider integration added to ${c.bold}.aider.conf.yml${c.reset}`);
      return;
    }
    // Fall back to CONVENTIONS.md
    const convFile = path.resolve('CONVENTIONS.md');
    if (fileHasMarker(convFile, 'trak:setup')) {
      console.log(`${c.green}✓${c.reset} trak already configured in ${c.dim}CONVENTIONS.md${c.reset}`);
      return;
    }
    appendToFile(convFile, CONVENTIONS_CONTENT);
    console.log(`${c.green}✓${c.reset} Aider integration added to ${c.bold}CONVENTIONS.md${c.reset}`);
    return;
  }

  const filePath = path.resolve(tool.file);

  if (fileHasMarker(filePath, tool.marker)) {
    console.log(`${c.green}✓${c.reset} trak already configured in ${c.dim}${tool.file}${c.reset}`);
    return;
  }

  appendToFile(filePath, tool.content);
  console.log(`${c.green}✓${c.reset} ${tool.name} integration added to ${c.bold}${tool.file}${c.reset}`);
}

// --- Auto-detect ---

function autoDetect(): void {
  const detected: string[] = [];

  if (fs.existsSync(path.resolve('CLAUDE.md'))) detected.push('claude');
  if (fs.existsSync(path.resolve('.cursorrules'))) detected.push('cursor');
  if (fs.existsSync(path.resolve('AGENTS.md'))) detected.push('clawdbot');
  if (fs.existsSync(path.resolve('.aider.conf.yml'))) detected.push('aider');
  if (fs.existsSync(path.resolve('CONVENTIONS.md'))) detected.push('aider');

  if (detected.length === 0) {
    console.log(`${c.dim}No config files detected. Here's the generic snippet:${c.reset}\n`);
    console.log(GENERIC_CONTENT);
    return;
  }

  // Dedupe
  const unique = [...new Set(detected)];

  console.log(`${c.bold}Detected:${c.reset} ${unique.map(t => TOOLS[t].description).join(', ')}\n`);

  for (const tool of unique) {
    setupTool(tool);
  }
}

// --- List ---

function listTools(): void {
  console.log(`${c.bold}Supported tools:${c.reset}\n`);
  for (const [key, tool] of Object.entries(TOOLS)) {
    console.log(`  ${c.cyan}${key.padEnd(10)}${c.reset} ${tool.description}`);
  }
  console.log(`\nUsage: ${c.dim}trak setup <tool>${c.reset}`);
}

// --- Export ---

export function setupCommand(tool?: string, opts?: { list?: boolean }): void {
  if (opts?.list) {
    listTools();
    return;
  }

  if (!tool) {
    autoDetect();
    return;
  }

  setupTool(tool);
}
