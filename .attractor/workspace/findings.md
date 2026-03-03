# Review Findings

**Build**: ✅ passes (`pnpm run build`)
**Typecheck**: ✅ passes (`pnpm run typecheck`)
**Tests**: ✅ all 413 pass (393 attractor + 20 attractor-lsp)

---

No findings. Implementation matches specification.

## Spec compliance verified

### Phase 1 — Spans in model
- `Span` interface in `graph.ts` ✓ (1-indexed, all four fields)
- `span?: Span` on `GraphNode` and `Edge` ✓
- `attributeSpans?: Map<string, Span>` on `Graph` ✓
- `Span` exported from `index.ts` ✓

### Phase 1 — Spans in parser
- `lastConsumed` field updated in `advance()` ✓
- `spanFrom(startToken)` helper ✓
- Node declaration spans recorded ✓
- Edge chain spans recorded ✓
- Top-level `key = value` spans recorded ✓
- `graph [...]` / `node [...]` / `edge [...]` defaults spans recorded ✓

### Phase 1b — Spans in validation rules
All 17 rules audited; every rule that references a `GraphNode` or `Edge` includes `span: node.span` / `span: edge.span` ✓

### Phase 2a — LSP scaffold
- `package.json` with correct name, bin entry, `workspace:*` dep ✓
- `tsconfig.json` with NodeNext + outDir dist ✓
- `server.ts` starts with `#!/usr/bin/env node` ✓
- `vscode-languageserver: 10.0.0-next.16` (v10 stable not yet released; previous finding accepted) ✓
- Import path `vscode-languageserver/node` (not `/node.js`) ✓
- shutdown/exit handlers for clean teardown ✓

### Phase 2b — `diagnostics.ts`
- `computeDiagnostics` implemented ✓
- Parse errors: line/column extracted from error message; fallback to line 0 ✓
- 1-indexed → 0-indexed conversion ✓
- `source: "attractor"`, `code: d.rule` on all diagnostics ✓
- Fallback range `{0,0}–{0,80}` when no span ✓

### Phase 2c — `formatter.ts`
- CST types (`GraphAttr`, `DefaultsStmt`, `NodeDecl`, `EdgeChain`, `Subgraph`) ✓
- Canonical section order: graph attrs → graph defaults → node defaults → edge defaults → nodes → edges → subgraphs ✓
- Attribute semantic ordering matches spec exactly (identity → behavior → model → flags → edge-specific → remaining alpha) ✓
- All values quoted ✓
- Edge chains preserved ✓
- Comments stripped ✓
- Returns `[]` on lex/parse failure ✓
- Idempotent ✓

### Phase 2d — Tests
- 12 formatter snapshot tests ✓
- 6 diagnostic mapping tests ✓
- 2 integration tests (spawn LSP process, full round-trip) ✓

### Phase 3 — Helix documentation
- `HELIX.md` with `[[language]]` + `[[language-server.attractor-lsp]]` blocks ✓
- Both absolute-path and PATH/global-install variants ✓
- Setup verification steps and syntax highlighting note ✓
