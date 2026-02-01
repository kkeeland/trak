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
