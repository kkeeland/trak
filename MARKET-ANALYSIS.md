# trak — Competitive Analysis & Market Positioning

**Date:** February 1, 2026
**Author:** Noia Market Intelligence
**Status:** Decision Document

---

## Executive Summary

trak enters a market with **no direct competitor** that combines all three of its core pillars: CLI-first task tracking, multi-agent coordination, and chain-of-verification workflows. The closest competitor (Beads by Steve Yegge) shares the AI-agent task tracking concept but lacks multi-agent coordination, verification chains, and cost tracking. Traditional CLI task managers (Taskwarrior, Ultralist, dstask) have zero AI awareness. Multi-agent frameworks (CrewAI, AutoGen, LangGraph) handle orchestration but not persistent task state across sessions. This gap is trak's opportunity.

---

## 1. Competitive Matrix

| Tool | Type | AI-Native | Multi-Agent Coord | Verification Chain | Cost/Token Track | Local-First | Price | Stars/Community | Last Active |
|------|------|-----------|-------------------|-------------------|-----------------|-------------|-------|-----------------|-------------|
| **trak** | CLI task tracker | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes | ✅ SQLite | Free/OSS | New | — |
| **Beads** (steveyegge) | CLI issue tracker | ✅ Yes | ⚠️ Partial (multi-branch) | ❌ No | ❌ No | ✅ Git+SQLite | Free/OSS | ~2.5k+ | Active (2026) |
| **Taskwarrior** | CLI task manager | ❌ No | ❌ No | ❌ No | ❌ No | ✅ Local files | Free/OSS | ~4.5k | Active (v3.0) |
| **Ultralist** | CLI todo | ❌ No | ❌ No | ❌ No | ❌ No | ✅ JSON file | Free + Pro ($) | ~700 | Maintained |
| **dstask** | CLI task tracker | ❌ No | ❌ No | ❌ No | ❌ No | ✅ Git-backed | Free/OSS | ~800 | Active |
| **Linear** (+ CLI) | Project mgmt SaaS | ⚠️ Agent API (new) | ⚠️ Agent assignees | ❌ No | ❌ No | ❌ Cloud | Free–$12/seat/mo | Massive (100k+ orgs) | Very active |
| **GitHub Issues + CLI** | Issue tracking | ⚠️ gh-aw (agentic workflows) | ❌ No | ❌ No | ❌ No | ❌ Cloud | Free–$21/user/mo | Dominant | Very active |
| **Notion** | All-in-one workspace | ⚠️ Notion AI | ❌ No | ❌ No | ❌ No | ❌ Cloud | Free–$18/user/mo | Dominant | Very active |
| **Claude Code Tasks** | Built-in tool | ✅ Yes | ⚠️ Sub-agents only | ❌ No | ❌ No | ⚠️ Session-scoped | Included w/ Claude | N/A (built-in) | Jan 2026 |
| **Cursor** | IDE agent | ⚠️ Internal todos | ⚠️ Parallel agents (up to 8) | ❌ No | ❌ No | ⚠️ Session-scoped | $20–40/mo | Massive | Very active |
| **Devin** | Autonomous agent | ⚠️ Internal planning | ❌ Single agent | ❌ No | ⚠️ ACU tracking | ❌ Cloud | $20–500/mo | Closed source | Active |
| **OpenHands** | Agent platform | ⚠️ Internal planning | ❌ No | ❌ No | ❌ No | ⚠️ Hybrid | Free (OSS) + Cloud | ~50k+ | Very active |
| **CrewAI** | Multi-agent framework | ✅ Yes | ✅ Yes (Crews) | ⚠️ Human-in-loop | ⚠️ Tracing only | ❌ Cloud/Python | Free OSS / $99–$10k/mo | ~28k | Very active |
| **AutoGen** | Multi-agent framework | ✅ Yes | ✅ Yes (teams) | ⚠️ Human-in-loop | ⚠️ OpenTelemetry | ❌ Python runtime | Free/OSS | ~53k | Very active |
| **LangGraph** | Agent state mgmt | ✅ Yes | ✅ Yes (graph) | ⚠️ Checkpoints | ⚠️ LangSmith traces | ❌ Python runtime | Free OSS / LangSmith $$ | ~10k+ | Very active |
| **Mastra** | Workflow orchestration | ✅ Yes | ✅ Yes (Agent Network) | ⚠️ Workflow steps | ❌ No | ❌ TS runtime | Free/OSS | ~19k | Very active |
| **Prefect** | Workflow engine | ⚠️ ControlFlow (AI) | ❌ No | ❌ No | ❌ No | ❌ Cloud | Free–$$/enterprise | ~20k+ | Very active |
| **Temporal** | Durable execution | ❌ No | ❌ No | ❌ No | ❌ No | ❌ Cloud | Free OSS / Cloud $$ | ~13k+ | Very active |

