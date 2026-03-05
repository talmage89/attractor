# Spec: Semantic Tokens + VS Code Extension

## Overview

Two deliverables:
1. Add **semantic token support** to `attractor-lsp` so Helix and VS Code can color DAG files by semantic role
2. Create a **minimal VS Code extension** (`packages/attractor-vscode`) that provides syntax coloring, formatting, and a custom file icon for `.dag` files

---

## Deliverable 1: Semantic Tokens in `attractor-lsp`

### Goal

Emit LSP semantic tokens that visually separate three categories:
- **Graph-level** — the `digraph` keyword, graph name, `graph`/`node`/`edge` default keywords, graph-level attribute keys and values
- **Node declarations** — node identifiers, their attribute keys and values, bracket delimiters
- **Edge/flow declarations** — edge source/target identifiers, `->` arrows, edge attribute keys and values, conditions

### Approach: Second-Pass Token Classifier

Create a new module `packages/attractor-lsp/src/semantic-tokens.ts` that:

1. Runs the existing **lexer** to get the positioned token stream (`Token[]`)
2. Walks the token stream with a **lightweight state machine** that tracks syntactic context (are we in a graph attr block? a node declaration? an edge chain?) without building a full AST
3. Maps each token to an LSP semantic token type + modifiers

This is deliberately separate from the parser to avoid coupling highlighting concerns with graph-model construction.

### State Machine Contexts

The classifier tracks which syntactic region each token belongs to:

| Context | Entered when | Exited when |
|---------|-------------|-------------|
| `graph_header` | `DIGRAPH` token seen | `LBRACE` after graph name |
| `graph_attr` | `GRAPH` keyword followed by `LBRACKET` | matching `RBRACKET` |
| `node_defaults` | `NODE` keyword followed by `LBRACKET` | matching `RBRACKET` |
| `edge_defaults` | `EDGE` keyword followed by `LBRACKET` | matching `RBRACKET` |
| `subgraph` | `SUBGRAPH` keyword | matching `RBRACE` (nesting tracked) |
| `node_decl` | `IDENTIFIER` at statement start, not followed by `ARROW` | `RBRACKET` or next statement |
| `edge_chain` | `IDENTIFIER` at statement start, followed by `ARROW` | `RBRACKET` or next statement |
| `attr_list` | `LBRACKET` within any declaration | matching `RBRACKET` |

Within `attr_list`, the classifier further distinguishes:
- Attribute **keys** (IDENTIFIER before `=`)
- Attribute **values** (token after `=`: STRING, INTEGER, FLOAT, DURATION, TRUE, FALSE, IDENTIFIER)

### LSP Semantic Token Type Mapping

Standard LSP token types used (these are well-supported across editors):

