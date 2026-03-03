# Implementation Plan: attractor-lsp

> Phases adopted from spec.md (the spec declares explicit numbered phases and an implementation order).

---

## Phase 1 — Add source spans to the attractor parser

**Goal**: Every AST node, edge, and graph attribute assignment carries a source span so the LSP can map diagnostics to editor ranges.

**Files to create/modify**:
- `src/model/graph.ts` — add `Span` interface; add `span?: Span` to `GraphNode` and `Edge`; add `attributeSpans?: Map<string, Span>` to `Graph`
- `src/parser/parser.ts` — track `lastConsumed` token in `advance()`; add `spanFrom(startToken)` helper; record spans on every node declaration, edge chain, graph attribute assignment, and defaults statement
- `src/validation/diagnostic.ts` — add `span?: Span` field to `Diagnostic` interface
- `src/validation/rules.ts` — thread `span: node.span` / `span: edge.span` into all 17 rules

**Acceptance criteria**:
- All existing tests continue to pass (spans are optional and never read by the runtime)
- `parse("digraph G { a [shape=box] a -> b }")` returns nodes/edges with populated `span` objects (line/column/endLine/endColumn, all 1-indexed)
- Diagnostics produced by `validate()` carry a `span` for every diagnostic that references a node or edge

**Dependencies**: none (modifies existing attractor package)

**Estimated size**: ~150–250 lines changed

---

## Phase 1b — Thread spans into all 17 validation rules

**Goal**: Every rule that references a `GraphNode` or `Edge` populates `span` on the diagnostic it emits.

**Files to create/modify**:
- `src/validation/rules.ts` — mechanical update: where a rule creates a diagnostic for a node, add `span: node.span`; where for an edge, add `span: edge.span`

**Acceptance criteria**:
- All 17 rules have been audited; any rule that references a node or edge now includes `span` in the diagnostic
- All existing validation tests pass

**Dependencies**: Phase 1

**Estimated size**: ~50 lines changed

---

## Phase 2a — Scaffold `attractor-lsp` package

**Goal**: Create the package skeleton so subsequent phases have a home.

**Files to create**:
- `packages/attractor-lsp/package.json` — name `attractor-lsp`, type module, depends on `attractor@workspace:*`, `vscode-languageserver@^10.0.0`, `vscode-languageserver-textdocument@^1.0.0`
- `packages/attractor-lsp/tsconfig.json` — extends root, NodeNext module resolution, outDir `dist/`
- `packages/attractor-lsp/src/server.ts` — LSP server entry point with stdio transport; registers `textDocumentSync: Full` and `documentFormattingProvider: true`; wires `didOpen`/`didChange` → `computeDiagnostics`; wires `formatting` → `format`

**Acceptance criteria**:
- `pnpm install` from workspace root succeeds
- `pnpm --filter attractor-lsp build` compiles without errors
- `node packages/attractor-lsp/dist/server.js --stdio` starts and waits on stdin (no crash on startup)

**Dependencies**: pnpm workspace monorepo must already exist (stated as prerequisite in spec)

**Estimated size**: ~100 lines

---

## Phase 2b — `diagnostics.ts` — bridge attractor diagnostics to LSP

**Goal**: Convert attractor parse errors and validation diagnostics into LSP `Diagnostic[]`.

**Files to create**:
- `packages/attractor-lsp/src/diagnostics.ts` — `computeDiagnostics(doc: TextDocument): LspDiag[]`; try/catch parse errors and map to a single LSP diagnostic with line/column extracted from the error message; map attractor diagnostics to LSP using `d.span` (1-indexed → 0-indexed); fall back to `{line:0, character:0}–{line:0, character:80}` when no span

**Acceptance criteria**:
- Valid DOT → empty array
- Parse error → single diagnostic with correct line/column
- Validation error on a node with span → diagnostic range covers that node's declaration

**Dependencies**: Phase 2a, Phase 1 (for spans on attractor diagnostics)

**Estimated size**: ~80 lines

---

## Phase 2c — `formatter.ts` — strict canonical DOT formatter

