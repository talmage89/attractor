# Test Session Findings

## Session 2 (2026-03-03)

### Codebase validation
- `pnpm run build`: PASS
- `pnpm run typecheck`: PASS
- `pnpm test`: PASS — 416 tests (393 attractor + 23 attractor-lsp)

### Testing areas covered

**Formatter edge cases**
- Graph name with hyphens (e.g. `"my-graph"`) — correctly quoted by `emitId` ✓
- Graph name that's an integer — stays bare (matches number regex) ✓
- Multiple attribute blocks on a node — all attrs merged correctly (BUG-017 coverage) ✓
- Multiple attribute blocks on an edge — all attrs merged correctly ✓
- Node ID with spaces — correctly quoted ✓
- `\n` and `\"` escape sequences — round-trip idempotent ✓
- Unknown attribute `tool_command` — sorted alphabetically after known groups ✓
- `loop_restart` edge attribute — ordered last in edge-specific group ✓
- Whitespace-only file — returns no edits ✓
- Multiple subgraphs at top level — all preserved ✓
- Anonymous subgraph `subgraph { }` — formatted as `subgraph {` ✓
- `graph [...]` treated as graph defaults (not node named "graph") ✓
- Deep nested subgraphs — correct 6-space indent at depth 3 ✓
- Very long attribute value (500 chars) — no truncation ✓
- Duplicate graph attribute keys — both appear in output (CST preserves all stmts) ✓
- Complex full-feature pipeline — idempotent ✓
- All 20 `ATTR_ORDER` keys in reverse order — correctly sorted, idempotent ✓

**Diagnostics edge cases**
- Parse error from parser (undirected graph) — `parse_error` diagnostic, valid range ✓
- `fidelity_valid` span points to correct line ✓
- All diagnostics have `source = "attractor"` ✓
- Empty graph → `start_node`/`terminal_node` at fallback range ✓
- Edge span on correct line ✓
- `retry_target_exists` span points to node line ✓
- Node at column 1 (no indent) → LSP character=0 ✓
- Node at column 4 (4-space indent inside subgraph) → LSP character=4 ✓

**Span accuracy**
- `attributeSpans.get('goal')` has correct line and column (1-indexed) ✓
- Node span column=3 for 2-space indent ✓
- Edge span endColumn covers closing `]` ✓
- Distinct spans for each node on different lines ✓

### Bugs found

#### FINDING-001: Formatter CST parser loses `graph -> X` edge and duplicates target node [LOW]

**What you did:**
```
format("digraph G { start [shape=Mdiamond] graph -> b b [shape=Msquare] }")
```

**What you expected:**
The edge statement `graph -> b` to be preserved (consistent with how `node -> b` and `edge -> b` are handled).

**What happened:**
The edge is silently dropped and the target node `b` appears twice as bare node declaration:
```
digraph G {
  start [shape = "Mdiamond"]
  b
  b [shape = "Msquare"]
}
```

**Root cause:**
In `CstParser.parseStatement()`, the `graph` keyword branch returns `null` when not followed by `[`:
```typescript
if (t.kind === "GRAPH") {
  this.advance();
  if (this.check("LBRACKET")) { ... }
  return null;  // ← BUG: ARROW and 'b' tokens left unconsumed
}
```
The `node` and `edge` keyword branches correctly call `return this.parseAfterFirstId(...)` as a fallback. The `graph` keyword branch does not. This leaves the `->` token unconsumed; the next iteration skips it, then `b` is parsed as a bare node declaration.

**Impact:**
- Edge statement silently removed from formatted output
- Duplicate node declaration for the edge target in output
- Inconsistency: `node -> b` and `edge -> b` work correctly, `graph -> b` does not
- Idempotent in broken state — re-formatting the broken output produces the same broken output

**Reproduction:**
```
node --input-type=module << 'EOF'
import { format } from './packages/attractor-lsp/dist/formatter.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
const doc = TextDocument.create("file:///test.dag", "attractor", 1,
  'digraph G { start [shape=Mdiamond] graph -> b b [shape=Msquare] }');
const edits = format(doc);
console.log(edits[0].newText);
EOF
```

