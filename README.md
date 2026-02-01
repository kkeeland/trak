# trak ⚡

**Task tracking for AI agent swarms.** Assign work to Claude Code, have Cursor verify it, track what it cost — all from the terminal in under 100ms.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/trak.svg)](https://www.npmjs.com/package/trak)

---

## Why You Need This

You're using Claude Code, Cursor, or Codex. Maybe all three. Here's what happens:

**Monday:** You tell Claude Code to build an auth system. It does great work. Session ends.

**Tuesday:** New session. Claude has no idea what happened yesterday. You re-explain everything. It starts from scratch, or worse — builds something that conflicts with Monday's work.

**Wednesday:** You've got Cursor fixing bugs while Claude Code builds features. They step on each other. Neither knows what the other did. You're the only one holding the full picture, and you're losing it.

**Thursday:** Your AI bill is $47 this week. On what? Which tasks? Which agent wasted tokens re-doing work? No idea.

**This is the problem.** AI agents are powerful but they have amnesia. Every session starts fresh. There's no shared memory, no coordination, no accountability. You become the bottleneck — the human router between agents that can't talk to each other.

**trak fixes this.**

```
trak ready                    # What needs doing? (instant, from SQLite)
trak status auth-fix wip      # Agent claims a task
trak log auth-fix "Fixed the JWT validation bug, added refresh tokens"
trak close auth-fix           # Done. Logged. Next agent picks up where this left off.
```

Every task has a **journal** — a persistent log of what happened, who did it, and what it cost. When a new agent session starts, it runs `trak context myproject` and gets the full story in seconds. No re-explaining. No lost work. No stepping on each other.

**The real unlock:** When you can assign Agent 1 to build something and Agent 2 to verify it — with the full chain tracked — you stop being the router and start being the decision-maker. That's what trak enables.

## The Solution

trak is a CLI-first task tracker built for multi-agent workflows. It's the coordination layer between your AI agents.

```bash
npx trak init
trak create "Build auth system" --project api -p 0
trak assign api-auth claude-code
trak verify api-auth --pass --agent cursor
trak cost --project api  # $0.42 across 3 agents
```

## Quick Start

```bash
npm install -g trak    # or: npx trak <command>
trak init              # initialize in current directory
trak setup claude      # auto-configure for Claude Code
trak create "My first task" --project myapp
trak board             # see everything at a glance
```

## One-Command Integration

trak auto-configures itself for your AI coding tool:

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
# 🔥 97  trak-a1b  Build auth system     [api]  P0
# 🔥 62  trak-c3d  Write unit tests      [api]  P1
# 🔥 34  trak-e5f  Update docs           [api]  P2
```

### 📋 Epics

Group tasks into big-picture containers with progress bars:

```bash
trak epic create "v2.0 Launch" --project api
trak epic list
# 📋 trak-abc [████░░░░] 4/10  v2.0 Launch  [api]
```

### 🔗 Dependencies

Model real workflows. `trak ready` shows only what's actually unblocked.

```bash
trak dep add trak-c3d trak-a1b   # tests depend on auth
trak ready                        # only shows unblocked work
```

### 🤖 Multi-Agent Coordination

```bash
trak assign <id> claude-code          # Agent 1 builds
trak verify <id> --pass --agent cursor  # Agent 2 reviews
trak claims                           # See who's working on what
trak pipeline <epic-id>               # Verification pipeline view
```

### ✅ Real Verification

"Verified" isn't a label — trak actually runs your tests.

**Run a command as verification:**
```bash
trak verify auth-fix --run "npm test"                    # runs tests, logs result
trak verify landing --run "npx next build"               # build must succeed
trak verify api --run "curl -s localhost:3000/health"     # check endpoint
```

If exit code 0 → PASSED. Non-zero → FAILED, status reverts to open. Command output, exit code, and duration are logged to the task journal.

**Review what changed since WIP started:**
```bash
trak status auth-fix wip      # records git HEAD as snapshot
# ... do work, make commits ...
trak verify auth-fix --diff    # git diff snapshot..HEAD
```

**Checklist verification:**
```bash
trak verify auth-fix --checklist "tests pass,no TS errors,no console.logs"
```
Each item is logged to the journal as checked.

**Auto-verify everything at once:**
```bash
trak verify auth-fix --auto
```
Runs the task's `verify_command` (if set), shows diff summary (if WIP snapshot exists), and logs it all.

**Still works manually too:**
```bash
trak verify auth-fix --pass --agent cursor --reason "Code reviewed, looks good"
trak verify auth-fix --fail --reason "Missing error handling"
```

### 📊 Cost Tracking

Know exactly what each task cost across agents and models.

```bash
trak cost --project api
```

### 📝 Task Journals

Every task has an append-only log — decisions, findings, progress.

```bash
trak log <id> "Found a race condition in the auth flow"
trak show <id>   # see full journal
```

### 🔍 Retro Vision

Trace any task backwards through its dependency tree. Auto-generate project context for new agents:

```bash
trak trace <id>        # full dependency tree
trak context myapp     # generate CONTEXT.md for new agents
```

### 🔄 Migration

Coming from Beads? One command:

```bash
trak import-beads .beads/
```

## Benchmarks

Measured on a 2GB VPS, Node 22 (median of 5 runs, 500 tasks across 5 projects with ~495 dependencies):

| Operation | Tasks | Time |
|-----------|-------|------|
| `trak create` | — | 0.1ms |
| `trak list` | 500 | 9.7ms |
| `trak board` | 500 | 13.7ms |
| `trak ready` | 500 | 5.9ms |
| `trak heat` | 500 | 22.9ms |
| `trak show` | 1 | 0.1ms |
| `trak close` | 1 | 0.2ms |

All operations under 25ms. SQLite doesn't need a network.

Run them yourself: `npm run bench`

## FAQ

**"This is just a SQLite wrapper around a todo list."**

Yes. And SQLite is just a file with SQL. Simplicity is the feature. Every operation under 25ms, zero config, works offline, no account needed. Try that with Linear.

**"Why not just use GitHub Issues?"**

GitHub Issues requires internet, has API rate limits (5000/hr), takes 200-800ms per call, and has zero concept of which AI agent is working on what. trak is local SQLite — your agents read/write task state without burning API calls or tokens re-explaining context.

**"The verification chain is just a status label."**

Not anymore. `trak verify --run "npm test"` actually executes your test suite and records pass/fail. `trak verify --diff` shows exactly what changed. Verification is real, not ceremonial.

**"Cost tracking is manual."**

Today, yes — agents log their own cost via `trak log`. Auto-detection hooks for Clawdbot are shipping in v0.2. For Claude Code and Cursor, there's no public API for token usage yet. When there is, trak will capture it. PRs welcome.

**"No tests?"**

[Test suite](src/). 40+ tests covering every command.

**"Another npm package with native deps?"**

better-sqlite3 uses native bindings for speed. If node-gyp is a problem, we're evaluating sql.js (WASM) as a fallback. Long-term: standalone binary via pkg or Bun.

**"Cool for one person, useless for teams."**

Local-first is a design choice, not a limitation. Team sync via git is on the roadmap. But the 90% use case today is one developer running multiple AI agents — and for that, local SQLite is 10x faster than any cloud API.

**"Why not just use Beads?"**

Beads is great — we used it before building trak. Here's what's different:

| | trak | Beads |
|---|---|---|
| Multi-agent coordination | ✅ assign, verify, claim | ❌ single-agent |
| Verification chains | ✅ --run, --diff | ❌ |
| Cost tracking | ✅ per task per agent | ❌ |
| One-command setup | ✅ `trak setup claude` | ❌ manual |
| Heat score | ✅ auto-priority | ❌ manual only |
| Migration | ✅ `trak import-beads` | — |

## All Commands

| Command | Description | Example |
|---------|-------------|---------|
| `init` | Initialize trak in current directory | `trak init` |
| `create` | Create a new task | `trak create "title" --project api -p 1` |
| `list` | List tasks with filters | `trak list --project api --status wip` |
| `ready` | Show unblocked tasks ready for work | `trak ready` |
| `board` | Board view grouped by project | `trak board` |
| `show` | Show full task detail + journal | `trak show trak-abc` |
| `status` | Change task status | `trak status trak-abc wip` |
| `log` | Append entry to task journal | `trak log trak-abc "progress note"` |
| `close` | Mark task as done | `trak close trak-abc` |
| `heat` | Show tasks by heat score | `trak heat` |
| `cost` | Cost tracking by project | `trak cost --project api` |
| `dep add` | Add dependency | `trak dep add child parent` |
| `dep rm` | Remove dependency | `trak dep rm child parent` |
| `epic create` | Create an epic | `trak epic create "v2" --project api` |
| `epic list` | List all epics with progress | `trak epic list` |
| `epic show` | Show epic detail | `trak epic show trak-abc` |
| `assign` | Assign task to an agent | `trak assign trak-abc claude-code` |
| `verify` | Record verification result | `trak verify trak-abc --pass --agent cursor` |
| `claim` | Claim a task for an agent | `trak claim trak-abc my-agent` |
| `claims` | Show all active claims | `trak claims` |
| `pipeline` | Verification pipeline for an epic | `trak pipeline trak-abc` |
| `stats` | Agent performance stats | `trak stats` |
| `trace` | Full dependency tree | `trak trace trak-abc` |
| `context` | Generate CONTEXT.md for a project | `trak context myapp` |
| `history` | Task history timeline | `trak history trak-abc` |
| `digest` | What changed in the last 24 hours | `trak digest` |
| `stale` | Tasks with no recent activity | `trak stale` |
| `setup` | Configure AI tool integration | `trak setup claude` |
| `import-beads` | Import from beads workspace | `trak import-beads .beads/` |
| `export` | Dump all data to JSON | `trak export` |
| `import` | Import tasks from JSON | `trak import tasks.json` |

## Philosophy

- **Zero friction** — if it takes more than 2 seconds, it's too slow
- **Auto-track** — the best task tracker is invisible
- **Local-first** — SQLite, no accounts, no API keys, no network
- **AI-native** — built for agents first, humans second

## Architecture

- **Storage:** SQLite via better-sqlite3 (single file, `.trak/trak.db`)
- **Performance:** <100ms for any operation on 500+ tasks
- **Zero dependencies on external services** — works offline, works in CI, works anywhere Node runs

## Experimental Features

The following are shipped but evolving based on real-world usage:

- Multi-agent verification chains (assign, verify, claim)
- Pipeline views
- Agent performance stats
- Context generation

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT © Kevin Keeland
