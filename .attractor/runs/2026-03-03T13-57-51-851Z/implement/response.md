Both findings resolved:

**FINDING-001**: Updated `vscode-languageserver` from `^9.0.0` to `10.0.0-next.16` (v10 stable doesn't exist yet — only `10.0.0-next.16` is available). Also updated import paths in all source/test files from `vscode-languageserver/node.js` → `vscode-languageserver/node` to match the v10 package's `exports` map.

**FINDING-002**: In `parseStatement()`, added `this.graph.attributeSpans!.set("graph"/"node"/"edge", this.spanFrom(t))` after `consumeOptionalSemicolon()` for each defaults block path. Uses the existing `t = this.peek()` captured at the top of the method as the start token.

All 413 tests pass (393 attractor + 20 attractor-lsp). Committed and pushed.