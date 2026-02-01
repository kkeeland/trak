# trak

> AI-native task tracker — tasks are conversations, not tickets.

## What is trak?

**trak** is a CLI task tracker built for AI agents managing multiple projects. It's designed around the way agents actually work:

- **Tasks are conversations** — every task has a journal that captures the back-and-forth between humans and agents
- **Multi-project** — manage tasks across multiple projects from a single board
- **Heat scores** — auto-calculated priority based on dependency fan-out, age, and activity
- **Cost tracking** — know what each task costs in tokens and dollars
- **Agent-native** — tracks which agent session worked on what

## Install

```bash
# From npm (coming soon)
npm install -g trak

# From source
git clone https://github.com/kkeeland/trak.git
cd trak
npm install
npm run build
npm link
```

## Quick Start

```bash
trak init                                      # Initialize database
trak create "Build landing page" --project peptok   # Create a task
trak create "Fix auth bug" --project forge -p 3     # High priority
trak list                                      # See all active tasks
trak board                                     # Visual board grouped by project
trak ready                                     # What can I work on right now?
```

## Commands

| Command | Description |
|---------|-------------|
| `trak init` | Initialize SQLite database in `.trak/` |
| `trak create <title>` | Create a new task |
| `trak list` | List tasks with filters |
| `trak ready` | Show unblocked tasks ready for work |
| `trak board [project]` | Board view grouped by project |
| `trak show <id>` | Full task detail + journal |
| `trak status <id> <status>` | Change task status |
| `trak log <id> <entry>` | Append to task journal |
| `trak dep add <child> <parent>` | Add dependency |
| `trak dep rm <child> <parent>` | Remove dependency |
| `trak close <id>` | Mark task as done |
| `trak digest` | What changed in the last 24 hours |
| `trak stale [days]` | Tasks with no activity > N days |
| `trak cost` | Cost tracking by project |
| `trak heat` | Show tasks by heat score |
| `trak export` | Dump to JSON |
| `trak import <file>` | Import from JSON |
| `trak import-beads <path>` | Import from beads JSONL workspace |

### Create Options

```bash
trak create "title" \
  --project peptok    # Project grouping (-b alias)
  -p 2                # Priority (0-3)
  -d "description"    # Detailed description
  -t "tag1,tag2"      # Comma-separated tags
  --parent trak-abc   # Parent task (subtask)
  -s "agent-42"       # Agent session label
```

### List Filters

```bash
trak list --project peptok  # Filter by project
trak list --status wip      # Filter by status
trak list --tags "urgent"   # Filter by tag
trak list --all             # Include done/archived
trak list -v                # Verbose output
```

### Import from Beads

```bash
trak import-beads /path/to/.beads/            # Import from beads workspace dir
trak import-beads /path/to/issues.jsonl       # Import from specific JSONL file
```

Maps beads fields to trak schema: labels → project + tags, status, priority, dependencies.

## Statuses

| Status | Emoji | Description |
|--------|-------|-------------|
| open | ○ | New, not started |
| wip | 🔨 | Work in progress |
| blocked | 🚫 | Waiting on something |
| review | 👀 | Needs review |
| done | ✅ | Completed |
| archived | 📦 | Archived |

## Heat Score

trak auto-calculates a heat score for each task based on:

- **Dependency fan-out** — tasks blocking many others are hotter
- **Age** — older open tasks accumulate heat
- **Recency** — recently discussed tasks get a boost
- **Priority** — manual priority adds to heat
- **Blocked penalty** — blocked tasks cool down

```
▓▓▓▓▓ (8)  trak-a1b2c3 P3 [forge] Fix auth — blocking 3 others
▓▓▓░░ (5)  trak-d4e5f6 P2 [peptok] Landing page
▓░░░░ (2)  trak-g7h8i9 P1 [adapt] Update docs
```

## Philosophy

Traditional task trackers are built for humans clicking through web UIs. trak is different:

1. **CLI-first** — AI agents don't click buttons
2. **Journal-native** — every task captures the conversation, not just a title
3. **Multi-project** — agents manage portfolios, not single projects
4. **Cost-aware** — in an AI world, work has measurable token costs
5. **Heat over priority** — computed importance beats gut-feel priority

trak doesn't try to be Jira. It's a lightweight, fast, local-first task tracker that treats AI agents as first-class citizens.

## Schema

SQLite database stored in `.trak/trak.db`:

- **tasks** — core task data with status, priority, project, cost tracking
- **dependencies** — directed graph of task dependencies
- **task_log** — append-only journal for each task

## License

MIT © Kevin Keeland