| DAG element | LSP token type | LSP modifier | Color intent |
|------------|----------------|-------------|-------------|
| `digraph` keyword | `keyword` | `declaration` | Language keyword |
| Graph name (after `digraph`) | `namespace` | `declaration` | Graph identity |
| `graph`, `node`, `edge` keywords | `keyword` | — | Defaults keyword |
| `subgraph` keyword | `keyword` | — | Language keyword |
| `{`, `}` | Not emitted (left to theme) | — | — |
| Node identifier (declaration) | `class` | `declaration` | Node identity |
| Node identifier (in edge chain) | `class` | — | Node reference |
| `->` arrow | `operator` | — | Flow operator |
| `[`, `]` | Not emitted | — | — |
| Attribute key (graph-level) | `property` | `static` | Graph config |
| Attribute key (node) | `property` | — | Node config |
| Attribute key (edge) | `property` | `abstract` | Edge config |
| String value | `string` | — | Value |
| Numeric value (INTEGER, FLOAT) | `number` | — | Value |
| Duration value | `number` | `readonly` | Value |
| Boolean value (TRUE, FALSE) | `keyword` | — | Constant |
| Condition value (special) | `string` | `abstract` | Conditional |
| `=` in attributes | Not emitted | — | — |
| `,` separator | Not emitted | — | — |
| Comment (// or /* */) | Not emitted (handled pre-lexer) | — | — |

The modifier distinctions (`static` for graph attrs, none for node attrs, `abstract` for edge attrs) allow themes to color attribute keys differently per context, achieving the visual separation goal.

### Server Changes

In `packages/attractor-lsp/src/server.ts`:

1. Import the new `computeSemanticTokens` function
2. Add to `onInitialize` capabilities:
   ```
   semanticTokensProvider: {
     legend: { tokenTypes: [...], tokenModifiers: [...] },
     full: true
   }
   ```
3. Add handler: `connection.languages.semanticTokens.on(full)` that calls `computeSemanticTokens(doc)`

### Token Encoding

LSP semantic tokens use a delta-encoded integer array: `[deltaLine, deltaStartChar, length, tokenType, tokenModifiers]` per token. The classifier will produce an intermediate list of `{ line, column, length, type, modifiers }` objects, then encode them into the delta format before returning.

### Error Resilience

If the lexer throws (malformed input), the classifier returns an empty token array. Partial results are acceptable — classify what's possible up to the error point, then stop. The lexer already reports error positions, so the classifier can catch and truncate.

### Tests

Add `packages/attractor-lsp/test/semantic-tokens.test.ts`:
- Test that a minimal DAG (`digraph G { a -> b }`) produces correct token types
- Test that node declarations get `class.declaration`, edge references get `class`
- Test that attribute keys get different modifiers per context (graph vs node vs edge)
- Test that malformed input returns empty/partial tokens without throwing
- Test delta encoding correctness

---

## Deliverable 2: VS Code Extension (`packages/attractor-vscode`)

### Package Structure

```
packages/attractor-vscode/
  package.json          # Extension manifest
  tsconfig.json
  src/
    extension.ts        # Activate: start LSP client
  icons/
    dag-icon.svg        # Custom file icon
  language-configuration.json
```

### package.json (Extension Manifest)

Key fields:
- `name`: `attractor-vscode`
- `displayName`: `Attractor DAG`
- `publisher`: not set (not published)
- `engines.vscode`: `^1.85.0`
- `categories`: `["Programming Languages"]`
- `main`: `./dist/extension.js`
- `activationEvents`: `["onLanguage:attractor"]`

#### Contributes

```jsonc
{
  "contributes": {
    "languages": [{
      "id": "attractor",
      "aliases": ["Attractor DAG", "dag"],
      "extensions": [".dag"],
      "configuration": "./language-configuration.json",
      "icon": {
        "light": "./icons/dag-icon.svg",
        "dark": "./icons/dag-icon.svg"
      }
    }],
    "iconThemes": []  // Not needed — language icon above covers file explorer
  }
}
```

No `grammars` contribution — coloring comes entirely from the LSP semantic tokens.

#### language-configuration.json

```json
{
  "comments": {
    "lineComment": "//",
    "blockComment": ["/*", "*/"]
  },
  "brackets": [
    ["{", "}"],
    ["[", "]"]
  ],
  "autoClosingPairs": [
    { "open": "{", "close": "}" },
    { "open": "[", "close": "]" },
    { "open": "\"", "close": "\"", "notIn": ["string"] }
  ],
  "surroundingPairs": [
    ["{", "}"],
    ["[", "]"],
    ["\"", "\""]
  ]
}
```

### Extension Entry Point (`src/extension.ts`)

Minimal LSP client setup:

1. Import `vscode-languageclient`
2. On activate:
   - Create `LanguageClient` with server command `attractor-lsp --stdio` (assumes on PATH)
   - Document selector: `{ scheme: "file", language: "attractor" }`
   - Start the client
3. On deactivate: stop the client

No custom commands, no custom views, no status bar items. Just wire up the LSP.

### Dependencies

```json
{
  "dependencies": {
    "vscode-languageclient": "^10.0.0-next.14"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "typescript": "^5.7.0",
    "esbuild": "^0.25.0",
    "@vscode/vsce": "^3.0.0"
  }
}
```

### Build

- Use esbuild to bundle `src/extension.ts` into `dist/extension.js` (single file, external `vscode`)
- Add `package` script: `vsce package --no-dependencies` to produce `.vsix`
- Add to root `pnpm-workspace.yaml` packages list

### File Icon: Converging Arrows

SVG design for `icons/dag-icon.svg`:
- 16x16 viewBox
- Three arrow lines converging from top-left, top-right, and bottom-left toward a central point (bottom-right area)
- Arrow heads are small filled triangles
- Stroke color: `#8B5CF6` (purple, visible on both light and dark backgrounds)
- Stroke width: 1.5, rounded line caps
- Minimal, geometric, no fills on the paths — just strokes and arrowheads
- Designed to be legible at 16x16 in VS Code's file explorer

### No TextMate Grammar

The extension deliberately ships no TextMate grammar. Coloring is provided entirely by LSP semantic tokens. This means:
- If the LSP is not running, `.dag` files appear uncolored (plain text)
- This is acceptable because formatting and diagnostics also require the LSP
- Avoids maintaining two separate highlighting systems

---

## Integration Checklist

- [ ] `pnpm-workspace.yaml` — add `packages/attractor-vscode`
- [ ] Root `package.json` — no changes needed (recursive scripts already cover all packages)
- [ ] `attractor-lsp/package.json` — no new dependencies (reuses existing `attractor` lexer)
- [ ] Helix `languages.toml` — no changes needed (already configured, will pick up semantic tokens automatically once LSP advertises them)

## Order of Implementation

1. Semantic tokens module (`semantic-tokens.ts`) + tests
2. Wire into LSP server (`server.ts` capability + handler)
3. Verify in Helix (restart editor, confirm colors)
4. Create VS Code extension package scaffold
5. Extension entry point (LSP client wiring)
6. SVG icon
7. Build + produce `.vsix`
8. Install and verify in VS Code
