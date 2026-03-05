# Implementation Plan

Phases adopted from spec's "Order of Implementation" section.

---

## Phase 1: Semantic Tokens Module + Tests

**Goal:** Create `packages/attractor-lsp/src/semantic-tokens.ts` — a second-pass token classifier that maps lexer tokens to LSP semantic token types using a lightweight state machine.

**Files to create:**
- `packages/attractor-lsp/src/semantic-tokens.ts`
- `packages/attractor-lsp/test/semantic-tokens.test.ts`

**Work:**
- Import the existing `lex()` function from the `attractor` package
- Implement the state machine with contexts: `graph_header`, `graph_attr`, `node_defaults`, `edge_defaults`, `subgraph`, `node_decl`, `edge_chain`, `attr_list`
- Map tokens to LSP types per the spec's token type mapping table (keyword, namespace, class, operator, property, string, number with appropriate modifiers)
- Produce intermediate `{ line, column, length, type, modifiers }` objects, then delta-encode into the LSP `[deltaLine, deltaStartChar, length, tokenType, tokenModifiers]` format
- Handle errors: catch lexer throws and return empty/partial token arrays
- Export `computeSemanticTokens(text: string)` and the `TOKEN_LEGEND` (types + modifiers arrays)

**Tests (semantic-tokens.test.ts):**
- Minimal DAG (`digraph G { a -> b }`) produces correct token types
- Node declarations get `class` + `declaration` modifier; edge references get `class` (no modifier)
- Attribute keys get different modifiers per context (graph=`static`, node=none, edge=`abstract`)
- String/number/duration/boolean values mapped correctly
- Condition values get `string` + `abstract`
- Malformed input returns empty/partial tokens without throwing
- Delta encoding correctness (multi-line input)
- Subgraph keyword gets `keyword` type

**Acceptance criteria:** All tests pass. `computeSemanticTokens` correctly classifies tokens from representative DAG inputs.

---

## Phase 2: Wire Semantic Tokens into LSP Server

**Goal:** Register the semantic tokens provider in the LSP server so editors can request full semantic tokens.

**Files to modify:**
- `packages/attractor-lsp/src/server.ts`

**Work:**
- Import `computeSemanticTokens` and `TOKEN_LEGEND` from `./semantic-tokens.js`
- Add `semanticTokensProvider` to `onInitialize` capabilities: `{ legend: TOKEN_LEGEND, full: true }`
- Add handler: `connection.languages.semanticTokens.on(full)` that gets the document text and calls `computeSemanticTokens`
- Return `{ data: encodedTokens }` from the handler

**Acceptance criteria:** LSP server advertises semantic tokens capability. Handler returns delta-encoded tokens for any document. Existing tests still pass.

**Dependencies:** Phase 1

---

## Phase 3: Verify in Helix

**Goal:** Manual verification — restart Helix editor and confirm DAG files now show semantic coloring.

**Work:** Not automatable. Confirm that the LSP advertises the capability by inspecting the initialize response (can verify in integration test).

**Acceptance criteria:** Integration test confirms semantic tokens capability is advertised. (Manual Helix verification is out of scope for automated pipeline.)

**Dependencies:** Phase 2

---

## Phase 4: VS Code Extension Scaffold

**Goal:** Create the `packages/attractor-vscode` package with manifest, language configuration, and build setup.

**Files to create:**
- `packages/attractor-vscode/package.json` (extension manifest with `contributes.languages`, activation events, dependencies)
- `packages/attractor-vscode/tsconfig.json`
- `packages/attractor-vscode/language-configuration.json` (comments, brackets, auto-closing pairs)

**Work:**
- Create package.json per spec: name `attractor-vscode`, engines.vscode `^1.85.0`, main `./dist/extension.js`, activationEvents `["onLanguage:attractor"]`
- Add language contribution for `attractor` language with `.dag` extension and icon reference
- Add language-configuration.json with comment/bracket/auto-closing config from spec
- Add tsconfig.json targeting ES2022/NodeNext
- Add build script using esbuild to bundle to `dist/extension.js` (external `vscode`)
- Add `package` script using `vsce package --no-dependencies`
- pnpm-workspace.yaml already includes `packages/*` — no changes needed

**Acceptance criteria:** `pnpm install` succeeds. TypeScript compiles (once extension.ts exists in Phase 5). Package structure matches spec.

**Dependencies:** None (can run in parallel with Phases 1-3, but sequenced here for simplicity)

---

## Phase 5: Extension Entry Point (LSP Client)

**Goal:** Create the minimal `extension.ts` that starts the LSP client.

**Files to create:**
- `packages/attractor-vscode/src/extension.ts`

**Work:**
- Import `LanguageClient`, `TransportKind` from `vscode-languageclient/node`
- `activate()`: create `LanguageClient` with server command `attractor-lsp --stdio`, document selector `{ scheme: "file", language: "attractor" }`, start client
- `deactivate()`: stop client
- No custom commands, views, or status bar items

**Acceptance criteria:** TypeScript compiles. Extension activates on `.dag` files and connects to `attractor-lsp` via stdio.

**Dependencies:** Phase 4

---

## Phase 6: SVG Icon

**Goal:** Create the custom file icon for `.dag` files.

**Files to create:**
- `packages/attractor-vscode/icons/dag-icon.svg`

**Work:**
- 16x16 viewBox SVG
- Three arrow lines converging from top-left, top-right, bottom-left toward center-right
- Small filled triangle arrowheads
- Stroke: `#8B5CF6`, width 1.5, rounded caps
- Minimal geometric design, legible at 16x16

**Acceptance criteria:** SVG renders correctly at 16x16. Referenced correctly in package.json icon field.

**Dependencies:** Phase 4 (icon path referenced in manifest)

---

## Phase 7: Build + Produce .vsix

**Goal:** Bundle the extension and produce an installable `.vsix` package.

**Work:**
- Run esbuild to bundle `src/extension.ts` → `dist/extension.js` (single file, `vscode` external)
- Run `vsce package --no-dependencies` to produce `.vsix`
- Verify the `.vsix` contains expected files

**Acceptance criteria:** `dist/extension.js` exists. `.vsix` file is produced without errors.

**Dependencies:** Phases 5, 6

---

## Phase 8: Install and Verify in VS Code

**Goal:** Manual verification — install the `.vsix` in VS Code and confirm everything works.

**Work:** Not automatable in this pipeline. Can verify build artifacts exist and are well-formed.

**Acceptance criteria:** Build artifacts exist. (Manual VS Code verification is out of scope for automated pipeline.)

**Dependencies:** Phase 7
