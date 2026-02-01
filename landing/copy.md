# trak Landing Page — Copy & Content

## Hero Section

**Headline:**
Task tracking for AI agent swarms.

**Subheadline:**
Assign work to Claude Code, have Cursor verify it, track what it cost — all from the terminal in under 100ms.

**CTA Button:**
Get Started → `npm install -g trak-cli`

**Secondary CTA:**
View on GitHub →

---

## Problem Section

**Headline:**
Your agents don't talk to each other.

**Body:**
You're running Claude Code, Cursor, and Codex — maybe all three. Every new session starts fresh. There's no shared memory, no coordination, no accountability between agents.

You've become the bottleneck: the human router between agents that can't talk to each other. Copy-pasting context, remembering who did what, losing track of costs.

---

## Solution Section

**Headline:**
Give your agents a shared task board.

**Body:**
trak gives every agent a persistent, local task board. Each task carries a journal — a running log of decisions, findings, and costs. When a new agent session starts, it reads the board and picks up where the last one left off.

No accounts. No API keys. No network. Just a SQLite database that lives in your repo.

**Key Points:**
- **Persistent context** — Journals survive session restarts. No more lost context.
- **Cost tracking** — Know exactly what each task costs in tokens and dollars.
- **Dependency chains** — Model real workflows. `trak ready` shows only unblocked work.
- **Verification** — Have one agent build it, another verify it. Trust but verify.

---

## Features Grid

### ⚡ Under 100ms — Always
Every operation completes in under 25ms on 500+ tasks. Create, list, close — instant. Your agents never wait.

### 🔥 Heat Score
Tasks auto-sort by urgency. High dependency fan-out + age + recency = hot. Stop triaging manually — let the math decide.

### 📋 Epics & Dependencies
Group tasks into epics. Define dependency chains. `trak ready` shows only what's actually unblocked. Your agents work on the right thing, every time.

### 💰 Cost Tracking
Log token usage and dollar costs per task. Roll up costs by project. Know exactly what your AI workforce is spending.

### 🤖 Multi-Agent Coordination
Assign tasks to specific agents. Claim work to prevent conflicts. Run verification pipelines — build with Claude, review with Cursor.

### 🔄 Git-Friendly Sync
Every write shadows to JSONL. Commit it, push it, pull it on another machine. No server needed — your repo is the sync layer.

### 📝 Task Journals
Every task has an append-only log. Decisions, findings, progress — all captured. New agents read the journal and understand the full history.

### 🔧 One-Command Setup
`trak setup claude` and you're done. Works with Claude Code, Cursor, Codex, Clawdbot, and Aider. Zero config.

---

## How It Works (3 Steps)

### Step 1: Initialize
```bash
trak init
trak setup claude
```
One command to create the database. One command to configure your agent.

### Step 2: Track
```bash
trak create "Build auth system" --project api -p 0
trak log trak-a1b "Found the bug — tokens aren't invalidated on logout"
trak close trak-a1b --cost 0.42 --tokens 15000
```
Create tasks, log progress, track costs. Every action under 100ms.

### Step 3: Coordinate
```bash
trak assign trak-c3d claude-code
trak verify trak-c3d --run "npm test"
trak verify trak-c3d --pass --agent cursor
```
Assign work to agents. Run verification. Build with one, review with another.

---

## Benchmarks Section

**Headline:**
Fast enough to never notice.

**Subheadline:**
Measured on a 2GB VPS, Node 22, 500 tasks. These are real numbers.

| Operation      | Time    |
|---------------|---------|
| `trak create` | 0.1ms   |
| `trak list`   | 9.7ms   |
| `trak board`  | 13.7ms  |
| `trak ready`  | 5.9ms   |
| `trak heat`   | 22.9ms  |
| `trak close`  | 0.2ms   |

---

## Social Proof / Credibility

**Headline:**
Built for real work.

**Body:**
trak isn't a weekend project. It's the tool we use daily to coordinate multiple AI agents across real codebases. 93 tests. Active development. MIT licensed.

**Stats:**
- 93 tests passing
- 30+ commands
- <25ms for any operation
- 0 external dependencies at runtime (just SQLite)

---

## Philosophy Section

**Headline:**
Principles, not features.

**Items:**
- **Zero friction** — If it takes more than 2 seconds, it's too slow.
- **Local-first** — SQLite, no accounts, no API keys, no network required.
- **AI-native** — Built for agents first, humans second.
- **Git-friendly** — Your repo is the source of truth, not some cloud service.

---

## CTA / Footer

**Headline:**
Start tracking in 30 seconds.

**Code Block:**
```bash
npm install -g trak-cli
cd your-project
trak init
trak setup claude
```

**Buttons:**
- Install from npm →
- View on GitHub →
- Read the docs →

**Footer Links:**
- GitHub
- npm
- MIT License
- Contributing Guide

---

## Meta / SEO

**Page Title:** trak — Task tracking for AI agent swarms

**Meta Description:** Coordinate Claude Code, Cursor, and Codex from your terminal. Track tasks, costs, and dependencies across AI agents. Local-first, under 100ms, zero config.

**Keywords:** AI task tracking, agent coordination, Claude Code, Cursor, multi-agent workflow, terminal task manager, developer tools, AI development tools
