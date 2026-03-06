# Implementation Plan

Phases adopted from spec's "Order of Implementation" section.

## Current State

All 8 phases appear to be **already implemented** based on codebase inspection:
- `packages/attractor-lsp/src/semantic-tokens.ts` — 339 lines, full classifier with state machine
- `packages/attractor-lsp/src/server.ts` — wired with semantic tokens provider + handler
- `packages/attractor-lsp/test/semantic-tokens.test.ts` — comprehensive tests
- `packages/attractor-vscode/` — complete extension package with extension.ts, language-configuration.json, icons/dag-icon.svg, esbuild build
- `pnpm-workspace.yaml` — includes `packages/*` glob (covers attractor-vscode)

Implementation agents should **verify** existing code matches the spec and fix any gaps.

---

## Phase 1: Semantic tokens module + tests

**Goal:** Create `packages/attractor-lsp/src/semantic-tokens.ts` with state-machine classifier and tests.

**Files:**
- `packages/attractor-lsp/src/semantic-tokens.ts` (create/verify)
- `packages/attractor-lsp/test/semantic-tokens.test.ts` (create/verify)

**Acceptance criteria:**
- Classifier walks lexer token stream with state machine tracking 8 contexts (graph_header, graph_attr, node_defaults, edge_defaults, subgraph, node_decl, edge_chain, attr_list)
- Maps tokens to LSP semantic token types per spec table (keyword, namespace, class, operator, property, string, number)
- Applies correct modifiers per context (declaration, static, abstract, readonly)
- Condition values get `string` + `abstract`
- Delta-encodes output as `[deltaLine, deltaStartChar, length, tokenType, tokenModifiers]`
- Returns empty array on lexer error (error resilience)
- Tests cover: minimal DAG, node declaration vs edge reference modifiers, attribute key modifiers per context, malformed input, delta encoding

**Dependencies:** None

## Phase 2: Wire into LSP server

**Goal:** Register semantic tokens provider in `packages/attractor-lsp/src/server.ts`.

**Files:**
- `packages/attractor-lsp/src/server.ts` (modify/verify)

**Acceptance criteria:**
- Imports `computeSemanticTokens` and `TOKEN_LEGEND` from semantic-tokens module
- `onInitialize` capabilities include `semanticTokensProvider` with legend (tokenTypes + tokenModifiers) and `full: true`
- Handler registered: `connection.languages.semanticTokens.on(full)` calls `computeSemanticTokens(doc.getText())`

**Dependencies:** Phase 1

## Phase 3: Verify in Helix

**Goal:** Confirm semantic token coloring works in Helix editor.

**Files:** None (manual verification)

**Acceptance criteria:**
- Restart Helix, open a `.dag` file, confirm tokens are colored by semantic role
- This is a manual step — implementation agent should skip or note as manual-only

**Dependencies:** Phase 2

## Phase 4: VS Code extension package scaffold

**Goal:** Create `packages/attractor-vscode/` with package.json manifest and language-configuration.json.

**Files:**
- `packages/attractor-vscode/package.json` (create/verify)
- `packages/attractor-vscode/tsconfig.json` (create/verify)
- `packages/attractor-vscode/language-configuration.json` (create/verify)

**Acceptance criteria:**
- `package.json` has correct fields: name=attractor-vscode, displayName=Attractor DAG, engines.vscode=^1.85.0, main=./dist/extension.js, activationEvents=[onLanguage:attractor]
- `contributes.languages` registers language id=attractor, aliases=[Attractor DAG, dag], extensions=[.dag], icon pointing to SVG
- No `grammars` contribution (coloring from LSP only)
- `language-configuration.json` has comments (line/block), brackets, autoClosingPairs, surroundingPairs per spec
- Dependencies: vscode-languageclient@^10.0.0-next.14, devDeps: @types/vscode, typescript, esbuild, @vscode/vsce
- Added to pnpm-workspace.yaml packages list (already covered by `packages/*` glob)

**Dependencies:** None

## Phase 5: Extension entry point

**Goal:** Create `packages/attractor-vscode/src/extension.ts` with minimal LSP client.

**Files:**
- `packages/attractor-vscode/src/extension.ts` (create/verify)

**Acceptance criteria:**
- Imports from `vscode-languageclient/node`
- `activate()`: creates LanguageClient with server command `attractor-lsp --stdio`, document selector `{ scheme: "file", language: "attractor" }`, starts client
- `deactivate()`: stops client
- No custom commands, views, or status bar items

**Dependencies:** Phase 4

## Phase 6: SVG icon

**Goal:** Create `packages/attractor-vscode/icons/dag-icon.svg`.

**Files:**
- `packages/attractor-vscode/icons/dag-icon.svg` (create/verify)

**Acceptance criteria:**
- 16x16 viewBox
- Three arrow lines converging toward central point
- Arrowheads as small filled triangles
- Stroke color #8B5CF6 (purple)
- Stroke width 1.5, rounded line caps
- Legible at 16x16

**Dependencies:** None

## Phase 7: Build + produce .vsix

**Goal:** Configure esbuild bundling and vsce packaging.

**Files:**
- `packages/attractor-vscode/package.json` (add scripts)

**Acceptance criteria:**
- `build` script: esbuild bundles `src/extension.ts` → `dist/extension.js` (single file, external `vscode`)
- `package` script: `vsce package --no-dependencies` produces `.vsix`
- `typecheck` script: `tsc --noEmit`
- Build succeeds without errors

**Dependencies:** Phases 4, 5, 6

## Phase 8: Install and verify in VS Code

**Goal:** Install extension and verify coloring, formatting, diagnostics.

**Files:** None (manual verification)

**Acceptance criteria:**
- Install .vsix in VS Code, open .dag file, confirm semantic coloring active
- This is a manual step — implementation agent should skip or note as manual-only

**Dependencies:** Phase 7
