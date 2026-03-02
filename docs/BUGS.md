## BUG-020: Invalid `weight` value on an edge becomes NaN, causing declaration-order-dependent edge selection

- **Status:** FIXED
- **Found during:** Testing / Edge Weight Priority (#46)
- **File(s):** `src/parser/parser.ts`, `src/engine/edge-selection.ts`
- **Description:** When an edge has a `weight` attribute with a non-numeric string value (e.g., `weight="not_a_number"` or `weight="abc"`), the parser calls `parseInt(value, 10)` which returns `NaN`. This NaN is stored in `edge.weight`. In `pickBestEdge()` in `edge-selection.ts`, the comparison `e.weight > best.weight` with NaN always returns false (NaN comparisons are always false in JavaScript). Similarly, the tiebreak check `e.weight === best.weight` with NaN also returns false. As a result, the initial `best = edges[0]` is never replaced, and the **first-declared edge in the DOT file always "wins"** among unconditional edges when any edge has a NaN weight. This is incorrect — the spec defines a deterministic priority algorithm based on weight values, but NaN defeats the comparison entirely.
- **Expected:** Invalid edge weight strings should fall back to the default weight (0) silently (matching the behavior of unset weight). Optionally, the validator should emit a `[warning] (invalid_edge_weight)` diagnostic for non-integer weight values. The edge selection algorithm should never produce declaration-order-dependent results.
- **Actual:** Declaration-order-dependent edge selection when any edge has a non-numeric weight. With `work -> path_a [weight="bad"]` declared before `work -> path_b [weight=1]`, `path_a` is always selected (even though weight=NaN < weight=1). With the declaration order swapped, `path_b` is always selected. Neither `validate` nor `run` emits any warning about the invalid weight.
- **Note:** This is analogous to BUG-018 (`default_max_retry` non-integer → NaN → all nodes fail), but for edge weights. In this case, the failure mode is incorrect routing rather than node execution failure. Also note: `parseFloat` would be required for float weights (which the spec shows as `number` type), but the current implementation uses `parseInt`, silently truncating floats like `1.8 → 1`. The NaN fix for invalid strings is the critical issue.
- **Fix:** In `edge-selection.ts`, changed `bestByWeightThenLexical()` to use a helper `w(e) = isNaN(e.weight) ? 0 : e.weight` for all comparisons, so NaN weights are treated as 0 (the default). Added `invalidEdgeWeightRule` to `validation/rules.ts` that checks `Number.isNaN(edge.weight)` and emits `[warning] (invalid_edge_weight)` for each affected edge. Added fixture `WITH_INVALID_EDGE_WEIGHT` and 2 parser tests, 2 edge-selection tests, and 4 validator tests. 393 tests passing.
- **Reproduction:**
  ```dot
  digraph g {
    start [shape=Mdiamond]
    work [type=tool tool_command="echo done"]
    path_a [type=tool tool_command="echo path_a"]
    path_b [type=tool tool_command="echo path_b"]
    end [shape=Msquare]
    start -> work
    work -> path_a [weight="not_a_number"]
    work -> path_b [weight=1]
    path_a -> end
    path_b -> end
  }
  ```
  Run: `attractor run test.dot --logs ./logs`. `path_a` is selected (declaration order wins) despite `path_b` having weight=1.
  Swap the two edge declarations: now `path_b` is selected. Both behaviors are wrong — `path_b` (weight=1 > 0 default) should always win, regardless of declaration order.

---

## BUG-019: Subgraph with empty-derived class appends trailing comma to node's existing `class=` attribute

- **Status:** FIXED
- **Found during:** Testing / Subgraph Features (#43)
- **File(s):** `src/parser/parser.ts`
- **Description:** When a subgraph has a `label` attribute whose derived class name is empty (e.g. `label = "!!!"` where all characters are stripped by `deriveClassName`), the empty string `""` is pushed to `subgraphClassStack`. In the node-creation code, the class appending loop runs for every entry in `subgraphClassStack`. For a node with an existing `class=` attribute (e.g. `class=existing`), the check `["existing"].includes("")` is false, so the code appends the empty string: `node.className = "existing" + "," + "" = "existing,"`. The trailing comma in `className` is incorrect data. For nodes without an existing class, the case `if (!node.className)` fires and assigns `""` to `""`, which is harmless.
- **Expected:** When `deriveClassName(label)` returns an empty string, no class should be added to nodes inside the subgraph. Either the empty class should not be pushed to `subgraphClassStack`, or the class appending loop should skip empty class names via `if (!cls) continue`.
- **Actual:** `node.className = "existing,"` (trailing comma) instead of `"existing"`. Stylesheet class selectors still work because the applicator uses `split(",").map(c => c.trim()).includes(selector.className)`, which handles the trailing comma gracefully. However, the className data is incorrect and would fail any strict string-equality check.
- **Reproduction:**
  ```dot
  digraph g {
    start [shape=Mdiamond]
    subgraph s {
      label = "!!!"
      step1 [type=tool tool_command="echo x" class=existing]
    }
    end [shape=Msquare]
    start -> step1 -> end
  }
  ```
  Parse and inspect: `g.nodes.get('step1').className === "existing,"` (expected `"existing"`).
- **Fix:** In `parseSubgraph()`, after calling `deriveClassName(subgraphLabel)`, check the result is non-empty before pushing: `const derivedClass = deriveClassName(subgraphLabel); if (derivedClass) this.subgraphClassStack.push(derivedClass);`. Empty strings from all-special-char labels like `"!!!"` are now silently skipped rather than pushed onto the stack. Added fixture `WITH_SUBGRAPH_EMPTY_DERIVED_CLASS` and 2 regression tests. 385 tests passing.

---

## BUG-018: `default_max_retry` with a non-integer value causes NaN, silently failing all nodes

- **Status:** FIXED
- **Found during:** Testing / DOT Grammar Edge Cases (#42)
- **File(s):** `src/parser/parser.ts`, `src/engine/retry.ts`
- **Description:** When `default_max_retry` is set to a non-integer string value (e.g. `default_max_retry = "abc"`, `default_max_retry = "invalid"`, or `default_max_retry = ""`), the parser calls `parseInt(value, 10)` which returns `NaN`. This NaN is stored in `graph.attributes.defaultMaxRetry`. In `buildRetryPolicy()`, `maxRetries = NaN` (since `node.maxRetries > 0` is false for the default 0), producing `maxAttempts = NaN + 1 = NaN`. In `executeWithRetry`, the BUG-012 clamp `startAttempt = Math.min(1, NaN) = NaN`, and the loop `for (attempt=NaN; attempt<=NaN; attempt++)` never executes (NaN comparisons are always false). Every node immediately returns `{ status: "fail", failureReason: "max retries exceeded" }` without ever calling its handler. This affects ALL nodes — start, tool, codergen, and exit — so the entire pipeline silently fails without executing any work. Neither `attractor validate` nor `attractor run` emits any error or warning for an invalid `default_max_retry` value.
- **Expected:** Either (a) `validate` should emit a warning like `[warning] (invalid_default_max_retry) default_max_retry "abc" is not a valid integer; using default (50)` and `run` should fall back to the default value of 50; or (b) `validate` should emit an error with exit code 2 and refuse to run the pipeline. An invalid `default_max_retry` should never silently cause all nodes to fail.
- **Actual:** All nodes fail with `fail (0.0s)` and `failureReason: "max retries exceeded"` without executing. The pipeline reports `Status: fail` with exit code 1. No parse error, no validation error, no warning. The bug is completely invisible to the user.
- **Note:** Node-level `max_retries="bad"` is NOT affected: `parseInt("bad", 10) = NaN`, but `NaN > 0` is false, so `buildRetryPolicy` correctly falls back to `graph.attributes.defaultMaxRetry`. Only the graph-level `default_max_retry` attribute lacks this safety check.
- **Fix:** In `parser.ts` `applyGraphAttributeKV`, wrapped the `parseInt` call for `default_max_retry` in a `Number.isNaN` guard — if the parsed value is NaN, the default (50) is kept unchanged. Added `invalidDefaultMaxRetryRule` to `validation/rules.ts` that reads the raw attribute value from `graph.attributes.raw` and emits a `[warning] (invalid_default_max_retry)` diagnostic when the raw value is not a valid integer. Added 3 parser tests and 4 validator tests. 383 tests passing.
- **Reproduction:**
  ```dot
  digraph g {
    default_max_retry = "invalid"
    start [shape=Mdiamond]
    work [type=tool tool_command="echo this_should_run"]
    end [shape=Msquare]
    start -> work
    work -> end
  }
  ```
  Run: `attractor run test.dot --logs ./logs`. Every node shows `fail (0.0s)`. `echo this_should_run` never executes. Also triggered by `default_max_retry = ""` (empty string) or any non-numeric string.

---

## BUG-017: Multiple attribute blocks on the same node/edge statement — only first block is parsed

- **Status:** FIXED
- **Found during:** Testing / DOT Default Node/Edge Attribute Blocks (#37)
- **File(s):** `src/parser/parser.ts`
- **Description:** When a node or edge statement has multiple consecutive attribute blocks (e.g., `work [type=tool] [tool_command="echo hello"]`), only the first block is parsed. The second (and any subsequent) blocks are silently discarded. The DOT format explicitly supports multiple attribute blocks on a single statement — they should be merged together. The root cause is in `parseIdentifierStatement()`: after parsing the first `LBRACKET...RBRACKET` block, `consumeOptionalSemicolon()` is called and the function returns. The parser then returns to `parseStatements()` where the next `[` (LBRACKET) token is not matched by any of the `if` branches and falls through to `// Skip unknown tokens → this.advance()`, which silently consumes just the `[`. The interior key-value pairs of the second block are then parsed as top-level graph attributes (the `IDENTIFIER = value` branch in `parseIdentifierStatement()`), and the closing `]` is also silently skipped.
- **Expected:** Multiple attribute blocks on the same node/edge statement should be merged: `work [type=tool] [tool_command="echo hello"]` should produce a node with both `type=tool` and `tool_command="echo hello"`. This is standard DOT format behavior — the DOT grammar defines `attr_list: '[' a_list ']' attr_list?` as recursive, explicitly allowing chained blocks.
- **Actual:** Only the first block is applied. `work [type=tool] [tool_command="echo hello"]` produces a node with `type=tool` but `tool_command` is absent. When this node executes, ToolHandler reports `"No tool_command specified"` and the node fails with `status: "fail"`. No parse error or warning is emitted — the behavior is completely silent.
- **Reproduction:**
  ```dot
  digraph g {
    start [shape=Mdiamond]
    work [type=tool] [tool_command="echo two_block_test"]
    end [shape=Msquare]
    start -> work
    work -> end
  }
  ```
  Run: `attractor run test.dot --logs ./logs`. The `work` node fails with `"No tool_command specified"` despite the second attribute block providing it.

  Same issue affects edge statements:
  ```dot
  work -> target [condition="outcome=fail"] [label="failure route"]
  ```
  The edge gets the `condition` from the first block but silently loses the `label` from the second block.
- **Fix:** In `parseIdentifierStatement()`, replaced the single `this.check("LBRACKET") ? this.parseAttrBlock() : new Map<string, string>()` expressions with a `while (this.check("LBRACKET"))` loop that merges all consecutive attribute blocks via `for (const [k,v] of this.parseAttrBlock()) attrs.set(k, v)`. Applied to both the node declaration path and the edge chain path. Added fixture `WITH_MULTI_ATTR_BLOCKS` and 2 regression tests. 376 tests passing.

---

## BUG-016: Quoted node IDs silently discarded — produces empty graph with misleading validation errors

- **Status:** FIXED
- **Found during:** Testing / Malformed DOT Files (#36)
- **File(s):** `src/parser/parser.ts`
- **Description:** When a DOT file uses quoted strings as node IDs (e.g., `"start" [shape=Mdiamond]`), the parser silently discards these declarations without any error or warning. This is because `parseStatement()` handles `IDENTIFIER` tokens as node/edge starts, but when it sees a `STRING` token (a quoted identifier) it falls through to the `// Skip unknown tokens; this.advance()` catch-all, consuming just the token and moving on. As a result, the entire quoted-ID node declaration is silently dropped.
- **Expected:** Either (a) quoted strings should be accepted as valid node IDs (DOT format supports this), or (b) the parser should throw a clear parse error like `"Parse error: quoted string identifiers are not supported as node IDs at line N"`. The current behavior of silently discarding is never correct — users should always get a clear diagnostic.
- **Actual:** Two failure modes depending on usage:
  1. **All-quoted node IDs** (e.g., `"start" [shape=Mdiamond]` `"work" -> "end"`): The parser silently discards every statement, producing an empty graph (0 nodes, 0 edges). The validator then reports misleading errors: `[error] (start_node) Graph has no start node` and `[error] (terminal_node) Graph has no exit node`. No parse error is emitted; the CLI exits with code 2 instead of code 3.
  2. **Mixed: unquoted source → quoted target in edge** (e.g., `start -> "work"`): The parser starts parsing the edge (since `start` is an IDENTIFIER), then throws `Fatal: Parse error: expected identifier after '->' at line N` when it encounters the STRING token as the edge target. This gives a clear but cryptic parse error (exit code 3).
- **Reproduction:**
  ```dot
  digraph g {
    "start" [shape=Mdiamond]
    "work" [type=tool tool_command="echo hi"]
    "end" [shape=Msquare]
    "start" -> "work"
    "work" -> "end"
  }
  ```
  Run: `attractor validate test.dot`. Outputs `[error] (start_node) Graph has no start node` despite `"start"` being declared with `shape=Mdiamond`. No parse error — the entire graph body was silently dropped.
- **Root cause:** `parseStatement()` in `parser.ts` only handles `IDENTIFIER` tokens as node/edge statement starts. When the first token of a statement is `STRING` (a quoted identifier like `"start"`), the default `this.advance()` branch silently skips it. The subsequent `[shape=Mdiamond]` attribute block, `->` edge tokens, etc. are also silently consumed one token at a time by repeated calls to `this.advance()`, so no error is ever thrown.
- **Fix:** Added `parseNodeId()` helper in `parser.ts` that accepts either `IDENTIFIER` or `STRING` tokens. Updated `parseStatement()` to dispatch `STRING`-headed statements to `parseIdentifierStatement()` (same as `IDENTIFIER`). Updated `parseIdentifierStatement()` to use `parseNodeId()` for the initial token and after each `->`, also accepting `STRING` tokens as edge targets. Added fixtures `WITH_QUOTED_NODE_IDS` and `WITH_MIXED_QUOTED_NODE_IDS` and 2 regression tests. 374 tests passing.

---

## BUG-015: `spawn ENOTDIR` (file path as `--cwd`) silently retries 51 times with exponential backoff, hanging for many minutes

- **Status:** FIXED
- **Found during:** Testing / `--cwd` flag and `$goal` substitution (#34)
- **File(s):** `src/handlers/tool.ts`
- **Description:** When `--cwd` is set to a FILE path (e.g., `--cwd /etc/hostname`) instead of a directory, Node.js's `spawn()` throws **synchronously** with `Error: spawn ENOTDIR`. This synchronous throw propagates through the `new Promise()` constructor in `runShellCommand`, causing the Promise to be **rejected** (not resolved). When the `await runShellCommand(...)` in `ToolHandler.execute` receives this rejection, it re-throws, which is caught by `executeWithRetry`'s catch block. Since it's an exception (not a "fail" outcome), `executeWithRetry` treats it as a retryable error and retries up to `maxAttempts - 1 = 50` times (with default `default_max_retry=50`), with exponential backoff (up to 60s per retry). The pipeline hangs in "running..." state for potentially 30-50+ minutes with no visible output (unless `--verbose` is used, which shows `stage_retrying` events). This is inconsistent with the ENOENT case (non-existent cwd), where `spawn` does NOT throw synchronously — it fires an "error" event, which the `on("error", ...)` handler catches and **resolves** the Promise with a fail result, properly triggering a "fail" outcome without retry.
- **Expected:** A FILE path as `--cwd` should fail immediately with a clear error message (e.g., `"spawn ENOTDIR: not a directory"`) after one attempt, not retry 51 times silently.
- **Actual:** The tool node retries 51 times over many minutes (due to exponential backoff with `maxDelay=60s`). Without `--verbose`, the user sees `● work → running...` indefinitely.
- **Reproduction:**
  ```dot
  digraph g {
    start [shape=Mdiamond]
    work [type=tool tool_command="pwd"]
    end [shape=Msquare]
    start -> work
    work -> end
  }
  ```
  Run: `attractor run test.dot --cwd /etc/hostname --logs ./logs`. The `work` node stays "running..." forever (use `timeout 60 attractor ...` to see the eventual fail).
- **Root cause:** In `runShellCommand`, `spawn()` can throw synchronously (ENOTDIR) or emit an "error" event asynchronously (ENOENT). The synchronous throw escapes the `on("error", ...)` handler and propagates as a Promise rejection, which `executeWithRetry` interprets as a transient error. The ENOENT case works because the "error" event handler calls `resolve(...)` (not `reject`), producing a "fail" outcome that bypasses the retry logic.
- **Fix:** Wrapped the `spawn()` call in a `try/catch` inside `runShellCommand`. If spawn throws synchronously, the catch calls `resolve({ stdout: "", stderr: err.message, exitCode: 1, timedOut: false })` immediately and returns, matching the behavior of the async "error" event handler for ENOENT. This prevents the synchronous throw from reaching `executeWithRetry`. Added a regression test that passes a file path as `cwd` to `runShellCommand` and verifies the Promise resolves (not rejects) with exitCode=1. 372 tests passing.

---

## BUG-014: Unconditional `loop_restart=true` edge causes infinite restart loop, eventually crashing with ENAMETOOLONG

- **Status:** FIXED
- **Found during:** Testing / Loop Restart Edge Feature (#33)
- **File(s):** `src/engine/runner.ts`
- **Description:** When an edge has `loop_restart=true` and its condition always matches (or has no condition), the `run()` function restarts in an infinite recursion. Each restart creates a new sibling logsRoot by appending `-restart-<timestamp>` to the current `config.logsRoot`. After ~12 restarts, the path string exceeds the OS file-name length limit (typically 255 bytes on Linux ext4 for a single path component, or 4096 bytes for the full path). The `fs.mkdir(logsRoot, { recursive: true })` call throws `ENAMETOOLONG`, which propagates as an unhandled exception to `main()` and prints `Error: ENAMETOOLONG: name too long, mkdir '<path>'` with exit code 3. The error message gives no indication that the root cause is an infinite loop_restart chain.
- **Expected:** Either (a) the system should limit the depth of loop_restart chains (e.g., cap at 100 restarts and fail with a clear error `"loop_restart exceeded maximum depth of 100"`), or (b) the logsRoot naming should use a counter-based flat scheme (`<base>-restart-1`, `<base>-restart-2`) so the path length stays constant regardless of restart depth — though this doesn't prevent infinite loops. Option (a) is safer as it also detects the infinite-loop bug instead of crashing with a cryptic OS error.
- **Actual:** The process loops indefinitely, consuming memory (each `run()` call is on the stack), until the logsRoot path exceeds OS limits and crashes with `Error: ENAMETOOLONG: name too long, mkdir '...'` (exit code 3). No meaningful error message is shown; the user must manually inspect the path to understand what happened.
- **Reproduction:**
  ```dot
  digraph infinite {
    start [shape=Mdiamond]
    work [type=tool tool_command="echo looping"]
    end [shape=Msquare]
    start -> work
    work -> end [loop_restart=true]
  }
  ```
  Run: `attractor run infinite.dot --logs ./logs/test`. After ~12 restarts, crashes with ENAMETOOLONG.
  Also reproduced via `wait.human` + `--auto-approve` when the auto-approved option's edge has `loop_restart=true`.
- **Note:** In practice, users should always use a condition on loop_restart edges (e.g., `condition="context.some_key=retry"`) to prevent infinite loops. The bug is a missing safeguard — there's no spec-specified maximum restart depth, and the implementation adds none.
- **Fix:** Added `MAX_LOOP_RESTART_DEPTH = 100` constant and `loopRestartDepth`/`loopRestartBase` fields to `RunConfig`. Both loop-restart spots in `runner.ts` (suggestedNextIds path and selectEdge path) now check the depth before recursing; if `depth >= 100`, a `warning` event is emitted (`"loop_restart exceeded maximum depth of 100"`) and the run terminates with `fail`. The logsRoot naming was also changed from timestamp-chaining (`<base>-restart-<ts>-restart-<ts2>`) to counter-based flat scheme (`<base>-restart-N`) using `loopRestartBase` to track the original path — keeping the directory name length constant regardless of restart count. Added 2 regression tests. 371 tests passing.

---

## BUG-013: Subgraph class derivation skips nodes declared before `label =` statement

- **Status:** FIXED
- **Found during:** Testing / Subgraph Features (#30)
- **File(s):** `src/parser/parser.ts`
- **Description:** When a subgraph has a `label =` attribute, the parser derives a class name and adds it to all nodes inside the subgraph. However, the parser processes statements sequentially, so nodes declared **before** the `label =` statement are built before the class is pushed onto `subgraphClassStack`. As a result, those nodes receive an empty `className` and are NOT targeted by stylesheet class selectors (`.derived-class { ... }`) and do NOT derive a `thread_id` via class-based thread resolution.
- **Expected:** Per spec Section 4 ("Add this class to every node inside the subgraph (append to existing `class` attribute if present)"), ALL nodes inside the subgraph should receive the derived class, regardless of where `label =` appears in the subgraph body.
- **Actual:** Only nodes declared AFTER `label =` in the subgraph body get the class. Nodes declared before `label =` have `className=""` and are silently excluded from stylesheet class targeting and class-based thread_id resolution.
- **Reproduction:** Create a DOT file with:
  ```dot
  model_stylesheet = ".highlight { llm_model: highlighted-model }"
  subgraph cluster {
    before_node [type=tool]
    label = "highlight"
    after_node [type=tool]
  }
  ```
  Parse and inspect: `before_node.className=""`, `after_node.className="highlight"`. Only `after_node` gets `llm_model: highlighted-model` from the stylesheet. If these were codergen nodes, `before_node` would silently use the wrong model or fail to share a thread session.
- **Fix:** Added `findSubgraphLabel()` lookahead helper in `parser.ts` that scans ahead (tracking brace/bracket depth) to find the top-level `label = ...` in the subgraph body without consuming tokens. `parseSubgraph()` now calls it upfront and pushes the derived class onto `subgraphClassStack` before parsing any statements (two-pass approach). The existing `label = ...` consumer in the loop skips the class-push since it was already done. Added fixture `WITH_SUBGRAPH_LABEL_AFTER_NODES` and regression test. 369 tests passing.

---

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
