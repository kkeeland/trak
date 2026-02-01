# trak ⚡

**Task tracking for AI agent swarms.** Assign work to Claude Code, have Cursor verify it, track what it cost — all from the terminal in under 100ms.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Status

**v0.2.0 — actively developed.** This is real software we use daily, but it's early:

- ✅ Core task tracking, dependencies, epics, heat scoring — all solid
- ✅ JSONL sync layer — export/import works, git-based sync is functional
- ⚠️ JSONL conflict resolution is basic (last-write-wins)
- ⚠️ Cost tracking requires manual logging (`--cost`/`--tokens` flags) — no auto-integration yet
- ✅ Available on npm as `trak-cli`
- 🔧 Multi-agent verification chains work but are still evolving

## Why

You're running Claude Code, Cursor, or Codex — maybe all three. Every new session starts fresh. There's no shared memory, no coordination, no accountability between agents. You become the bottleneck: the human router between agents that can't talk to each other.

trak gives your agents a shared task board. Each task has a journal — a persistent log of what happened, who did it, and what it cost. When a new agent session starts, it reads the board and picks up where the last one left off.

## Quick Start

```bash
# Install from npm
npm install -g trak-cli

# Or run without installing
npx trak-cli

# Or install from git
git clone https://github.com/kkeeland/trak.git
cd trak && npm install && npm run build
npm link  # makes `trak` available globally

# Initialize in your project
cd ~/my-project
trak init
trak setup claude      # auto-configure for Claude Code

# Start tracking
trak create "Build auth system" --project api -p 0
trak board
```

## Real Usage

```bash
# Create tasks with context
trak create "Fix JWT refresh token race condition" --project api -p 2
trak create "Add rate limiting middleware" --project api --tags "security,p0"

# See what's ready to work on
trak ready

# Track progress with journal entries
trak status trak-a1b wip
trak log trak-a1b "Found the bug — refresh tokens aren't invalidated on logout"
trak log trak-a1b "Fixed. Added token blacklist with 15min TTL" --author claude-code

# Close with cost tracking
trak close trak-a1b --cost 0.42 --tokens 15000

# Multi-agent workflow
trak assign trak-c3d claude-code
trak verify trak-c3d --run "npm test"
trak verify trak-c3d --pass --agent cursor --reason "Code reviewed, looks good"

# See the big picture
trak board
trak cost --project api
trak heat
```

## Global Mode

trak can run from any directory with a global database:

```bash
trak init --global              # create ~/.trak/trak.db
trak create "Fix bug" --project api    # works from anywhere now
```

DB resolution order:
1. `TRAK_DB` environment variable
2. `.trak/trak.db` in current or parent directories (project-local)
3. `~/.trak/trak.db` (global)

## One-Command Integration

```bash
trak setup claude      # → appends to CLAUDE.md
trak setup cursor      # → appends to .cursorrules
trak setup clawdbot    # → appends to AGENTS.md
trak setup codex       # → appends to AGENTS.md
trak setup aider       # → appends to CONVENTIONS.md
```

Your agent starts tracking tasks automatically. No config files. No API keys.

## Features

### 🔥 Heat Score (Auto-Priority)

Tasks auto-sort by urgency. High dependency fan-out + age + recency = hot.

```bash
trak heat
```

### 📋 Epics

Group tasks into big-picture containers with progress tracking:

```bash
trak epic create "v2.0 Launch" --project api
trak create "Auth system" --epic trak-abc
trak epic list
```

### 🔗 Dependencies

Model real workflows. `trak ready` shows only what's actually unblocked.

```bash
trak dep add trak-c3d trak-a1b   # tests depend on auth
trak ready                        # only shows unblocked work
```

### 💰 Cost Tracking

Log costs when closing tasks or adding journal entries:

```bash
trak close trak-a1b --cost 0.42 --tokens 15000
trak log trak-a1b "Refactored auth" --cost 0.18 --tokens 8000
trak cost --project api
```

Cost and token values are **additive** — each `--cost`/`--tokens` flag adds to the task's running total.

