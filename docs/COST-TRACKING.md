# Cost Tracking Architecture

## Overview

Trak includes built-in cost tracking for AI agent task execution. Every API call, token usage, and dollar cost can be tracked per-task, enabling cost accountability, budget enforcement, and optimization.

## Data Model

### Task-Level Aggregates (tasks table)

Every task carries aggregate cost fields:

| Column | Type | Description |
|--------|------|-------------|
| `cost_usd` | REAL | Total accumulated cost in USD |
| `tokens_used` | INTEGER | Total tokens (in + out) |
| `tokens_in` | INTEGER | Input/prompt tokens |
| `tokens_out` | INTEGER | Output/completion tokens |
| `model_used` | TEXT | Last model used |
| `duration_seconds` | REAL | Total execution time |
| `budget_usd` | REAL | Optional budget ceiling |

### Cost Events Table (cost_events)

For granular per-call tracking:

| Column | Type | Description |
|--------|------|-------------|
| `task_id` | TEXT | Parent task |
| `timestamp` | TEXT | When the API call happened |
| `model` | TEXT | Model used |
| `tokens_in` | INTEGER | Input tokens for this call |
| `tokens_out` | INTEGER | Output tokens for this call |
| `cost_usd` | REAL | Cost for this call |
| `duration_seconds` | REAL | Call duration |
| `agent` | TEXT | Agent that made the call |
| `operation` | TEXT | Type: chat, completion, embedding, tool_call |
| `metadata` | TEXT | JSON blob for extra data |

## Recording Costs

### Via CLI (simple)

```bash
# Log cost with a journal entry
trak log <task-id> "Completed analysis" --cost 0.15 --tokens-in 5000 --tokens-out 1200 --model claude-sonnet-4

# Log cost when closing
trak close <task-id> --cost 0.50 --tokens 15000 --model gpt-4o --verify
```

### Via Cost Engine API (programmatic)

```typescript
import { recordCostEvent } from './cost-engine.js';

// Records event AND updates task aggregates
// Auto-calculates cost if model is known
const event = recordCostEvent({
  taskId: 'trak-abc123',
  model: 'claude-sonnet-4',
  tokensIn: 5000,
  tokensOut: 1200,
  agent: 'worker-1',
  operation: 'chat',
});
// event.cost_usd is auto-calculated from model pricing
```

### Auto-Cost Calculation

When you provide a model name and token counts but no explicit cost, the engine auto-calculates using built-in pricing tables:

```bash
trak log <id> "API call" --tokens-in 10000 --tokens-out 2000 --model claude-opus-4-5
# Auto-calculates: (10000/1M * $15) + (2000/1M * $75) = $0.15 + $0.15 = $0.30
```

## Budget System

### Setting Budgets

```bash
# At creation time
trak create "Expensive analysis" --budget 5.00

# After creation
trak cost budget <task-id> --set 5.00
```

### Budget Alerts

The system automatically logs warnings:
- **80% threshold**: Warning logged to task journal (once)
- **100% threshold**: Exceeded alert logged on every cost event

### Budget Checking (programmatic)

```typescript
import { isBudgetAvailable, getBudgetStatus } from './cost-engine.js';

// Gate expensive operations
if (!isBudgetAvailable(taskId)) {
  console.log('Budget exceeded, aborting');
  return;
}

// Detailed status
const status = getBudgetStatus(db, taskId);
// status.status: 'ok' | 'warning' | 'exceeded' | 'no-budget'
// status.percentUsed, status.remainingUsd, etc.
```

## CLI Commands

### Overview Report

```bash
trak cost                  # All-time overview
trak cost --week           # Last 7 days
trak cost --month          # Last 30 days  
trak cost -b myproject     # Filter by project
trak cost --agent worker1  # Filter by agent
```

### Per-Task Detail

```bash
trak cost <task-id>        # Detailed cost for one task
```

### Subcommands

```bash
trak cost trend            # Daily cost trend (30 days)
trak cost trend -d 7       # 7-day trend
trak cost models           # Cost breakdown by AI model
trak cost budget           # All budgets overview
trak cost budget <id>      # Budget for one task
trak cost budget <id> --set 10.00  # Set budget
trak cost top              # Top 10 most expensive tasks
trak cost top -n 20        # Top 20
trak cost export           # Export as JSON
trak cost export --csv     # Export as CSV
trak cost prices           # Show model pricing reference
```

## Model Pricing

Built-in pricing for major models (USD per 1M tokens):

| Model | Input | Output |
|-------|-------|--------|
| claude-opus-4-5 | $15.00 | $75.00 |
| claude-sonnet-4 | $3.00 | $15.00 |
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |
| gemini-2.5-pro | $1.25 | $10.00 |

Full list: `trak cost prices`

Pricing is fuzzy-matched — `anthropic/claude-sonnet-4` matches `claude-sonnet-4`.

To update prices, edit `MODEL_PRICES` in `src/cost-engine.ts`.

## Analytics

### Cost Summary

```typescript
import { getCostSummary } from './cost-engine.js';

const summary = getCostSummary({
  project: 'myproject',
  since: '2025-01-01',
  agent: 'worker-1',
});
// summary.totalCost, summary.avgCostPerTask, summary.models (Map)
```

### Daily Trends

```typescript
import { getDailyTrend } from './cost-engine.js';

const trend = getDailyTrend({ project: 'myproject', days: 30 });
// [{ date: '2025-07-01', cost: 1.50, tokens: 50000, tasks: 5 }, ...]
```

### Model Breakdown

```typescript
import { getModelBreakdown } from './cost-engine.js';

const models = getModelBreakdown({ project: 'myproject' });
// [{ model: 'claude-opus-4-5', cost: 10.50, tokensIn: ..., tasks: 3 }, ...]
```

## Integration with Task Lifecycle

1. **Create** → Optional `--budget` sets cost ceiling
2. **WIP** → Agent records cost events as it works
3. **Close** → Final cost summary logged automatically
4. **Report** → `trak cost` shows aggregated analytics

Budget alerts fire automatically when costs are recorded, no manual checking needed.
