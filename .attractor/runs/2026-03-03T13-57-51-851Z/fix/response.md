Done. Here's a summary of what was fixed:

**FINDING-001 — Root cause:** In `CstParser.parseStatement()`, the `GRAPH` keyword branch returned `null` when not followed by `[`. This left the `->` and target node tokens unconsumed, causing them to be misparsed in subsequent iterations — the arrow was skipped, and the target node appeared as a duplicate bare declaration.

**Fix:** Added `return this.parseAfterFirstId("graph")` as the fallback, consistent with how the `NODE` and `EDGE` keyword branches already work (lines 154 and 164).

**Tests added (3):**
- `graph -> b` edge preserved correctly in formatter output
- `node -> b` edge preserved (regression guard for existing behavior)  
- `edge -> b` edge preserved (regression guard for existing behavior)

**Results:** 419 tests pass (393 attractor + 26 attractor-lsp). Build and typecheck clean.