### 🤖 Multi-Agent Coordination

```bash
trak assign <id> claude-code
trak verify <id> --run "npm test"
trak verify <id> --pass --agent cursor
trak claims
trak pipeline <epic-id>
```

### ✅ Real Verification

```bash
trak verify auth-fix --run "npm test"           # runs tests, logs result
trak verify auth-fix --diff                      # git diff since WIP started
trak verify auth-fix --checklist "tests,no TS errors"
trak verify auth-fix --pass --agent cursor
```

### 🔄 JSONL Sync

trak shadows every write to `.trak/trak.jsonl` — a portable, git-friendly snapshot:

```bash
trak sync              # export JSONL + git commit
trak sync --push       # also push to remote
```

Other clones can rebuild from the JSONL:
```bash
git pull
trak import .trak/trak.jsonl
```

### 📝 Task Journals

Every task has an append-only log — decisions, findings, progress:

```bash
trak log <id> "Found a race condition in the auth flow"
trak show <id>
```

### 🔍 Retro Vision

```bash
trak trace <id>        # full dependency tree
trak context myapp     # generate context doc for new agents
trak history <id>      # complete timeline
```

## Benchmarks

Measured on a 2GB VPS, Node 22 (median of 5 runs, 500 tasks):

| Operation | Tasks | Time |
|-----------|-------|------|
| `trak create` | — | 0.1ms |
| `trak list` | 500 | 9.7ms |
| `trak board` | 500 | 13.7ms |
| `trak ready` | 500 | 5.9ms |
| `trak heat` | 500 | 22.9ms |
| `trak show` | 1 | 0.1ms |
| `trak close` | 1 | 0.2ms |

Run them yourself: `npm run bench`

## Tests

93 tests covering every command, edge cases, sync, and error handling:

```bash
npm test
```

## Current Limitations

- **JSONL conflict resolution is last-write-wins.** If two agents write simultaneously, the last sync wins. Fine for single-developer multi-agent workflows; not ready for team use.
- **Cost tracking is manual.** Agents must pass `--cost`/`--tokens` explicitly. Auto-detection hooks are planned but depend on upstream APIs exposing token usage.
- **Available on npm as `trak-cli`.** Install globally with `npm i -g trak-cli` or use `npx trak-cli`.
- **SQLite + native deps.** `better-sqlite3` requires native compilation. If `node-gyp` is a problem, a WASM fallback is being evaluated.

## All Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize trak database |
| `create` | Create a new task |
| `list` / `ls` | List tasks with filters |
| `ready` | Show unblocked tasks |
| `board` | Board view by project |
| `show` | Full task detail + journal |
| `status` | Change task status |
| `log` | Append journal entry (supports `--cost`, `--tokens`) |
| `close` | Mark task done (supports `--cost`, `--tokens`) |
| `heat` | Tasks by heat score |
| `cost` | Cost tracking by project |
| `dep add/rm` | Manage dependencies |
| `epic create/list/show` | Manage epics |
| `assign` | Assign task to agent |
| `verify` | Verify task (--run, --diff, --pass/--fail) |
| `claim/claims` | Claim tasks for agents |
| `pipeline` | Verification pipeline |
| `stats` | Agent performance stats |
| `trace` | Dependency tree |
| `context` | Generate project context |
| `history` | Task timeline |
| `digest` | Last 24h changes |
| `stale` | Inactive tasks |
| `search` | Full-text search |
| `setup` | Configure AI tool integration |
| `sync` | Export JSONL + git commit |
| `config` | Manage trak configuration |
| `export/import` | JSON/JSONL data transfer |

## Philosophy

- **Zero friction** — if it takes more than 2 seconds, it's too slow
- **Local-first** — SQLite, no accounts, no API keys, no network
- **AI-native** — built for agents first, humans second

## Architecture

- **Storage:** SQLite via better-sqlite3 (`.trak/trak.db`)
- **Sync:** JSONL shadow writes (`.trak/trak.jsonl`) — git-friendly
- **Performance:** <25ms for any operation on 500+ tasks

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT © Kevin Keeland
