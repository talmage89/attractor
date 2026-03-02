## BUG-002: `promptOnLlmNodesRule` incorrectly flags typed nodes as LLM nodes

- **Status:** FIXED
- **Found during:** Testing / Validation
- **File(s):** `src/validation/rules.ts`
- **Description:** The rule at line 323 uses `node.shape === "box"` to identify LLM nodes. However, all nodes default to `shape: "box"` in `defaultGraphNode()` in `parser.ts`. This means nodes with explicit types like `type=start`, `type=tool`, or `type=exit` are still flagged as LLM nodes without prompts, even though they are not LLM nodes at all.
- **Expected:** Nodes with a non-empty, non-codergen `type` attribute (e.g. `type=start`, `type=exit`, `type=tool`) should NOT be warned about missing prompts.
- **Actual:** Running `attractor validate` on a valid DOT file like `start [type=start]` emits `[warning] (prompt_on_llm_nodes) LLM node 'start' has no prompt or label`.
- **Reproduction:** `validate test-valid-pipeline.dot` where file has `start [type=start]`, `work [type=tool cmd="echo hello"]`, `end [type=exit]`.
- **Fix:** Changed `isLlmNode` condition from `node.shape === "box" || (!node.type && node.shape === "")` to `!node.type && (node.shape === "box" || node.shape === "")`. A node is only an LLM node when it has no explicit type. Added regression test. 356 tests passing.

---

## BUG-001: node_modules committed to git; .gitignore missing

- **Status:** FIXED
- **Found during:** Phase 1 / Project Setup
- **File(s):** `.gitignore`, `node_modules/`
- **Description:** The project has no `.gitignore` file, so `node_modules/` (1752 files) was committed to the repository. This bloats the repo and is incorrect practice.
- **Expected:** A `.gitignore` should exist with at least `node_modules/` listed. The `node_modules/` directory should not be tracked by git.
- **Actual:** No `.gitignore` exists. All of `node_modules/` is tracked and committed.
- **Fix:** Created `.gitignore` with `node_modules/`, `dist/`, `*.tsbuildinfo`. Ran `git rm -r --cached node_modules/` to untrack 1752 files from the index. History still contains the bloat but the working tree is now clean and future commits will ignore `node_modules/`.
