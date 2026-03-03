# Helix Editor Integration

This document explains how to configure [Helix](https://helix-editor.com/) to
use `attractor-lsp` for real-time diagnostics and format-on-save for `.dag`
pipeline files.

---

## Prerequisites

Build the LSP server:

```sh
pnpm --filter attractor-lsp build
```

This produces `packages/attractor-lsp/dist/server.js`.

---

## `languages.toml` configuration

Add the following to your Helix languages config, typically at
`~/.config/helix/languages.toml`:

```toml
[[language]]
name = "attractor"
scope = "source.attractor"
file-types = ["dag"]
comment-tokens = ["//"]
block-comment-tokens = [{ start = "/*", end = "*/" }]
indent = { tab-width = 2, unit = "  " }
language-servers = ["attractor-lsp"]
roots = ["package.json"]

# Optional: reuse DOT syntax highlighting (close enough for now)
# grammar = "dot"
```

Then configure the language server. Choose **one** of the two variants below:

### Variant A — absolute path (recommended for local development)

```toml
[[language-server.attractor-lsp]]
command = "node"
args = ["/absolute/path/to/packages/attractor-lsp/dist/server.js", "--stdio"]
```

Replace `/absolute/path/to/` with the actual path to the monorepo root on your
machine. Example:

```toml
[[language-server.attractor-lsp]]
command = "node"
args = ["/home/alice/projects/attractor/packages/attractor-lsp/dist/server.js", "--stdio"]
```

### Variant B — global install / PATH

If `attractor-lsp` is installed globally (`npm install -g attractor-lsp`) or
is otherwise on your `PATH`:

```toml
[[language-server.attractor-lsp]]
command = "attractor-lsp"
args = ["--stdio"]
```

---

## Verifying the setup

1. Open a `.dag` file in Helix.
2. Introduce a validation error (e.g. remove the start node). You should see a
   squiggly underline and a diagnostic message in the status bar or via `:lsp-diagnostics`.
3. Run `:format` (or configure `auto-format = true` in your `languages.toml`)
   to trigger format-on-save. The file will be rewritten in canonical DOT form.

---

## Syntax highlighting (optional, out of scope for v1)

Helix uses tree-sitter grammars for syntax highlighting. A dedicated
`tree-sitter-attractor` grammar would give precise highlighting but is out of
scope for this release. To get approximate highlighting today, uncomment the
`grammar = "dot"` line in the `[[language]]` block above — this reuses the
existing DOT grammar, which covers the base DOT syntax used by attractor
pipelines.
