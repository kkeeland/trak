# Workspace Locking Architecture

## Overview

trak's workspace locking system prevents multiple agents from modifying the same files simultaneously. It provides **conflict detection**, **lock queuing**, **emergency override**, and **audit trails** — all file-based for zero external dependencies.

## Problem

When multiple AI agents work concurrently:
- Two agents edit the same file → git merge conflicts
- Simultaneous writes → data corruption
- No coordination → wasted compute on conflicting work

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  trak assign │────▶│ Conflict     │────▶│  Warn/Block │
│  trak claim  │     │ Detection    │     │  or Allow   │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │ Lock Store  │
                    │ (.trak/locks/)
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        *.lock files  *.queue files  audit.jsonl
```

## Lock Granularity

### Repo-Level Locks (Coarse)

Lock an entire repository. Simple, safe, default.

```bash
trak lock acquire /opt/projects/api task-123 --agent claude-1
```

Lock file: `.trak/locks/<hash>.lock`

### File-Level Locks (Fine-Grained)

Lock specific file patterns within a repo. Allows parallel work on non-overlapping files.

```bash
trak lock acquire /opt/projects/api task-123 --agent claude-1 --files "src/db.ts,src/auth/"
```

File patterns support:
- **Exact files**: `src/db.ts`
- **Directories**: `src/commands/` (trailing slash)
- **Globs**: `src/*.ts`

### Conflict Resolution

When files overlap, the second agent is blocked:

```
Agent 1 locks: src/db.ts, src/auth/
Agent 2 wants: src/auth/login.ts    → BLOCKED (directory overlap)
Agent 2 wants: src/cli.ts           → ALLOWED (no overlap)
```

## Lock Lifecycle

```
 ┌──────┐     ┌──────┐     ┌─────────┐
 │ FREE │────▶│ HELD │────▶│RELEASED │
 └──────┘     └──┬───┘     └─────────┘
                 │
           ┌─────┼─────┐
           ▼     ▼     ▼
        EXPIRED BROKEN RENEWED
```

- **Acquire**: Agent claims a lock. Fails if conflict exists.
- **Release**: Normal unlock when work is done.
- **Expire**: Auto-cleanup after timeout (default: 30 min).
- **Break**: Emergency force-release with audit trail.
- **Renew**: Heartbeat to extend timeout.

## Queue System

When a lock is held, other tasks can **queue** instead of failing:

```bash
trak lock acquire /opt/projects/api task-456 --agent claude-2 --queue
# → Queued at position #1
```

Queue features:
- **Priority ordering**: P0 tasks jump ahead of P2 tasks
- **No double-enqueue**: Same task can't be queued twice
- **Auto-dequeue on acquire**: Acquiring a lock removes from queue

Queue file: `.trak/locks/<hash>.queue`

## Emergency Lock Breaking

When a lock is stuck (agent crashed, PID dead, timeout not yet reached):

```bash
trak lock break /opt/projects/api --agent admin --reason "agent unresponsive"
# ⚡ Lock BROKEN on /opt/projects/api
#   Was held by: task-123 (claude-1)
#   Broken by: admin
#   Reason: agent unresponsive
```

All breaks are recorded in `.trak/locks/audit.jsonl`.

## Auto-Cleanup

Locks are automatically cleaned up when:
1. **Timeout expires** (default 30 min, configurable)
2. **PID is dead** (process that created lock no longer running)
3. **Lock file is corrupt** (invalid JSON)

## CLI Commands

| Command | Description |
|---------|-------------|
| `trak locks` | Show all active locks and queues |
| `trak lock acquire <repo> <task> [--files] [--queue]` | Acquire a lock |
| `trak lock release <repo>` | Release a lock |
| `trak lock break <repo> [--reason]` | Emergency force-release |
| `trak lock check <repo> <task> [--files]` | Check for conflicts (dry-run) |
| `trak lock renew <repo> <task>` | Extend lock timeout |
| `trak lock audit` | Show audit trail |
| `trak lock queue` | Show all lock queues |
| `trak unlock <repo>` | Alias for `lock release` |

## Integration with Task Assignment

When `trak assign` or `trak claim` is used, the system checks for workspace conflicts:

- **Default mode**: Warns about conflicts but allows assignment
- **Enforce mode**: Blocks conflicting assignments

```bash
# Enable enforcement
trak config set lock.enforce true

# Now conflicting assignments are blocked
trak assign task-456 agent-2
# ✗ Workspace conflict! Project "api" is locked by:
#   Task: task-123  Agent: agent-1  Expires: 25m
```

## Lock Status in Task Display

`trak show <task>` displays lock information:

```
trak-abc123 🔨 WIP
Build auth system
────────────────────────────────────────────────
  Lock:      🔒 api (15m remaining)
  Queued:    ⏳ #2 for frontend
```

## Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `lock.timeout` | `30` | Lock timeout in minutes |
| `lock.enforce` | `false` | Block conflicting assignments (true/false/"block") |

```bash
trak config set lock.timeout 60      # 1 hour timeout
trak config set lock.enforce true    # Block conflicts
```

## File Layout

```
.trak/
  locks/
    <hash1>.lock      # Lock file (JSON)
    <hash1>.queue     # Queue file (JSON array)
    <hash2>.lock
    audit.jsonl       # Append-only audit log
```

## Design Decisions

1. **File-based, not DB-backed**: Locks use the filesystem for atomic operations and cross-process visibility. No SQLite locking issues.

2. **PID + timeout dual safety**: Even if PID check fails (remote agents), timeout ensures eventual cleanup.

3. **Audit trail is append-only**: JSONL format, never modified, survives lock breaks.

4. **Queue is priority-sorted**: P0 tasks always get locks before P2 tasks.

5. **Backward-compatible**: Old lock files (without `files`/`lockType` fields) are auto-normalized.
