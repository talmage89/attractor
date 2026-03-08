# Watchdog Design

## Declaration

Graph-level attributes (opt-in, no defaults):

```dot
graph [watchdog_idle = "5m", watchdog_poll = "30s"]
```

Parsed via `parseDurationToMs` in `applyGraphAttributeKV`. Added to `GraphAttributes`:

```typescript
// model/graph.ts
export interface GraphAttributes {
  // ... existing fields ...
  watchdogIdle: number | null;   // ms, null = disabled
  watchdogPoll: number | null;   // ms, null = use default 30s when idle is set
}
```

## Idle Detection Mechanism

Use the existing `cc_event` stream as a heartbeat. Every SDK message (API calls, tool uses, text output) fires a `cc_event` with `nodeId`. A stalled node stops producing these entirely.

Track `lastActivityTimestamp` per active node:

```typescript
interface WatchdogState {
  lastActivity: Map<string, number>;  // nodeId → timestamp of last cc_event
  abortControllers: Map<string, AbortController>;
  timer: ReturnType<typeof setInterval> | null;
}
```

## Integration Points

### runner.ts — owns the watchdog lifecycle

Start the interval after `pipeline_started`, clear at `pipeline_completed`.

```typescript
// After pipeline_started event
let watchdog: WatchdogState | null = null;
const idleMs = graph.attributes.watchdogIdle;
const pollMs = graph.attributes.watchdogPoll ?? 30_000;

if (idleMs !== null && idleMs > 0) {
  watchdog = {
    lastActivity: new Map(),
    abortControllers: new Map(),
    timer: null,
  };

  watchdog.timer = setInterval(() => {
    const now = Date.now();
    for (const [nodeId, lastTs] of watchdog!.lastActivity) {
      if (now - lastTs > idleMs) {
        watchdog!.abortControllers.get(nodeId)?.abort();
        watchdog!.lastActivity.delete(nodeId);
        emit(config, {
          kind: "warning",
          nodeId,
          message: `Watchdog: node idle for ${Math.round((now - lastTs) / 1000)}s (limit: ${idleMs / 1000}s)`,
          timestamp: now,
        });
      }
    }
  }, pollMs);
}

// At pipeline_completed / break loop:
if (watchdog?.timer) clearInterval(watchdog.timer);
```

### Event callback — updates last activity

In the `wrappedOnEvent` function (already exists in runner.ts):

```typescript
function wrappedOnEvent(event: PipelineEvent): void {
  // Update watchdog activity tracking
  if (watchdog && (event.kind === "cc_event" || event.kind === "stage_started")) {
    const nodeId = "nodeId" in event ? event.nodeId : undefined;
    if (nodeId) watchdog.lastActivity.set(nodeId, Date.now());
  }

  // ... existing stage_retrying checkpoint logic ...
  config.onEvent?.(event);
}
```

### AbortController threading

To actually kill a stalled CC process, thread an AbortController per-node through RunConfig:

1. Add `abortSignal?: AbortSignal` to `RunConfig`
2. Before each node execution in the traversal loop, create an AbortController, register it with the watchdog, and pass its signal through nodeConfig
3. `CodergenHandler` combines the watchdog signal with its own timeout-based AbortController (use `AbortSignal.any([...])` if available, or wire manually)
4. On watchdog abort, `runCC`'s AbortController fires → SDK generator is cancelled → handler returns with fail

```typescript
// In runner.ts traversal loop, before executeWithRetry:
let nodeAbort: AbortController | undefined;
if (watchdog) {
  nodeAbort = new AbortController();
  watchdog.abortControllers.set(currentNode.id, nodeAbort);
  watchdog.lastActivity.set(currentNode.id, Date.now());
}

const nodeConfig: RunConfig = {
  ...config,
  onEvent: wrappedOnEvent,
  abortSignal: nodeAbort?.signal,
  // ... existing fields ...
};

// After execution completes:
if (watchdog) {
  watchdog.lastActivity.delete(currentNode.id);
  watchdog.abortControllers.delete(currentNode.id);
}
```

### CodergenHandler — respects abort signal

```typescript
// In codergen.ts execute(), when building the AbortController:
const abortController = new AbortController();

// Combine with watchdog signal if present
if (config.abortSignal) {
  config.abortSignal.addEventListener("abort", () => abortController.abort(), { once: true });
}

// Existing timeout logic unchanged — both timeout and watchdog can trigger abort
```

### ParallelHandler — branches get individual watchdog tracking

No special work needed. Parallel branches already call `config.onEvent` with branch node IDs via `executeBranch` → `executeWithRetry` → handler → `cc_event`. The watchdog in runner.ts sees these events and tracks each branch node independently.

For abort to work in parallel branches, `ParallelHandler` must thread the `abortSignal` through to branch execution. Each branch should get its own AbortController registered with the watchdog (the branch node ID is unique).

## Validation

Add a rule to `rules.ts`:

- `watchdog_poll` without `watchdog_idle` → `[warning]` "watchdog_poll has no effect without watchdog_idle"
- `watchdog_idle` < `watchdog_poll` → `[warning]` "watchdog_idle shorter than poll interval; idle nodes may not be detected promptly"
- Non-positive values → `[error]` "watchdog_idle must be a positive duration"

## What This Catches

The watchdog detects a specific failure mode the other timeout layers can miss: the CC subprocess is alive and has active connections, but is not producing any SDK events. In the test_d incident:

- status.json written at 06:49:54
- Last cc_event shortly before that (final tool_use message)
- With `watchdog_idle = "5m"`, the watchdog would have detected zero cc_events from test_d by ~06:55 and aborted the stalled process

## Interaction With Other Timeout Layers

```
default_timeout (Layer 1):  Caps individual CC API calls
branch_timeout  (Layer 2):  Caps entire parallel branches end-to-end
watchdog_idle   (Layer 3):  Detects alive-but-stalled processes producing no events
```

The watchdog is complementary, not redundant. A node with `timeout = "30m"` could stall at 29m with no events — the watchdog catches this at the 5m idle mark rather than waiting for the full 30m timeout.
