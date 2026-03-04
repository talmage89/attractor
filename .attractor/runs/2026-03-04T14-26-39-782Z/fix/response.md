## fix — 2026-03-04T15:16:49.650Z

Fixed both bugs and pushed. Here's a summary:

## BUG-A01 Fix — Template edge routing on `executeDynamic` failure

**Root cause**: When `executeDynamic()` returned `{status: "fail"}`, the runner called `selectEdge` which picked the unconditional template edge (`fanout → proc`), causing `proc` to run and the pipeline to report success.

**Fix**: 
1. `parallel.ts`: All infrastructure fail returns in `executeDynamic()` now include `suggestedNextIds: []` (explicit empty array)
2. `runner.ts`: Added early-exit before `selectEdge`: if `outcome.suggestedNextIds` is defined and empty, stop traversal and propagate fail status

## BUG-A02 Fix — FanInHandler fails on empty array

**Root cause**: `FanInHandler` treated `parallel.results = "[]"` (0 branches ran) the same as "no results set", returning fail.

**Fix**: `fan-in.ts`: Changed `outcomes.length === 0` to return `success` — 0 branches = 0 failures.

**Result**: 479 tests passing (440 attractor + 39 attractor-lsp), +3 from 476.