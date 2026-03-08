## test_a — 2026-03-08T17:15:35.490Z

Testing complete. Here's a summary of what I found:

## Results

**Baseline**: 583 tests pass, build and typecheck clean. ✓

### BUG-001 (Real bug): Watchdog doesn't kill tool nodes

- **What**: `ToolHandler` ignores `config.abortSignal`. When watchdog fires for a tool node, it emits a misleading "Watchdog: node X idle — **aborting**" warning but the shell command keeps running.
- **Reproduction**: DAG with `watchdog_idle = "150"` and a tool node running `sleep 0.4` — warning at 155ms, tool completes at 409ms.
- **Root cause**: `runShellCommand()` has no abort signal parameter; the fix is similar to how CodergenHandler plumbs `config.abortSignal` into `runCC`.

### OBSERVATION-1: Dead code in `wrappedOnEvent`

The `stage_started` case in `wrappedOnEvent` is never reached — the runner emits `stage_started` via `emit(config, ...)` (bypasses `wrappedOnEvent`). This compounds BUG-001: tool nodes produce no events through `wrappedOnEvent` so they appear perpetually idle.

### OBSERVATION-2: Invalid duration string silently disables watchdog

`watchdog_idle = "abc"` → `parseTimeout` returns null → watchdog not activated → no warning/error. The validation rule only catches non-positive values, not unparseable ones.

### Everything else works correctly

All watchdog parsing, validation rules, abort signal integration, parallel branch independence, runner lifecycle, and break-on-result behavior passed all tests.