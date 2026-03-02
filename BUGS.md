## BUG-005: Condition evaluator does not trim resolved context values before comparison

- **Status:** FIXED
- **Found during:** Testing / Context Propagation (#14)
- **File(s):** `src/conditions/evaluator.ts`
- **Description:** The spec (Section 13, line 1772) says equality comparison is "case-sensitive, trimmed", implying both sides of the comparison should be trimmed. The condition parser already trims the clause value (`clause.value = clause.slice(eqIdx + 1).trim()`), but the resolved context value is never trimmed. Tool nodes store their stdout as-is in `tool.output`, which always includes a trailing newline from shell commands like `echo`. As a result, `context.tool.output=linux` FAILS when the tool ran `echo linux` (which stores `"linux\n"`), because `"linux\n" !== "linux"`. The user must use `printf linux` (no newline) to get the match to work, which is non-obvious.
- **Expected:** Condition equality comparison should trim the resolved value before comparing, so `context.tool.output=linux` matches when `echo linux` was run (output: `"linux\n"`). This aligns with the spec's "trimmed" qualifier and makes conditions practical for echo-based tool output.
- **Actual:** `context.tool.output=linux` does not match when the tool output is `"linux\n"`. The comparison is `"linux\n" !== "linux"` which is true (mismatch), so the condition evaluates to false. Users must strip trailing newlines manually (e.g., use `printf` or `tr -d '\n'`).
- **Reproduction:** Create a pipeline: `tool [type=tool tool_command="echo linux"]`, edge condition `context.tool.output=linux`. The condition does not match. Switching to `tool_command="printf linux"` makes it match.
- **Fix:** Changed `resolveKey(...)` call in `evaluateCondition` to `.trim()` the resolved value before comparing. Added 2 regression tests. 362 tests passing.

---

## BUG-004: Parallel branches re-execute after `ParallelHandler` completes; runner has no jump-to-fan-in mechanism

- **Status:** FIXED
- **Found during:** Testing / Parallel Execution (#13)
- **File(s):** `src/handlers/parallel.ts`, `src/engine/runner.ts`
- **Description:** `ParallelHandler.execute()` runs all branch nodes internally (via `executeBranch`) before returning. After it returns, the outer runner calls `selectEdge(graph, fanoutNode, outcome, context)` to determine the next node. Since the only outgoing edges from the parallel (fan-out) node go to the branch nodes (e.g. `fanout -> branch_a`, `fanout -> branch_b`, `fanout -> branch_c`), `selectEdge` picks one of the branch nodes (the lexically-first one: `branch_a`). The runner then executes `branch_a` again. Execution then follows `branch_a -> fanin`, and the runner continues normally. The net result is: `branch_a` executes **twice** (once inside `ParallelHandler`, once by the outer runner), while `branch_b` and `branch_c` execute **only once** (inside `ParallelHandler`). The CLI progress output also only shows `branch_a` running — branches b and c are completely invisible to the outer runner.
- **Expected:** After `ParallelHandler` runs all branches internally, the outer runner should advance directly to the fan-in node (the first `shape=tripleoctagon` or `type=parallel.fan_in` node reachable from the branches), **without re-executing any branch node**.
- **Actual:** The runner re-executes one branch (lexically first by node ID) and silently skips the rest. The checkpoint reflects branch_a in `completedNodes` but not branch_b or branch_c. `parallel.results` correctly contains all 3 results (set by ParallelHandler), but the runner's traversal is semantically wrong.
- **Reproduction:** Create a DOT file with `fanout [shape=component]`, three branches (`branch_a`, `branch_b`, `branch_c`, each `shape=parallelogram`), and a `fanin [shape=tripleoctagon]` node. Run with tool_commands like `echo branch_X_done`. Observe that: (a) CLI only shows branch_a running, (b) checkpoint `completedNodes` contains only `branch_a` (not b/c), (c) the echo command for branch_a runs twice (visible in tool.output reflecting branch_a's output).
- **Proposed fix:** `ParallelHandler` should identify the fan-in node (by traversing the first branch until a fan-in is reached) and include it in the outcome as `suggestedNextIds: [fanInNodeId]`. The runner should then be modified to support "jump" navigation: if `suggestedNextIds` contains an ID with no direct edge from the current node, advance to that node directly (i.e., set `currentNode = graph.nodes.get(suggestedNextIds[0])` without requiring an edge). This allows the runner to skip from the parallel node to the fan-in without traversing the branches again.
- **Fix:** Added `findFanInNodeId()` BFS helper to `parallel.ts`; `execute()` now includes `suggestedNextIds: [fanInId]` in its outcome. In `runner.ts`, before `selectEdge`, added a jump check: if `outcome.suggestedNextIds[0]` is valid and has no direct edge from the current node, the runner emits `edge_selected` (reason: "jump"), saves a checkpoint, and advances directly to the suggested node. Added 3 new tests (2 unit + 1 integration). 360 tests passing.

---

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