**Goal**: Implement a CST-level DOT pretty-printer that produces deterministic canonical output.

**Files to create**:
- `packages/attractor-lsp/src/formatter.ts` — lex the source into tokens; build a lightweight CST (list of `GraphAttr`, `DefaultsStmt`, `NodeDecl`, `EdgeChain`, `Subgraph` statements); sort by canonical order; emit formatted text; return a single full-document `TextEdit[]`

**Canonical ordering**:
1. Graph attributes (`goal`, `label`, `model_stylesheet`, `default_max_retry`, …)
2. `node [...]` defaults
3. `edge [...]` defaults
4. Node declarations
5. Edge declarations
6. Subgraphs (recursively formatted)

**Attribute ordering within `[...]`**: identity group → behavior group → model group → flags → edge-specific → remaining alphabetical (see spec for full ordered list)

**Formatting rules**:
- 2-space indentation per nesting level
- One blank line between sections
- No trailing semicolons
- All values quoted (`weight = "2"`)
- Attribute separator: `, `
- Edge chains preserved (`a -> b -> c`)
- Returns `[]` on parse/lex failure (don't format broken files)

**Acceptance criteria**:
- Minimal pipeline formats to canonical form
- Attributes reordered correctly
- Values quoted even when source has bare values
- Subgraphs indented correctly
- Edge chains preserved
- Idempotent (format of formatted output = same output)
- Parse errors → returns `[]`

**Dependencies**: Phase 2a

**Estimated size**: ~300–400 lines

---

## Phase 2d — Tests

**Goal**: Comprehensive test coverage for formatter and diagnostics.

**Files to create**:
- `packages/attractor-lsp/test/formatter.test.ts` — 12 snapshot-style test cases (minimal pipeline, graph attr reordering, node defaults, edge defaults, attribute quoting, attribute ordering, subgraph formatting, edge chain preservation, comments stripped, idempotency, empty file, parse error)
- `packages/attractor-lsp/test/diagnostics.test.ts` — 6 test cases (valid file, parse error, missing start node, unreachable node, invalid edge weight, multiple diagnostics)
- `packages/attractor-lsp/test/integration.test.ts` — spawn LSP server as child process, send JSON-RPC `initialize` + `textDocument/didOpen` + `textDocument/formatting` over stdio, verify responses

**Acceptance criteria**:
- `pnpm --filter attractor-lsp test` passes all tests
- All 12 formatter tests pass
- All 6 diagnostic tests pass
- Integration test validates server startup and a round-trip format request

**Dependencies**: Phase 2b, Phase 2c

**Estimated size**: ~200–300 lines

---

## Phase 3 — Helix integration documentation

**Goal**: Provide exact `languages.toml` configuration for Helix editor integration.

**Files to create**:
- `packages/attractor-lsp/HELIX.md` — exact `languages.toml` snippet for Helix; instructions for both global install (PATH) and absolute path variants; note on optional DOT grammar reuse for syntax highlighting

**Acceptance criteria**:
- File exists and contains a working `[[language]]` + `[[language-server.attractor-lsp]]` block for the `.dag` file extension
- Instructions cover both "node absolute/path/dist/server.js --stdio" and "attractor-lsp --stdio" variants

**Dependencies**: Phase 2a (package name / entry point must be finalized)

**Estimated size**: ~30 lines

---

## Summary

| # | Phase | Key deliverable | Estimated size |
|---|-------|-----------------|----------------|
| 1 | Spans in parser | `Span` type + parser tracking | ~150–250 lines |
| 1b | Spans in rules | 17 rules emit `span` | ~50 lines |
| 2a | LSP package scaffold | `package.json`, `tsconfig.json`, `server.ts` | ~100 lines |
| 2b | Diagnostics bridge | `diagnostics.ts` | ~80 lines |
| 2c | Formatter | `formatter.ts` (CST + emitter) | ~300–400 lines |
| 2d | Tests | 3 test files | ~200–300 lines |
| 3 | Helix docs | `HELIX.md` | ~30 lines |

**Total phases: 7**
