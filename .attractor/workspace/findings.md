# Review Findings

**Build**: ✅ passes (`pnpm run build`)
**Typecheck**: ✅ passes (`pnpm run typecheck`)
**Tests**: ✅ all 413 pass (393 attractor + 20 attractor-lsp)

---

## FINDING-001 — LOW

**File**: `packages/attractor-lsp/package.json`

**Issue**: The spec specifies `"vscode-languageserver": "^10.0.0"` in the package.json dependencies, but the implementation uses `"^9.0.0"` (installed: 9.0.1).

**Impact**: Functionally none — the APIs used (`createConnection`, `TextDocuments`, `ProposedFeatures`, `TextDocumentSyncKind`, `DiagnosticSeverity`) are identical between v9 and v10. All tests pass. However, this is an explicit spec deviation.

**Fix**: Update `"vscode-languageserver": "^9.0.0"` → `"^10.0.0"` and run `pnpm install`.

---

## FINDING-002 — LOW

**File**: `packages/attractor/src/parser/parser.ts` — `parseStatement()`

**Issue**: The spec (Phase 1.3) requires spans to be recorded for `node [...]`, `edge [...]`, and `graph [...]` default blocks and stored in `graph.attributeSpans`. The parser only stores spans for top-level `key = value` graph attribute assignments; it does not record spans for the defaults blocks.

Spec excerpt:
> Apply this in:
> - `parseStatement()` for `graph [...]`, `node [...]`, `edge [...]` defaults — store on `attributeSpans`

**Impact**: No observable impact today — no validation rule reads `attributeSpans` entries for defaults blocks. The LSP diagnostics all flow through `node.span` and `edge.span`, which are correctly populated. The gap only matters if future rules or hover-info features need to locate defaults statements.

**Fix**: In `parseStatement()`, capture `startToken = this.peek()` before consuming the `NODE`/`EDGE`/`GRAPH` keyword and record `this.spanFrom(startToken)` into `graph.attributeSpans` under the key `"node"`, `"edge"`, or `"graph"` respectively after consuming the attribute block.

---

## Summary

| # | Severity | Description |
|---|----------|-------------|
| 1 | LOW | `vscode-languageserver` pinned to `^9.0.0`, spec says `^10.0.0` |
| 2 | LOW | Spans not recorded for `node [...]`/`edge [...]`/`graph [...]` defaults blocks |

Two LOW findings. No CRITICAL, HIGH, or MEDIUM issues. The implementation is correct, well-tested, and spec-compliant in all areas that affect observable LSP behavior.
