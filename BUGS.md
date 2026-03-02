## BUG-003: Invalid `timeout` value silently becomes `NaN`, killing commands immediately

- **Status:** FIXED
- **Found during:** Testing / Malformed DOT files
- **File(s):** `src/parser/parser.ts`, `src/handlers/tool.ts`
- **Description:** When a node has a `timeout` attribute with an invalid duration string (e.g., `timeout="notaduration"`), `parseDurationToMs()` returns `NaN` via `parseFloat()`. This `NaN` is stored as `node.timeout`. In `ToolHandler.execute`, the fallback `node.timeout ?? 30_000` does NOT catch `NaN` (the `??` operator only catches `null`/`undefined`), so `timeoutMs = NaN` is passed to `setTimeout`. JavaScript's `setTimeout(fn, NaN)` treats the delay as `0`, causing the timer to fire at the next event loop tick — immediately killing the child process before it has a chance to run.
- **Expected:** An invalid timeout value should either (a) be silently ignored (falling back to the 30s default) or (b) be rejected with a parse/validation error. Commands should NOT be silently killed.
- **Actual:** `sleep 2 && echo done` with `timeout="notaduration"` completes in 0.0s with `fail` status. The command is killed before it can run.
- **Reproduction:** Create a DOT file with `work [type=tool tool_command="sleep 2 && echo done" timeout="notaduration"]`. Run it. The `work` node completes in `0.0s` with `fail` status instead of running for ~2 seconds.
- **Fix:** Changed `parseTimeout` return type to `number | null`; returns `null` when `parseFloat` produces a non-finite value. `ToolHandler`'s `node.timeout ?? 30_000` then correctly falls back to the default. Added regression test. 357 tests passing.

---

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
