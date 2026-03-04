# Attractor — Iteration Spec

## Changes

### 1. Parallel flow visibility in default CLI output

**Package**: `attractor`
**File**: `packages/attractor/src/cli.ts`

**Current behavior**: `parallel_started`, `parallel_branch_completed`, and `parallel_completed` events fall through to the generic `[kind]` handler in `formatEvent`. They are also excluded from default (non-verbose) output.

**New behavior**: Add formatting cases in `formatEvent()` for the three parallel event kinds:

- `parallel_started`: `[ts] ⊞ nodeId → parallel (N branches)`
- `parallel_branch_completed`: `[ts]   ├ branchNodeId → status (branch N/total)`
- `parallel_completed`: `[ts] ⊞ nodeId → done (N succeeded, M failed)`

Add all three event kinds to the default output filter in `onEvent` (lines 123–137) so they display without `--verbose`.

---

### 2. Dynamic runtime parallelization

**Package**: `attractor`
**Files**:
- `packages/attractor/src/handlers/parallel.ts`
- `packages/attractor/src/validation/rules.ts`

#### DAG syntax

```dot
test_fanout [shape = "component", foreach_key = "test_files", item_key = "test_file", max_parallel = "5"]
run_test [shape = "box", prompt = "Run test: $item"]
test_merge [shape = "tripleoctagon"]

test_fanout -> run_test -> test_merge
```

- `foreach_key` — context key containing a JSON array. Its presence on a `component` node triggers dynamic mode instead of static fanout.
- `item_key` — context key set per-branch to the current array element (default: `"item"`).

#### Changes to `parallel.ts`

Add `executeDynamic()` method to `ParallelHandler`:

1. Read `foreach_key` from `node.raw`. If present, enter dynamic mode.
2. Require exactly one outgoing edge (the template branch). Error if more.
3. Collect the template sub-chain: walk from the edge target forward, collecting node IDs until hitting a fan-in or terminal node.
4. Read the list: `JSON.parse(context.get(foreachKey))` — must be an array.
5. For each item, clone template nodes with suffixed IDs (`{nodeId}__dyn_{i}`), clone internal edges, add edge from parallel node to cloned chain start, add edge from cloned chain end to fan-in. Insert all into `graph.nodes` and `graph.edges`.
6. For each branch, clone context, set `item_key` to the current item value.
7. Execute all cloned branches using the existing worker pool pattern.
8. Aggregate results identically to static mode.
9. After execution, remove synthetic nodes/edges from the graph (clean up).

#### Changes to `rules.ts`

Add a validation rule: if a node has `foreach_key` in `raw`, warn if it doesn't have shape `component`, warn if it has != 1 outgoing edge.

#### Prompt interpolation

Set `context.{item_key}` on each branch's cloned context so the LLM sees the value naturally. The codergen handler already receives the full context.

---

### 3. Formatter: preserve up to one blank line of user whitespace

**Package**: `attractor-lsp`
**File**: `packages/attractor-lsp/src/formatter.ts`

**Current behavior**: The formatter strips all user whitespace and re-sections statements by kind, joining sections with exactly one blank line and items within sections with no blank lines.

**New behavior**: Continue reordering by kind (graph attrs → graph defaults → node defaults → edge defaults → nodes → edges → subgraphs). But within each section, if two consecutive statements had a blank line between them in the original source, preserve one blank line between them in the output. Multiple consecutive blank lines collapse to one.

#### Changes to CST types

Add `startLine: number` and `endLine: number` to each `CstStmt` variant. The `CstParser` records `this.peek().line` at statement start and the line of the last consumed token at statement end.

#### Changes to `emitBody`

Within each section, when joining consecutive statements, check if `stmt[i+1].startLine - stmt[i].endLine >= 2`. If so, emit `"\n\n"` (one blank line); otherwise emit `"\n"`.

---

### 4. Formatter: vertical alignment

**Package**: `attractor-lsp`
**File**: `packages/attractor-lsp/src/formatter.ts`

**Scope**: Alignment applies only within "alignment blocks" — runs of consecutive same-section statements with no blank line between them (using the boundaries from change 3).

#### Node declaration alignment

For a block of `NodeDecl` statements:
- Compute `maxIdLen` = max `emitId(n.id).length` across the block.
- Pad each ID to `maxIdLen` before appending ` [attrs]`.
- Within `[attrs]`, align `=` signs: compute `maxKeyLen` per attribute position across the block, pad keys accordingly.

#### Edge chain alignment

For a block of `EdgeChain` statements:
- For each arrow column `c` (0-indexed), compute `maxNodeLen[c]` = max length of the node ID at position `c` across all edges that have at least `c+1` nodes.
- Pad each node ID at position `c` to `maxNodeLen[c]`, aligning all `->` arrows.
- After the chain, align the `[` bracket: compute max total chain width across the block, pad to that before `[attrs]`.
- Within attrs, align `=` signs like nodes.

#### Graph attribute alignment

For a block of `GraphAttr` statements:
- Compute `maxKeyLen`, pad keys so `=` signs align.

#### Defaults alignment

For a block of `DefaultsStmt` statements:
- Align the `[` bracket across the block.

---

## Implementation order

1. Change 1 (parallel visibility) — small, self-contained CLI change
2. Change 3 (formatter whitespace) — prerequisite for change 4
3. Change 4 (formatter alignment) — depends on blank-line block boundaries from change 3
4. Change 2 (dynamic parallel) — largest change, independent of 1/3/4

## Verification

1. **Parallel visibility**: Run a flow with parallel branches, confirm events appear in default output
2. **Formatter whitespace**: Format a `.dag` with intentional blank lines within node/edge sections, verify preserved (max 1)
3. **Formatter alignment**: Format `sprint.dag`, verify node IDs align `[` brackets, edge chains align `->` arrows
4. **Dynamic parallel**: Write a test `.dag` with `foreach_key`, verify branches spawn per array item
5. **Existing tests**: `pnpm test` in both packages, no regressions