**Severity:** LOW. Using `graph` as a node name is an invalid attractor construct (the attractor runtime itself silently ignores such edges). However, the formatter silently corrupts the output instead of producing a clean error or returning `[]`.

---

## Session 1 (2026-03-03)

### Codebase validation
- `pnpm run build`: PASS
- `pnpm run typecheck`: PASS
- `pnpm test`: PASS — 416 tests (393 attractor + 23 attractor-lsp)

### Testing areas covered

**Formatter (`packages/attractor-lsp/src/formatter.ts`)**
- `graph []` defaults with attributes — idempotent ✓
- Multiple `node [...]` / `edge [...]` defaults blocks — both retained, idempotent ✓
- `loop_restart` and full semantic attribute ordering — correct ✓
- Quoted string node IDs (e.g. `"my-node"`) — preserved and idempotent ✓
- All 20 known semantic attributes ordered correctly ✓
- No-name `digraph { }` — formats to `digraph {` header, idempotent ✓
- Graph-level `label` attribute — moved to graph attrs section, idempotent ✓
- Subgraph with graph-level attrs inside — `goal` attr preserved, idempotent ✓
- Unknown attributes — sorted alphabetically after known groups ✓
- Escape sequences (`\n`, `\\`, `\"`, `\t`) in attribute values — idempotent ✓
- Nested subgraphs — correct recursive indentation, idempotent ✓
- CRLF input → LF output — correctly normalizes, idempotent ✓
- Node IDs with dots (`my.node`) — stay unquoted, idempotent ✓
- Duplicate graph attribute keys — both retained (last-write-wins in parser), idempotent ✓
- Quoted graph name — preserved with quotes ✓
- Complex pipeline (all features combined) — formats and is idempotent ✓
- Adversarial inputs (malformed, empty, keyword-only, attrs without `=`) — no crashes ✓
- `digraph` keyword as node/edge identifier — handled without crash ✓

**Diagnostics (`packages/attractor-lsp/src/diagnostics.ts`)**
- `reachability` rule — correct span pointing to unreachable node line ✓
- `invalid_edge_weight` (NaN weight) — correct span, severity=Warning ✓
- `type_known` rule — correct span on invalid type node ✓
- `fidelity_valid` rule — correct span, severity=Warning ✓
- `goal_gate_has_retry` rule — correct span on goal gate node ✓
- `retry_target_exists` rule — correct span ✓
- `condition_syntax` rule — correct span on edge ✓
- `node_id_safe` rule — fires for slash in quoted node ID, correct span ✓
- `start_no_incoming` rule — detected correctly ✓
- `start_node` rule — falls back to `{0,0}—{0,80}` range (no span on graph-level diagnostic) ✓
- Parse error (undirected graph) — falls back to `{0,0}—{0,80}` correctly (error message has no line info) ✓
- `diagnostic.source` = "attractor", `diagnostic.code` = rule name ✓
- `computeDiagnostics` does not crash on any adversarial input ✓

**Span accuracy (`packages/attractor/src/parser/parser.ts`)**
- `attributeSpans` Map present on parsed graph ✓
- `node`/`edge`/`goal` entries in `attributeSpans` with correct 1-indexed lines ✓
- Node `span` correct (1-indexed line) ✓
- Edge `span` correct (1-indexed line) ✓

### Bugs found

No bugs found. Application behaves as specified.

### Observations (not bugs)

1. **`graph` as node ID in edge** — The attractor parser throws `expected identifier after '->'` when `graph` (a DOT keyword) is used as an edge target. The formatter is consistent: `graph [shape=box]` is treated as a `graph [...]` defaults block, not a node declaration. Users should avoid naming nodes after DOT keywords (`graph`, `node`, `edge`, `subgraph`).

2. **Undirected graph parse error** — The message "Parse error: expected 'digraph' keyword. Undirected graphs are not supported." has no line/column info, so the diagnostic range falls back to `{0,0}—{0,80}`. This is correct per spec but the squiggly underline covers the first 80 chars rather than the specific `graph` keyword. Low impact.

3. **`fidelity_valid` severity is Warning** (not Error) — Consistent with the implementation; invalid fidelity mode is a warning, not an error.