### Legend
- ✅ = First-class, built-in feature
- ⚠️ = Partial / bolt-on / limited
- ❌ = Not present

---

## 2. Detailed Competitor Profiles

### 2.1 Beads (steveyegge/beads) — THE PRIMARY COMPETITOR

**What it does:** Git-backed, dependency-aware issue tracker designed specifically for AI coding agents. Uses JSONL stored in `.beads/` directory, with SQLite cache for speed. Created by Steve Yegge (ex-Google, ex-Amazon). Same `bd` CLI prefix. Positions itself as "a memory upgrade for your coding agent."

**Stars:** ~2,500+ (launched Oct 2025, grew fast on HN/Twitter)
**Pricing:** Free, MIT license
**Key features:**
- Dependency-aware task graph
- Hash-based IDs (bd-a1b2) for merge-conflict avoidance
- Hierarchical IDs for epics (bd-a3f8.1.1)
- `bd ready` to show unblocked tasks
- Git sync (passwordstore.org style)
- Compaction / memory decay for old tasks
- Stealth mode, contributor mode
- Jira sync scripts
- Community-built web UIs, editor extensions

**What Beads LACKS (trak's advantages):**
- ❌ **No multi-agent coordination** — explicitly calls itself a "personal task tracker." No assign/claim model.
- ❌ **No verification chains** — no concept of Agent 1 builds → Agent 2 verifies → Human approves
- ❌ **No cost/token tracking** — no awareness of API spend per task
- ❌ **No one-command agent setup** — requires manual AGENTS.md configuration
- ❌ **No board views** — CLI table only (relies on community web UIs)
- ❌ **No heat score / auto-priority** — manual priority only
- ❌ **Known issues with Claude Code + Opus** — agents get syntax wrong, database corruption reported (Issue #429)
- ❌ **Git dependency** — requires git for sync, heavier than pure SQLite
- ❌ **No project grouping** — each project is isolated, no cross-project views

**Risk from Beads:** Moderate. Same space, established community, Steve Yegge's name recognition. But fundamentally different philosophy (single-agent vs multi-agent).

---

### 2.2 Taskwarrior

**What it does:** The OG CLI task manager. 20+ years of development. Rich filtering, custom reports, hooks system, UDP sync via taskserver. Written in C++.

**Stars:** ~4,500 | **Community:** Reddit r/taskwarrior, Discord, massive ecosystem of 50+ tools
**Pricing:** Free, MIT
**Key features:** Tags, projects, priorities, due dates, recurrence, annotations, custom UDAs (user-defined attributes), hooks, Bugwarrior (import GitHub issues)
**Latest:** v3.0 (breaking upgrade from 2.x, new sync protocol)

**Gaps for AI agents:**
- Zero AI awareness — designed for humans typing commands
- No dependency tracking (planned for years, never shipped)
- No agent assignment, no verification, no cost tracking
- Sync requires taskserver setup (complex)
- Hook system is powerful but requires shell scripting

**Assessment:** Taskwarrior is the gold standard for human CLI task management. It has deep mind-share among terminal power users. But it is categorically not built for AI agents, and adding agent features would require a fundamental redesign. Not a competitor — it's a predecessor.

---

### 2.3 Ultralist

**What it does:** Simple GTD-based CLI todo for tech folks. Written in Go. JSON storage, due dates, projects, contexts, statuses, recurrence.

**Stars:** ~700 | **Last update:** Maintained but slow
**Pricing:** Free CLI + Ultralist Pro (web sync, Slack integration, mobile apps)
**Gaps:** No dependencies, no AI awareness, no agent features, no verification. Pro seems semi-abandoned (website from ~2020).

**Assessment:** Small, niche. Not a threat. Useful only as a feature comparison baseline.

---

### 2.4 dstask

**What it does:** Single-binary, git-synced personal task tracker. Markdown notes per task. Powerful context system (auto-filters). Explicitly "NOT for collaboration."

**Stars:** ~800 | **Last update:** Active
**Pricing:** Free, MIT
**Key features:** Context system, git sync, markdown notes, import from GitHub/Taskwarrior

**Gaps:** Explicitly anti-collaboration. No dependencies, no AI awareness, no multi-agent, no verification, no cost tracking.

**Assessment:** Good personal tool. Philosophically opposed to what trak does.

---

### 2.5 Linear (+ Agent API)

**What it does:** Modern project management SaaS. Beautiful UI, fast, opinionated workflows. In May 2025, launched "Linear for Agents" — agents as full workspace members that can be assigned issues, mentioned in comments, and work autonomously.

**Stars:** N/A (closed source SaaS) | **Community:** 100k+ orgs
**Pricing:** Free (small teams) → $8/seat/mo (Standard) → $12/seat/mo (Plus) → Enterprise
**Agent features (as of 2025):**
- Agent API for building custom agents
- Agents appear as team members
- Can assign issues to agents
- "Delegate issues, but not accountability" — human remains primary assignee
- Agent integrations marketplace (Cursor, GitHub Copilot, Codex, Sentry)
- Agents can work across multiple issues simultaneously

**Gaps:**
- ❌ **Cloud-only** — not local-first, requires internet, SaaS dependency
- ❌ **No verification chains** — agent does work, human reviews PR, but no formal chain
- ❌ **No cost tracking** — no awareness of tokens/API spend
- ❌ **No CLI-first experience** — web-first; CLI exists via third-party (Linearis) but not native
- ❌ **Per-seat pricing** — each agent seat costs money
- ❌ **Vendor lock-in** — your task data lives in Linear's cloud

**RISK LEVEL: HIGH.** Linear is the most likely incumbent to eat trak's lunch. If they add cost tracking and verification chains, the value prop narrows. However, Linear will never be local-first or CLI-first, which is trak's moat for the AI agent developer audience.

---

### 2.6 GitHub Issues + CLI (gh)

**What it does:** Universal issue tracker. `gh issue` CLI for creating, listing, managing issues. New `gh-aw` (GitHub Agentic Workflows) extension converts markdown to GitHub Actions that run AI agents.

**Community:** Dominant — every developer has a GitHub account
**Pricing:** Free (public) → $4-21/user/mo (private/enterprise)
**Agent features:**
- `gh-aw` extension for agentic workflows (run Claude, Codex, Copilot on schedules)
- Copilot Workspace for issue → PR flows
- Labels, milestones, projects for organization

**Gaps:**
- ❌ **Cloud-only** — requires GitHub, internet
- ❌ **No multi-agent coordination** — one agent per action run
- ❌ **No verification chains** — standard PR review, not structured agent verification
- ❌ **No cost tracking**
- ❌ **Slow for agent use** — API rate limits, network latency vs SQLite's <100ms
- ❌ **No dependencies** (natively — only via Projects)

**RISK LEVEL: MEDIUM.** GitHub will keep adding agent features, but they'll always be cloud-first and optimized for the Copilot ecosystem, not for heterogeneous agent stacks.

---

### 2.7 Notion / Notion API

**What it does:** All-in-one workspace with databases, wikis, task boards. API enables programmatic task management. Notion AI for content generation.

**Community:** Massive (millions of users)
**Pricing:** Free → $12/seat/mo (Plus) → $18/seat/mo (Business)

**Gaps:**
- ❌ **Slow API** — rate limited (3 req/sec), high latency vs SQLite
- ❌ **No AI agent awareness** — Notion AI is for content, not agent orchestration
- ❌ **No multi-agent**, no verification chains, no cost tracking
- ❌ **Cloud-only**, vendor lock-in
- ❌ **Overkill** — task tracking buried under page/database complexity

**RISK LEVEL: LOW.** Notion is a workspace, not a developer tool. They won't optimize for CLI agents.

---

### 2.8 Claude Code Tasks (built-in)

**What it does:** As of Claude Code 2.1+ (Jan 2026), Anthropic replaced the old TodoWrite system with a native Tasks system. Four tools: TaskCreate, TaskUpdate, TaskRead, TaskList. Tasks support dependencies, metadata, and parallel sub-agent coordination.

**Key details:**
- **Session-scoped** — tasks don't persist across sessions by default
- Dependencies between tasks
- Sub-agents can share task state via filesystem (`~/.claude/tasks`)
- Designed for within-session orchestration, not cross-session project management

**Gaps:**
- ❌ **Session-scoped** — explicitly does NOT persist across sessions (design choice)
- ❌ **Claude-only** — doesn't work with Cursor, Codex, aider, or other agents
- ❌ **No verification chains** — no concept of agent-verifies-agent
- ❌ **No cost tracking**
- ❌ **No board views, epics, filtering**
- ❌ **No project-level organization**

**RISK LEVEL: MEDIUM-HIGH.** Claude Code Tasks could evolve to be persistent. If Anthropic adds persistence + cost tracking, it becomes a strong built-in alternative for Claude-only workflows. But it will never be multi-agent-stack (Cursor + Claude + Codex), which is trak's key differentiator.

**OPPORTUNITY:** `trak setup claude` can integrate WITH Claude Code Tasks — trak as the persistent layer, Claude Tasks as the session layer.

---

### 2.9 Cursor

**What it does:** AI-first IDE (VS Code fork). Cursor 2.0 (Dec 2025) supports up to 8 parallel agents, dedicated Agent view, integrated Chrome DevTools.

**Pricing:** $20/mo (Pro) → $40/mo (Business)
**Task features:** Internal todo lists for agents (structured planning), but session-scoped and not exposed to users. No persistent task tracking.

**Gaps:**
- ❌ **No persistent task tracking** — agent todos are internal/ephemeral
- ❌ **Cursor-only** — no interop with Claude Code, Codex, etc.
- ❌ **No verification chains, cost tracking, dependencies**
- ❌ **IDE-bound** — can't use from terminal

**RISK LEVEL: LOW-MEDIUM.** Cursor focuses on the coding experience, not task management. Unlikely to build a full task tracker.

---

### 2.10 Devin / SWE-agent / OpenHands

**Devin:** Autonomous AI developer. $20-500/mo. Internal planning/task management but fully opaque — you give it an issue, it works. No user-facing task tracker. Tracks cost via ACUs (Agent Compute Units). Single-agent.

**SWE-agent:** Open-source autonomous coding agent (Princeton). Runs against SWE-bench. No task tracking — takes a single issue, attempts to solve it. Research project, not a product.

**OpenHands:** Open-source agent platform (~50k stars). Local GUI + cloud. Takes GitHub issues and produces PRs. No persistent task management — issue-in, PR-out workflow.

**Gaps (all three):**
- ❌ **Single-agent** — work on one issue at a time (OpenHands has some parallelism)
- ❌ **No user-facing task state** — opaque internal planning
- ❌ **No multi-agent coordination** across different tools
- ❌ **No verification chains** — PR review is the only checkpoint

**RISK LEVEL: LOW.** These are agent executors, not task trackers. Complementary to trak, not competitive.

---

### 2.11 CrewAI

**What it does:** Multi-agent orchestration framework (Python). Agents have roles, goals, tools. Tasks have descriptions, expected outputs, assigned agents. Flows provide event-driven control.

**Stars:** ~28k | **Community:** 100k+ certified developers
**Pricing:** Free OSS / Cloud: $99/mo → $120k/yr enterprise

**Task-related features:**
- Task objects with agent assignment
- Sequential and parallel task execution
- Human-in-the-loop validation
- Tracing and observability
- Task delegation between agents

**Gaps:**
- ❌ **Runtime-only** — tasks exist during execution, not as persistent state
- ❌ **No CLI interface** — Python API only
- ❌ **No verification chains** — human-in-loop is binary (approve/reject)
- ❌ **No cost tracking per task** — tracing shows token counts but not cost attribution
- ❌ **Not local-first** — requires Python runtime + cloud for enterprise features
- ❌ **Heavy** — framework, not a tool. Need to build an app to use it.

**Assessment:** CrewAI is the closest multi-agent competitor in concept, but it's a framework for building agents, not a task tracker for managing agents. You'd use CrewAI to BUILD an agent, and trak to TRACK what the agent does.

---

### 2.12 AutoGen (Microsoft)

**What it does:** Programming framework for agentic AI. Multi-agent teams, conversation patterns, AutoGen Studio (no-code). OpenTelemetry support.

**Stars:** ~53k | **Backed by:** Microsoft Research
**Pricing:** Free/OSS

**Task features:**
- Task objects passed between agents
- Team-based execution patterns
- OpenTelemetry tracing
- Human-in-the-loop

**Gaps:** Same as CrewAI — runtime orchestration, not persistent task management. No CLI, no local task state, no verification chains, no cost attribution.

---

### 2.13 LangGraph

**What it does:** Low-level agent orchestration as graphs. Stateful agents with checkpoints. Used by Klarna, Replit, Elastic.

**Stars:** ~10k+ | **Parent:** LangChain
**Pricing:** Free OSS / LangSmith (tracing): $39/seat/mo+

**Features:** State persistence via checkpoints, human-in-the-loop, streaming, subgraphs.
**Gaps:** Graph state ≠ task tracking. No CLI, no task assignment, no verification chains, no cost per task.

---

### 2.14 Mastra

**What it does:** TypeScript framework for AI apps and agents. From the team behind Gatsby. Agent Network for smart orchestration. Workflow engine with pause/resume.

**Stars:** ~19k | **Community:** 300k+ weekly npm users
**Pricing:** Free/OSS (YC W25)

**Features:** Memory management, workflow steps, nested agent streaming, tool execution.
**Gaps:** Framework-level, not a task management tool. No CLI task tracker, no verification chains, no cost tracking per task.

---

### 2.15 Prefect / Temporal

**Prefect:** Python workflow orchestration. Free hobby tier + cloud. ~20k stars. Has ControlFlow for AI workflows. Task-based but for data pipelines, not coding agents.

**Temporal:** Durable execution engine. ~13k stars. Incredible reliability. $$ cloud pricing. Multi-agent workflow support added. But designed for microservices coordination, not AI coding agents.

**Gaps (both):** Enterprise workflow engines. Massive overkill for tracking coding agent tasks. No CLI task management, no AI-native concepts, no verification chains, no local-first. Require infrastructure to run.

---

## 3. Gap Analysis — trak's Unique Moat

### What trak offers that NO competitor has (all combined):

| Capability | trak | Closest Competitor | Gap Size |
|-----------|------|-------------------|----------|
| **Multi-agent task assignment across agent stacks** | ✅ assign to Claude, Cursor, Codex, aider | Linear (agents as teammates, but cloud + single-vendor integrations) | LARGE — no one does cross-agent-stack assignment |
| **Chain of verification** (Agent 1 → Agent 2 → Human) | ✅ Built-in | No one | **UNIQUE** — this concept doesn't exist elsewhere |
| **Cost/token tracking per task per agent** | ✅ Built-in | Devin (ACUs, opaque) | LARGE — no transparent, per-task cost attribution exists |
| **CLI-first + local-first + <100ms** | ✅ SQLite | Beads (git+SQLite, but git overhead) | MEDIUM — Beads is close but slower due to git |
| **One-command agent integration** | ✅ `trak setup claude/cursor/clawdbot` | No one | **UNIQUE** — every other tool requires manual config |
| **Heat score auto-priority** | ✅ Dependencies + urgency | No one in this space | **UNIQUE** for AI task tracking |
| **Task journals** (append-only agent logs) | ✅ Built-in | Beads (audit trail) | SMALL — Beads has audit trail, but not structured journals |
| **Epics with progress bars** | ✅ Built-in | Beads (hierarchical IDs) | SMALL — Beads has hierarchy |
| **Project grouping + cross-project views** | ✅ Built-in | No CLI tool | MEDIUM |

### The Unique Moat (in one sentence):

> **trak is the only tool that lets you assign a task to Claude Code, have Cursor verify it, and track what it cost — all from the terminal in under 100ms.**

This combination of multi-agent coordination + verification chains + cost tracking + CLI speed doesn't exist anywhere. Not in task trackers. Not in agent frameworks. Not in project management SaaS.

---

## 4. Market Positioning

### 4.1 The Category trak Creates

**"AI Agent Task Infrastructure"** — or more specifically: **"The task layer for the multi-agent stack."**

Today's landscape:
- **Traditional task trackers** (Taskwarrior, Linear, GitHub Issues) → built for humans
- **Agent frameworks** (CrewAI, AutoGen, LangGraph) → built for running agents
- **Agent products** (Devin, Cursor, Claude Code) → built for using one agent

**Missing layer:** A tool that sits BETWEEN these — managing task state across agents, across tools, across sessions. That's trak.

### 4.2 Positioning Statement

> **trak: The task tracker that agents actually use.**
>
> While other tools track tasks *for* humans, trak tracks tasks *between* agents. Assign work to any AI coding agent, verify it with another, track what it costs, and approve it yourself — all from the command line, in milliseconds.

### 4.3 Analogies That Land

- "trak is to AI agents what Jira is to human developers"
- "trak is Git for agent task state"
- "The missing coordination layer between your AI agents"

### 4.4 Positioning Map

```
                    Multi-Agent ←————————————→ Single-Agent
                         |                          |
    Framework-level   CrewAI  AutoGen             Devin
    (build agents)    LangGraph  Mastra           SWE-agent
                         |                          |
                         |                          |
    Tool-level        ★ trak ★                    Beads
    (track work)         |                       Claude Tasks
                         |                          |
    Human-focused     Linear                    Taskwarrior
    (manage projects) GitHub Issues              dstask
                         |                          |
                    Multi-Agent ←————————————→ Single-Agent
```

trak occupies the **tool-level, multi-agent** quadrant — currently empty.

---

## 5. Risks

### 5.1 Existential Risks

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Anthropic builds persistent Tasks + multi-agent** | Medium (12-18 months) | HIGH | Ship fast, build community, become the standard before they do. Claude Tasks is session-scoped by design — persistence is against their architecture. |
| **Linear adds agent cost tracking + verification** | Medium (6-12 months) | HIGH | Linear will never be CLI-first or local-first. trak's moat is the developer terminal experience. |
| **GitHub builds native agent task tracking** | Medium (12-24 months) | VERY HIGH | GitHub moves slowly on new concepts. Be the tool they acquire or integrate with. |
| **Beads adds multi-agent + verification** | Low-Medium | MEDIUM | Beads' philosophy is single-agent/personal. Adding multi-agent would be a fundamental redesign. |
| **Multi-agent coding goes mainstream slowly** | Medium | HIGH | This is a market timing risk. If single-agent remains dominant for 2+ years, trak's multi-agent features are premature. |
| **AI agents get good enough to not need task tracking** | Low (3-5 years) | MEDIUM | Agents will always need coordination at scale. The better agents get, the more you need to track what they're doing. |

### 5.2 Competitive Response Scenarios

**Scenario A: Linear launches "Linear Agents 2.0" with cost tracking**
- Impact: Captures enterprise/team market
- trak's play: Double down on local-first, CLI, open source. Be the "SQLite to Linear's Postgres." Free, fast, works offline.

**Scenario B: Anthropic makes Claude Code Tasks persistent**
- Impact: Captures Claude Code-only users
- trak's play: Multi-agent is the moat. If you ONLY use Claude Code, Tasks might suffice. If you use Claude + Cursor + Codex (increasingly common), trak is essential.

**Scenario C: Beads adds cost tracking + verification**
- Impact: Direct feature parity risk
- trak's play: Ship faster, better DX, stronger community. The "replaced Beads" narrative is already building (HN: "Show HN: I replaced Beads with a faster, simpler task tracker" — 2 weeks ago).

**Scenario D: Someone forks trak's concept into a SaaS**
- Impact: Could capture team/enterprise market
- trak's play: Stay open source, build the community, own the standard. Consider offering trak Cloud later.

---

## 6. Go-to-Market Recommendation

### 6.1 Launch Strategy: "The Beads Replacement"

**Phase 1: Capture the Beads diaspora (Week 1-2)**
- Target: Developers already using Beads who hit its limitations
- Hook: "trak: Like Beads, but with multi-agent coordination and cost tracking"
- Channel: Hacker News "Show HN", r/ClaudeAI, r/LocalLLaMA
- Action: Ship `trak import beads` migration tool on day 1
- The "replaced Beads" narrative is already trending on HN — ride that wave

**Phase 2: Claude Code community (Week 2-4)**
- Target: Claude Code power users running multi-agent workflows
- Hook: `trak setup claude` — one command, done. Show the verification chain in action.
- Channel: r/ClaudeAI, Claude Code Discord, Twitter/X AI developer community
- Action: Publish "How I coordinate 3 AI agents with trak" tutorial

**Phase 3: Multi-agent developer audience (Month 2-3)**
- Target: Developers using Cursor + Claude Code + Codex together
- Hook: "Finally, one tool to track what all your agents are doing"
- Channel: Dev.to, YouTube tutorials, conference talks (AI Engineer Summit)
- Action: Publish the cost tracking feature with real numbers ("My agents spent $47 last week — here's the breakdown")

**Phase 4: Team/Enterprise (Month 4-6)**
- Target: Engineering teams with agent budgets
- Hook: "Know what your AI agents cost before the bill arrives"
- Channel: Engineering blogs, CTO newsletters, direct outreach
- Action: Add team features (shared SQLite via git, dashboards, Slack notifications)

### 6.2 The One-Line Hook

> **"Track what your AI agents do, verify their work, and know what it costs."**

### 6.3 Community-First Approach

1. **GitHub stars campaign:** Open source from day 1. MIT license. README with animated terminal GIF.
2. **Discord/community:** Start a trak Discord. Be responsive. Build in public.
3. **Integration-first:** `trak setup` for every major agent. Make it trivially easy to adopt.
4. **Content marketing:** "Multi-agent workflows" is an emerging search term. Own it with tutorials, comparisons, best practices.
5. **Migration tools:** `trak import beads`, `trak import taskwarrior`, `trak import linear`. Lower the switching cost.

### 6.4 Pricing Strategy

- **Free / MIT open source** — the CLI and local-first features must be free forever. This is how you win against Linear.
- **trak Pro** (future, Month 6+): Team sync, dashboards, Slack notifications, cost alerts. $10-15/seat/mo.
- **trak Cloud** (future, Month 12+): Hosted sync, team management, enterprise SSO. $25/seat/mo.

### 6.5 Key Metrics to Track

| Metric | Target (Month 1) | Target (Month 3) | Target (Month 6) |
|--------|------------------|-------------------|-------------------|
| GitHub stars | 500 | 2,000 | 5,000 |
| Weekly active users | 100 | 500 | 2,000 |
| Agent integrations | 3 (Claude, Cursor, Clawdbot) | 5 (+Codex, aider) | 8+ |
| Beads migrations | 50 | 200 | 500 |
| Discord members | 50 | 300 | 1,000 |

---

## 7. Key Takeaways

1. **trak has a genuine blue ocean** — no tool combines multi-agent coordination + verification chains + cost tracking + CLI-first + local-first.

2. **The biggest risk is timing** — if multi-agent workflows don't become mainstream in 2026, trak is early. But being early in a fast-moving space is better than being late.

3. **Beads is the primary competitor** but has fundamental architectural limitations for multi-agent use. The "Beads replacement" narrative is trak's fastest path to early adopters.

4. **Linear is the most dangerous long-term threat** — they have the users, the brand, and the agent API. But they'll never be local-first or CLI-first.

5. **Claude Code Tasks is the most dangerous short-term threat** — if Anthropic makes Tasks persistent and cross-session, many Claude-only users won't need trak. Multi-agent support is the moat.

6. **Ship fast, build community, own the category.** First mover advantage in "AI agent task infrastructure" is worth more than a perfect product.

---

*This analysis should be reviewed quarterly as the AI agent landscape evolves rapidly.*
