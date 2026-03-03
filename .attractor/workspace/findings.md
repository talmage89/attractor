# Test Session Findings

## Session 3 — 2026-03-03

No bugs found. Application behaves as specified.

### Testing coverage (80+ tests across 4 scripts + 8 LSP integration tests)

**Formatter:**
- Canonical section ordering: graph attrs → graph/node/edge defaults → nodes → edges → subgraphs ✓
- Idempotency with all section types, nested subgraphs, special characters (tab/backslash/braces) ✓
- Quoted graph names, quoted node IDs, IDs with spaces/dashes/colons ✓
- Keywords as node IDs: DIGRAPH/TRUE/FALSE/DURATION/NODE/EDGE/GRAPH in edge positions ✓
- SUBGRAPH keyword as edge source correctly returns null (CST parser failure) ✓
- Edge chains with >2 nodes, quoted IDs in chains ✓
- Multiple attr blocks on defaults (BUG-017 coverage) ✓
- DURATION values quoted in output ✓
- Empty attr blocks (`node []`, `edge []`, `graph []`) preserved and idempotent ✓
- Anonymous subgraphs, deeply nested subgraphs ✓
- Malformed input (missing edge target) doesn't crash, graceful handling ✓
- TextEdit range covers entire document ✓
- Attribute ordering: identity → behavior → model → flags → edge-specific → alphabetical remainder ✓

**Spans:**
- Explicit node declarations have correct line/column spans ✓
- Edge chains: all edges in chain share same span ✓
- Graph attribute assignments recorded in `attributeSpans` ✓
- `node [...]` / `edge [...]` / `graph [...]` defaults recorded in `attributeSpans` ✓
- Implicit nodes (edge-target-only) have no span → fallback to document start in diagnostics ✓
- Nodes inside subgraphs have correct spans at 4-space indent ✓

**Diagnostics:**
- All rules produce diagnostics with non-null code/message/severity ✓
- Severity mapping: error=1, warning=2 ✓
- All diagnostics have `source: "attractor"` ✓
- Parse error range extracted from error message (line/column) ✓
- Spans correctly mapped 1-indexed → 0-indexed for LSP ✓
- Fallback range {0,0}–{0,80} for graph-level rules without spans ✓
- Rules with spans: reachability, fidelity_valid, invalid_edge_weight, condition_syntax,
  retry_target_exists, prompt_on_llm_nodes, start_no_incoming, exit_no_outgoing ✓

**LSP server:**
- `textDocument/didOpen` publishes diagnostics notification ✓
- `textDocument/didChange` publishes updated diagnostics ✓
- Valid file → 0 diagnostics ✓
- Invalid file → correct diagnostic count and codes ✓
- Formatting not-opened document returns `[]` ✓
- Formatting lex-error file returns `[]` ✓
- `shutdown` responds correctly (null result) ✓
- Parse error range correct in LSP notification ✓
