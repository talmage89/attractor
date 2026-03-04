# Implementation Plan

Phases adopted from spec's declared implementation order.

---

## Phase 1: Parallel flow visibility in default CLI output

**Goal**: Make parallel events visible in default (non-verbose) CLI output, and improve verbose `cc_event` logging.

**Files to modify**:
- `packages/attractor/src/cli.ts`

**Changes**:
1. Add `formatEvent()` cases for three parallel event kinds:
   - `parallel_started`: `[ts] ⊞ nodeId → parallel (N branches)`
   - `parallel_branch_completed`: `[ts]   ├ branchNodeId → status (branch N/total)`
   - `parallel_completed`: `[ts] ⊞ nodeId → done (N succeeded, M failed)`
2. Add all three event kinds to the default output filter in `onEvent` (currently lines 123–137) so they display without `--verbose`.
3. Improve `cc_event` verbose log lines: inspect the `SDKMessage` type from `@anthropic-ai/claude-agent-sdk` and surface useful fields (message type, tool use, token counts, model, etc.) in single-line format.

**Acceptance criteria**:
- Parallel events appear in non-verbose output with the specified format.
- `cc_event` in verbose mode shows meaningful payload details instead of bare `[cc_event]`.
- Existing tests pass (`pnpm test` in `packages/attractor`).

---

## Phase 2: Formatter — preserve up to one blank line of user whitespace

**Goal**: Preserve intentional blank lines within formatter sections instead of stripping all whitespace.

**Files to modify**:
- `packages/attractor-lsp/src/formatter.ts`

**Changes**:
1. Add `startLine: number` and `endLine: number` to each `CstStmt` variant.
2. Update `CstParser` to record `this.peek().line` at statement start and the line of the last consumed token at statement end.
3. Update `emitBody`: within each section, when joining consecutive statements, check if `stmt[i+1].startLine - stmt[i].endLine >= 2`. If so, emit `"\n\n"` (one blank line); otherwise emit `"\n"`. Multiple consecutive blank lines collapse to one.

**Acceptance criteria**:
- Formatting a `.dag` file with intentional blank lines within node/edge sections preserves exactly one blank line between those statements.
- Multiple consecutive blank lines collapse to one.
- Formatter still reorders by kind (graph attrs → defaults → nodes → edges → subgraphs).
- Existing tests pass (`pnpm test` in `packages/attractor-lsp`).

**Dependencies**: None.

---

## Phase 3: Formatter — vertical alignment

**Goal**: Align node IDs, edge chains, graph attributes, and defaults within alignment blocks.

**Files to modify**:
- `packages/attractor-lsp/src/formatter.ts`

**Changes**:
1. **Node declaration alignment**: Compute `maxIdLen` across alignment blocks (consecutive same-section statements with no blank line between them). Pad each ID to `maxIdLen` before `[attrs]`. Within `[attrs]`, align `=` signs by computing `maxKeyLen` per attribute position.
2. **Edge chain alignment**: For each arrow column `c`, compute `maxNodeLen[c]` across the block. Pad node IDs to align `->` arrows. Align `[` bracket after chain. Align `=` within attrs.
3. **Graph attribute alignment**: Compute `maxKeyLen`, pad keys so `=` signs align.
4. **Defaults alignment**: Align the `[` bracket across the block.

**Acceptance criteria**:
- Node declarations in alignment blocks have padded IDs and aligned `=` signs.
- Edge chains have aligned `->` arrows and aligned `[` brackets.
- Graph attributes have aligned `=` signs.
- Defaults statements have aligned `[` brackets.
- Alignment only applies within blocks (broken by blank lines).
- Existing tests pass (`pnpm test` in `packages/attractor-lsp`).

**Dependencies**: Phase 2 (needs `startLine`/`endLine` for alignment block detection).

---

## Phase 4: Dynamic runtime parallelization

**Goal**: Support `foreach_key` on parallel nodes for dynamic branch creation from a context array.

**Files to modify**:
- `packages/attractor/src/handlers/parallel.ts`
- `packages/attractor/src/validation/rules.ts`

**Changes**:
1. Add `executeDynamic()` method to `ParallelHandler`:
   - Detect `foreach_key` in `node.raw` → enter dynamic mode.
   - Require exactly one outgoing edge (template branch). Error if more.
   - Walk template sub-chain from edge target to fan-in/terminal node.
   - Parse list via `JSON.parse(context.get(foreachKey))` — must be an array.
   - For each item, clone template nodes with suffixed IDs (`{nodeId}__dyn_{i}`), clone internal edges, add fanout→clone start and clone end→fan-in edges.
   - Set `context.{item_key}` (default: `"item"`) per branch.
   - Execute using existing worker pool pattern.
   - Aggregate results identically to static mode.
   - Clean up synthetic nodes/edges after execution.
2. Add validation rules in `rules.ts`:
   - Warn if a node has `foreach_key` but not shape `component`.
   - Warn if a `foreach_key` node has != 1 outgoing edge.

**Acceptance criteria**:
- A DAG with `foreach_key` spawns one branch per array item.
- `$item` (or custom `item_key`) is available in branch context.
- Fan-in aggregates results like static parallel mode.
- Synthetic nodes/edges are cleaned up after execution.
- Validation warnings fire for misconfigured `foreach_key` nodes.
- Existing tests pass (`pnpm test` in `packages/attractor`).

**Dependencies**: None (independent of phases 1–3).
