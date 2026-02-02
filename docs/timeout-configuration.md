# Timeout Configuration

trak supports configurable agent timeouts at multiple levels. When an agent runs a task (via `trak polecat` or `trak run`), it self-destructs after the configured timeout to prevent runaway processes.

## Resolution Priority

Timeouts are resolved in this order (first match wins):

1. **CLI flag** (`--timeout`) — highest priority
2. **Per-task** (`timeout_seconds` column) — set at creation
3. **Per-project** (`project.<name>.timeout` config)
4. **Timeout profile** (matched by task tags via `timeout.profile.<tag>` config)
5. **Global default** (`agent.timeout` config)
6. **Built-in default** — 900 seconds (15 minutes)

## Setting Timeouts

### Per-Task (at creation)

```bash
# Set timeout when creating a task
trak create "Quick lint fix" --timeout 5m
trak create "Full build + deploy" --timeout 1h
trak create "Database migration" --timeout 30m

# Plain seconds also work
trak create "Fast task" --timeout 120
```

### CLI Override (at runtime)

```bash
# Override timeout when running agents
trak run --timeout 45m
trak polecat trak-abc123 --timeout 2h
```

### Per-Project Default

```bash
# Set a default timeout for all tasks in a project
trak config set project.peptok.timeout 1800    # 30 minutes (in seconds)
trak config set project.forge.timeout 3600     # 1 hour
```

New tasks created with `--project peptok` will inherit this timeout unless overridden.

### Timeout Profiles (by tag)

```bash
# Define timeout profiles matched by task tags
trak config set timeout.profile.quick 300       # 5 min for "quick" tagged tasks
trak config set timeout.profile.build 3600      # 1h for "build" tasks  
trak config set timeout.profile.deploy 1800     # 30m for "deploy" tasks
trak config set timeout.profile.migration 7200  # 2h for "migration" tasks

# Tasks tagged appropriately get the profile timeout
trak create "Lint and format" --tags quick
trak create "Full CI pipeline" --tags build,deploy
```

### Global Default

```bash
# Change the global default timeout (applies when nothing else matches)
trak config set agent.timeout 1200   # 20 minutes
```

## Duration Format

The `--timeout` flag and config values accept:

| Format | Example | Meaning |
|--------|---------|---------|
| Plain number | `300` | 300 seconds |
| Seconds | `300s` | 300 seconds |
| Minutes | `30m` | 30 minutes |
| Hours | `1h` | 1 hour |
| Combined | `1h30m` | 90 minutes |

## Viewing Timeouts

```bash
# Show task details including timeout
trak show trak-abc123

# For auto tasks, shows effective timeout (per-task or default)
# For tasks with explicit timeout: "Timeout: 30m (per-task)"
# For auto tasks using defaults: "Timeout: 15m (default)"
```

## Migration from Hardcoded Timeouts

Previously, all agents used a hardcoded 5-minute timeout. The new system defaults to **15 minutes** and supports full customization.

### Migration Steps

1. **No action required** — existing tasks work with the 15-minute default
2. **Optionally set project defaults:**
   ```bash
   trak config set project.myproject.timeout 1800
   ```
3. **Optionally define profiles for common patterns:**
   ```bash
   trak config set timeout.profile.quick 300
   trak config set timeout.profile.complex 3600
   ```
4. **Verify current config:**
   ```bash
   trak config list
   ```

## Examples

```bash
# Quick task — 5 minute timeout
trak create "Fix typo in README" --timeout 5m --auto --project docs

# Complex build — 1 hour timeout
trak create "Migrate database schema" --timeout 1h --auto --project infra

# Use project default (inherits project.peptok.timeout)
trak create "Add new API endpoint" --project peptok --auto

# Override at dispatch time
trak run --project peptok --timeout 45m

# Tag-based profile
trak create "Deploy to production" --tags deploy --auto
# → matches timeout.profile.deploy if configured
```
