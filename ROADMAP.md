# trak Roadmap

## Vision
Every task, every agent spawn, every piece of work is automatically tracked. Zero manual entry. trak is invisible infrastructure.

## Phase 1: Core CLI (v0.1) — IN PROGRESS
- [x] SQLite schema (tasks, deps, logs)
- [x] create, list, ready, board, show, status, close
- [x] dep add/rm
- [x] log entries
- [x] heat score (auto-priority)
- [x] cost tracking
- [x] digest, stale commands
- [x] export/import JSON
- [ ] `trak import-beads` — migrate from beads JSONL format

## Phase 2: Auto-Tracking Hooks (v0.2)
- [ ] `trak hook spawn` — auto-create task when agent spawns
- [ ] `trak hook complete` — auto-close + log when agent finishes
- [ ] `trak hook abort` — mark blocked when agent aborted
- [ ] `trak hook cost` — record tokens/cost from session stats
- [ ] Conversation detection — when user says "do X", auto-create before starting
- [ ] Agent session linking — task knows which session worked on it

## Phase 3: Clawdbot Integration (v0.3)
- [ ] Clawdbot plugin/hook that calls trak on session lifecycle events
- [ ] sessions_spawn → trak create (automatic)
- [ ] session complete → trak close + log summary (automatic)
- [ ] session abort → trak status blocked (automatic)
- [ ] Heartbeat integration — update task progress during heartbeats
- [ ] `/trak` command in Telegram — show board inline

## Phase 4: Replace Beads (v1.0)
- [ ] Import all existing beads (bd export → trak import)
- [ ] Verify feature parity
- [ ] Remove bd dependency
- [ ] trak is the single source of truth
- [ ] Publish to npm as `trak`

## Performance Targets
- `trak list` < 50ms
- `trak create` < 30ms  
- `trak board` < 100ms
- SQLite = instant. No network calls. No API. Local-first.

## Philosophy
- Zero friction > feature completeness
- Auto-track > manual entry
- Speed > pretty output
- Local-first > cloud-dependent
- AI-native > human-adapted
