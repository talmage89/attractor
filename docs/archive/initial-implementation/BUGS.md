## BUG-012: Resume fails silently when stored `nodeRetries` exceeds current `maxAttempts`

- **Status:** FIXED
- **Found during:** Testing / Corrupt Checkpoint Files (#29)
- **File(s):** `src/engine/retry.ts`, `src/engine/runner.ts`
- **Description:** When resuming from a checkpoint, `runner.ts` computes `initialAttempt = (nodeRetries.get(currentNode.id) ?? 0) + 1`. This value is passed to `executeWithRetry`, which uses it as the starting index in `for (let attempt = initialAttempt; attempt <= policy.maxAttempts; attempt++)`. If `initialAttempt > policy.maxAttempts` (because the stored retry count in the checkpoint exceeds the current graph's retry policy), the loop never executes. The function falls through to `return { status: "fail", failureReason: "max retries exceeded" }` without ever calling the handler. The node "fails" silently without executing its command.
- **Expected:** On resume, the node should always execute at least once. If the checkpoint's stored retry count exceeds the current policy (e.g., because the user lowered `default_max_retry` or `max_retries` between sessions), `initialAttempt` should be clamped to `maxAttempts` so the handler still runs.
- **Actual:** The node never executes. It immediately returns `{status: "fail", failureReason: "max retries exceeded"}` without running the handler (e.g., without executing `tool_command`).
- **Reproduction:** (1) Create `test-low-retry.dot` with `default_max_retry="2"`. (2) Craft a checkpoint with `currentNode="step1"` and `nodeRetries={"step1": 3}` (simulating a prior run where the node retried 3 times under a higher policy). (3) Resume: `attractor run test-low-retry.dot --resume checkpoint.json`. Observe step1 shows `fail (0.0s)` even though its `tool_command="echo step1_done"` would succeed.
- **Natural reproduction:** Run a pipeline with `default_max_retry=5`, let a node retry 4 times mid-run (checkpoint has `nodeRetries[node]=4`), lower the graph to `default_max_retry=3`, then resume — the node never runs and always fails.
- **Fix:** Added `Math.min(initialAttempt, policy.maxAttempts)` clamp in `executeWithRetry` so the handler always runs at least once, even when the resumed checkpoint's stored retry count exceeds the current policy's `maxAttempts`. Added regression test. 368 tests passing.

---

## BUG-011: `wait.human` user selection overridden by conditional edge on same gate node

- **Status:** FIXED
- **Found during:** Testing / Wait-Human Deep Dive (#26)
- **File(s):** `src/engine/runner.ts`, `src/engine/edge-selection.ts`
- **Description:** `WaitForHumanHandler` communicates the user's selected choice via `suggestedNextIds: [selected.to]` in its outcome. However, `selectEdge` evaluates conditions (Step 1) before consulting `suggestedNextIds` (Step 3). If any outgoing edge from the `wait.human` gate has a `condition=` attribute that evaluates to true (e.g., `condition="outcome=success"`), that edge is selected instead of the one the user chose. The user's explicit selection is silently discarded.
- **Expected:** The user's selection via `wait.human` should always be followed. `suggestedNextIds` from a handler represents an explicit routing decision and should take precedence over condition matching. At minimum, the runner should follow the direct edge to the `suggestedNextIds` target without passing through `selectEdge` condition matching.
- **Actual:** With `gate -> path_b` (first edge, auto-approve picks B) and `gate -> path_a [condition="outcome=success"]` (second edge), the pipeline routes to `path_a` despite the user selecting B. The `[edge_selected]` event shows `path_a` was taken.
- **Reproduction:** Create a `wait.human` node with two edges: first edge goes to `path_b` (no condition), second to `path_a` with `condition="outcome=success"`. Run with `--auto-approve` (auto-approve picks first option = B). Observe that `path_a` is taken instead of `path_b`.
- **Fix:** In `runner.ts`, changed `graph.edges.some(...)` to `graph.edges.find(...)` to get the actual direct edge. Added a new `else` branch for when the direct edge exists: follows it immediately (emitting `edge_selected` with reason "suggested", saving checkpoint, advancing) without calling `selectEdge`. This makes `suggestedNextIds` authoritative for both jump (no direct edge) and direct-edge cases. Added BUG-011 regression test in `runner.test.ts`. 367 tests passing.

---

## BUG-010: `goalGateRetries` counter not persisted in checkpoint — retry budget resets on resume

- **Status:** FIXED
- **Found during:** Testing / Goal Gate Retry Count Across Resume (#23)
- **File(s):** `src/engine/runner.ts`
- **Description:** The `goalGateRetries` variable is initialized to `0` at the start of every `run()` call (line 204) and is never included in any `saveCheckpoint()` call. As a result, resuming a pipeline (via `--resume`) always resets the goal gate retry counter to 0, regardless of how many retries were used in the previous session.
- **Expected:** The goal gate retry counter should be persisted in the checkpoint (like `nodeRetries` is) so that the total number of goal gate retries across all sessions for a given run does not exceed `default_max_retry`.
- **Actual:** Two problematic scenarios:
  1. **Kill mid-retry + resume**: If a pipeline with `default_max_retry=1` runs, goal gate fires (1 retry used), user kills during the 2nd attempt, then resumes — the resumed run allows another full `default_max_retry=1` retries (2 more counter executions). Total: 4 executions instead of 2.
  2. **Resume from completed-fail**: Resuming from a checkpoint where `currentNode=end` (a completed-fail run that exhausted its retry budget) re-runs the exit handler, which triggers the goal gate again with a reset counter of 0, allowing more retries before failing. Total: additional executions beyond the user's configured limit.
  - Only affects `default_max_retry >= 1`. With `default_max_retry=0`, no retries are allowed in any session so the bug has no effect.
- **Reproduction:** Create a DOT file with `default_max_retry=1`, `retry_target="start"`, and an always-failing tool node with `goal_gate=true`. (1) Run it — confirms 2 executions. (2) Kill during the 2nd execution and resume — confirms 2 more executions (4 total instead of 2). (3) Resume from the completed-fail checkpoint — confirms yet another execution.
- **Fix:** Added optional `goalGateRetries?: number` field to `Checkpoint` interface in `checkpoint.ts`. Moved the `goalGateRetries`/`maxGoalGateRetries` declarations before the resume block in `runner.ts` and restored `goalGateRetries = checkpoint.goalGateRetries ?? 0` on resume. Added `goalGateRetries` to all 4 `saveCheckpoint` calls (wrappedOnEvent, jump navigation, edge selection, finalize). Added regression test in `runner.test.ts`. 366 tests passing.

---

## BUG-009: Resume with missing checkpoint node leaves stale `completedNodes`, causing duplicates

- **Status:** FIXED
- **Found during:** Testing / Checkpoint and Resume 2nd pass (#22)
- **File(s):** `src/engine/runner.ts`
- **Description:** When `--resume` is used with a checkpoint whose `currentNode` no longer exists in the graph (e.g., the `.dot` file was edited after the run), the runner emits a warning and falls back to running from `start`. However, it does NOT reset `completedNodes`, `nodeOutcomes`, `contextValues`, or `nodeRetries` from the checkpoint. When the runner subsequently executes nodes that were in the stale `completedNodes` list, they are appended again, creating duplicate entries. The final "Completed nodes" summary and checkpoint file both contain duplicates (e.g., `step1, step1, new_node` instead of `step1, new_node`).
- **Expected:** When the checkpoint node is not found in the graph and the runner falls back to `start`, all checkpoint state (completedNodes, nodeOutcomes, contextValues, nodeRetries, sessionMap) should be reset to initial values, since we are effectively starting a fresh run (not resuming). The user is warned via the `⚠` message that resume didn't land where expected.
- **Actual:** `completedNodes` retains stale entries from the checkpoint. Nodes that ran in the prior (v1 graph) run re-execute and are appended to the stale list, producing duplicates like `['step1', 'step1', 'new_node']` in the final checkpoint.
- **Reproduction:** (1) Create `v1.dot` with nodes `start → step1 → old_node → end`. (2) Run, kill during `old_node`. (3) Create `v2.dot` with nodes `start → step1 → new_node → end` (rename `old_node` to `new_node`). (4) Resume using v2.dot against the v1 checkpoint. Observe "Completed nodes: step1, step1, new_node".
- **Fix:** Moved the `graph.nodes.get(checkpoint.currentNode)` existence check to occur **before** any checkpoint state is restored. If the node doesn't exist, the `else` branch emits the warning and skips all state restoration — `completedNodes`, `nodeOutcomes`, `contextValues`, `nodeRetries`, and `sessionMap` all remain at their initial (empty) values, giving a clean fresh run from start. Also set `isFirstNodeAfterResume = false` in the fallback path (no prior session to continue). Added a BUG-009 regression test in `runner.test.ts`. 365 tests passing.

---

## BUG-008: `auto_status=true` masks CC infrastructure failures

- **Status:** FIXED
- **Found during:** Testing / Session Reuse (#16)
- **File(s):** `src/handlers/codergen.ts`
- **Description:** The `auto_status` check at line 249 uses the condition `node.autoStatus && statusFileAbsent && outcome.status === "fail"`. This fires not only when the CC agent ran but forgot to write a status file, but also when the CC process itself failed entirely (e.g., no API key, process exit code 1). This silently masks infrastructure failures: a node with `auto_status=true` always shows `status: "success"` even if the CC agent never ran. The spec (Section 9.5, step 9) uses `outcome.status === undefined` (which is never true, making it dead code), but the implementation changed it to `"fail"` without restricting to CC-success cases.
- **Expected:** `auto_status=true` should only override the outcome to "success" when the CC process itself succeeded (`ccResult.success=true`). A CC infrastructure failure (process exit code 1, no API key, etc.) should remain "fail" regardless of `auto_status`.
- **Actual:** With `auto_status=true`, any CC failure (including "Claude Code process exited with code 1") is overridden to `{ status: "success", notes: "auto-status: agent completed without writing status.json" }`. The pipeline proceeds as if the node succeeded.
- **Reproduction:** Create a DOT file with `node1 [type=codergen auto_status=true prompt="do something"]`. Run without an API key. Node1 shows "success (0.4s)" in the CLI, and `status.json` shows `{ "status": "success", "notes": "auto-status: agent completed without writing status.json" }`.
- **Fix:** Added `&& ccResult.success` to the auto_status condition in `codergen.ts:249`. The check now reads `node.autoStatus && statusFileAbsent && ccResult.success && outcome.status === "fail"`, which ensures auto_status only fires when the CC process actually ran (not when it failed to start). Updated the existing auto_status test that incorrectly expected "success" on CC failure, and added a comment explaining the guard. 364 tests passing.

---

## BUG-007: Resume from failed run duplicates the failed node in `completedNodes`

- **Status:** FIXED
- **Found during:** Testing / Checkpoint and Resume (#6)
- **File(s):** `src/engine/runner.ts`
- **Description:** When a pipeline run ends with a failed node (e.g., a tool node that exits non-zero with no fail-path edge), the final checkpoint records that node in BOTH `currentNode` AND `completedNodes`. On resume, the runner restores `completedNodes` from the checkpoint (which already includes the failed node), then re-executes the node (since `currentNode` points to it). If the re-execution succeeds, the runner appends the node to `completedNodes` again, resulting in a duplicate entry.
- **Expected:** After a failed run + resume + successful re-execution, each node should appear exactly once in `completedNodes`. `Completed nodes: step1, fixer, step3` (not `step1, fixer, fixer, step3`).
- **Actual:** The failed node appears twice: `Completed nodes: step1, fixer, fixer, step3`. The duplicate also persists in the final checkpoint's `completedNodes` array and `contextValues.__completedNodes` JSON string.
- **Reproduction:** Pipeline: `start → step1 → fixer [cat /tmp/missing.txt] → step3 → end`. Run once (fixer fails). Then create `/tmp/missing.txt` and resume. Output shows `fixer` twice in completed nodes.
- **Fix:** In the checkpoint restore block of `runner.ts`, after restoring `completedNodes`, use `lastIndexOf(checkpoint.currentNode)` to find and `splice` out the resume node if it is already present. Using `lastIndexOf` handles cycles correctly (removes only the most recent occurrence). The node is re-added to `completedNodes` after successful re-execution. Added regression test in `runner.test.ts`. 364 tests passing.

---

## BUG-006: Invalid `model_stylesheet` causes Fatal crash instead of `[error]` diagnostic

- **Status:** FIXED
- **Found during:** Testing / Stylesheet Application (#10)
- **File(s):** `src/engine/transforms.ts`
- **Description:** `applyTransforms()` calls `parseStylesheet(stylesheet)` without wrapping it in try/catch. If the stylesheet string is syntactically invalid (e.g., `"* llm_model: bad }"`), `parseStylesheet` throws, which propagates up as an uncaught exception through `cmdValidate` and `cmdRun`. The global error handler in `main()` catches it and prints `"Fatal: Expected '{' after selector at position 2"` with exit code 3. The expected behavior is that `stylesheetSyntaxRule` in the validator catches the parse error and returns an `[error] (stylesheet_syntax)` diagnostic with exit code 2 for `cmdValidate`.
- **Expected:** `attractor validate <file>` with invalid stylesheet should output `[error] (stylesheet_syntax) Invalid stylesheet syntax: Expected '{' after selector at position 2` with exit code 2. `attractor run <file>` should output the same diagnostic and exit 2 without running.
- **Actual:** Both `validate` and `run` output `Fatal: Expected '{' after selector at position 2` with exit code 3, bypassing the validator entirely.
- **Reproduction:** Create a DOT file with `model_stylesheet = "* llm_model: bad }"` (missing `{`). Run `attractor validate <file>`. Gets "Fatal:" instead of `[error] (stylesheet_syntax)`.
- **Fix:** Wrapped `parseStylesheet(stylesheet)` call in `applyTransforms` in a try/catch that silently ignores errors. The validator's `stylesheetSyntaxRule` detects and reports the error as a proper diagnostic. Added regression test in `test/engine/transforms.test.ts`. 363 tests passing.

---

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
