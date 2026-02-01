# Changelog

All notable changes to trak will be documented in this file.

## [0.1.0] - 2026-02-01

### Added

- Core task management: `create`, `list`, `show`, `status`, `close`
- Board view grouped by project with status colors
- Heat scoring — auto-priority based on fan-out, age, recency, and manual priority
- Task journal — append-only log per task with author tracking
- Dependency management — `dep add`, `dep rm`, `ready` shows only unblocked tasks
- Cost tracking by project
- Multi-project support
- Reports: `digest` (24h changelog), `stale` (inactive tasks), `heat` (priority map)
- Import/export: JSON and beads JSONL format
- SQLite-backed, local-first, zero network calls
