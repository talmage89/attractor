## implement — 2026-03-04T14:29:59.019Z

Phases 1–3 complete. Here's a summary of what was done:

**Phase 1 — Parallel flow visibility + cc_event logging** (`packages/attractor`):
- Added `totalBranches` to the `parallel_branch_completed` event
- Added `formatEvent()` cases for all 3 parallel event kinds with the spec-format (⊞ symbol, branch N/total, succeeded/failed counts)
- Added parallel events to the default (non-verbose) filter
- Added `cc_event` verbose formatting that surfaces type, model, tokens, duration, and cost

**Phase 2 — Formatter blank-line preservation** (`packages/attractor-lsp`):
- Added `startLine`/`endLine` to all CST node types
- CstParser now tracks the last consumed token line and injects line numbers via a wrapper
- `hadBlankLineBetween()` ensures only truly adjacent statements with ≥2-line gap get a blank line

**Phase 3 — Formatter vertical alignment** (`packages/attractor-lsp`):
- `splitBlocks()` splits sections at blank-line boundaries into alignment blocks
- Within each block: node IDs padded to `maxIdLen`, `=` signs aligned by attribute position, edge `->` arrows aligned per column, `[` brackets aligned by max chain width

**Remaining**: Phase 4 (dynamic runtime parallelization with `foreach_key`) is the largest phase and will be implemented in the next session.

---

## implement — 2026-03-04T14:50:56.432Z

Phase 4 is complete. Here's a summary of what was implemented:

**Dynamic runtime parallelization (`foreach_key`)**

- `parallel.ts`: Added `collectTemplateChain()` helper that walks forward from a template start node collecting IDs until hitting a fan-in or terminal. Added `executeDynamic()` private method that:
  1. Validates exactly 1 outgoing edge (template branch)
  2. Parses a JSON array from context via `foreach_key`
  3. Clones template nodes/edges with `__dyn_{i}` suffixed IDs per item
  4. Sets `item_key` (default: `"item"`) per branch's cloned context
  5. Runs all branches via the existing worker pool pattern respecting `max_parallel`
  6. Aggregates results identically to static mode
  7. Cleans up all synthetic nodes/edges from the graph after execution

- `rules.ts`: Added `foreachKeyValidRule` that warns if a `foreach_key` node is not `shape=component` or has ≠ 1 outgoing edge.

**Tests**: 11 new tests (8 dynamic parallel + 3 validation). All 476 tests pass.