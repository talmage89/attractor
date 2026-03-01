# Code Review Report

**Date:** 2026-03-01
**Reviewer:** eleventh-pass
**Test Status:** All passing (268/268)

## Summary

The Attractor codebase is in very good shape after ten prior review cycles. All tests pass and the core execution engine is solid. This review identifies one HIGH correctness bug (`isTerminal` missing id-based exit node detection), three MEDIUM findings (spec ambiguity on FAIL retry, missing retry unit tests, path traversal in CodergenHandler), and a collection of LOW/TRIVIAL findings covering test gaps, minor spec deviations, and code quality.

---

## Findings

### FINDING-001: `isTerminal` does not recognise id-based exit nodes — runner skips goal gate

- **Severity:** HIGH
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/model/graph.ts:78-80`, `src/validation/rules.ts:41-54`
- **Description:** `findExitNode` returns a node if its id is `'exit'` or `'end'`. `terminalNodeRule` likewise accepts those ids as valid exit nodes. However `isTerminal` only checks `node.shape === 'Msquare' || node.type === 'exit'` — it never checks `node.id`. If a pipeline uses a node named `exit` (or `end`) without also setting `shape=Msquare` or `type=exit`, validation passes and `findExitNode` returns the node, but `isTerminal` returns `false`. The runner therefore treats the node as a regular work node, executes it, then calls `selectEdge` which returns `null` (no outgoing edges from the exit node), breaks out of the loop — without passing through the goal gate or emitting the terminal-node events.

  Reproducible example:
  ```dot
  digraph G {
    a [shape=box, prompt="Do A"]
    start -> a -> exit
  }
  ```
  This passes validation, `findExitNode` returns `exit`, but `isTerminal(exitNode)` is `false`.

- **Recommendation:** Update `isTerminal` to also check `node.id`:
  ```typescript
  return node.shape === 'Msquare' || node.type === 'exit' || node.id === 'exit' || node.id === 'end';
  ```
  Add a test that uses an id-based exit node (no shape/type) and verifies the goal gate is checked and the run terminates correctly.

---

### FINDING-002: `ParallelHandler` does not aggregate `costUsd` from branch outcomes

- **Severity:** LOW
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/handlers/parallel.ts:140-171`
- **Description:** When parallel branches contain codergen nodes, each branch accumulates `costUsd` in its `Outcome`. `ParallelHandler.execute` discards all branch outcomes after recording counts/statuses — it never sums `costUsd`:

  ```typescript
  return { status, contextUpdates }; // no costUsd
  ```

  The runner adds `outcome.costUsd ?? 0` to `totalCostUsd` for each node (including the parallel node), so all cost from inside parallel branches is silently lost. Pipelines with codergen nodes inside parallel handlers under-report `RunResult.totalCostUsd`.

- **Recommendation:** Sum `costUsd` from all branch outcomes and include it in the returned `Outcome`:
  ```typescript
  const totalBranchCostUsd = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  return {
    status,
    contextUpdates,
    ...(totalBranchCostUsd > 0 ? { costUsd: totalBranchCostUsd } : {}),
  };
  ```
  Add a test that runs parallel branches with mocked codergen costs and verifies `RunResult.totalCostUsd` includes them.

---

### FINDING-003: Path traversal risk in `CodergenHandler` via node id

- **Severity:** MEDIUM
- **Category:** Security
- **Status:** RESOLVED
- **File(s):** `src/handlers/codergen.ts:168-173`
- **Description:** The stage directory is constructed as `path.join(config.logsRoot, node.id)`. If a DOT file declares a node with a quoted string id containing `..` path segments (e.g., `"../../etc/cron.d"`), `path.join` resolves the traversal, and `prompt.md`, `response.md`, and `status.json` are written outside the intended logs directory. The DOT parser's `IDENTIFIER` token (`[A-Za-z0-9_.]`) does not allow `/`, but quoted string identifiers can contain arbitrary characters.

  ```typescript
  const stageDir = path.join(config.logsRoot, node.id); // node.id could be '../../evil'
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, 'prompt.md'), finalPrompt, 'utf-8');
  ```

- **Recommendation:** Add a path-safety assertion before writing:
  ```typescript
  const stageDir = path.join(config.logsRoot, node.id);
  if (!path.resolve(stageDir).startsWith(path.resolve(config.logsRoot) + path.sep)) {
    throw new Error(`Node id '${node.id}' would escape logsRoot`);
  }
  ```
  Also add a validation rule that rejects node ids containing `/`, `\`, or `..` segments.

---

### FINDING-004: Spec DoD 17.5 says `FAIL` triggers retry but Section 8.5 algorithm and implementation disagree

- **Severity:** MEDIUM
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/engine/retry.ts:89-91`, `docs/SPEC.md` (Section 17.5 vs Section 8.5)
- **Description:** SPEC.md Section 17.5 Definition of Done states: *"Nodes with `maxRetries > 0` retried on RETRY or FAIL"*. However, the more detailed pseudocode in Section 8.5 says `IF outcome.status is "fail": RETURN outcome` — no retry. The implementation follows Section 8.5. A test explicitly asserts that FAIL does **not** trigger retry. The DoD checklist and the detailed algorithm are in direct contradiction.

- **Recommendation:** Resolve the internal spec inconsistency. Most likely the correct intent is *"retried on RETRY status only"* (the conservative behaviour already implemented). Update SPEC.md Section 17.5 to read: `"Nodes with maxRetries > 0 retried on RETRY status"`. No code change required.

---

### FINDING-005: No unit tests for `retry.ts` — backoff math, `allowPartial` path, and `buildRetryPolicy` untested

- **Severity:** MEDIUM
- **Category:** Test Quality
- **Status:** RESOLVED
- **File(s):** `src/engine/retry.ts`, `test/engine/`
- **Description:** There is no `test/engine/retry.test.ts`. The following behaviours are not directly tested:
  1. `delayForAttempt` backoff formula and the 60,000 ms cap.
  2. Jitter range (`0.5 + Math.random()` → 50–150 % of base delay).
  3. `buildRetryPolicy` fallback from `node.maxRetries === 0` to `graph.attributes.defaultMaxRetry`.
  4. The `allowPartial=true` exhaustion path that returns `{ status: 'partial_success', notes: 'retries exhausted' }` — this code path is never exercised by any test.
  5. Exception handling on the final attempt: caught error emitted as a `fail` outcome.

  These are exercised only indirectly through integration tests, making retry-math regressions hard to diagnose.

- **Recommendation:** Add `test/engine/retry.test.ts` with direct unit tests covering: `delayForAttempt` (attempt=1, large attempt capped at `maxDelayMs`), `buildRetryPolicy` (node override vs. graph default), and `executeWithRetry` (allowPartial exhaustion path, initialAttempt parameter for resume).

---

### FINDING-006: Spec Section 10.3 step 5 resume description is stale and contradicts implementation

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:161-165`, `docs/SPEC.md` Section 10.3
- **Description:** SPEC Section 10.3 step 5 says: *"Determine the next node: find the outgoing edge from `checkpoint.currentNode` using the last recorded outcome, then set `currentNode` to the edge's target."* The implementation stores `currentNode: edge.to` in the checkpoint (the pre-resolved next node), so resume reads `graph.nodes.get(checkpoint.currentNode)` directly without re-running edge selection. The code is correct, but the spec describes a different checkpoint design where `currentNode` is the most-recently-completed node. Any reader of the spec attempting to understand resume behaviour will be misled.

- **Recommendation:** Update SPEC.md Section 10.3 step 5 to: *"Restore `currentNode` from `checkpoint.currentNode` (this field contains the next node to execute, already resolved from edge selection before the checkpoint was saved)."* No code change required.

---

### FINDING-007: `buildStatusInstruction` test suite is empty — no assertions

- **Severity:** LOW
- **Category:** Test Quality
- **Status:** RESOLVED
- **File(s):** `test/handlers/codergen.test.ts` (buildStatusInstruction describe block)
- **Description:** The `describe('buildStatusInstruction')` block contains a single `it()` with an empty body:
  ```typescript
  describe('buildStatusInstruction', () => {
    it('includes the status file path', () => {
      // Implicitly tested via the systemPromptAppend tests above
    });
  });
  ```
  Vitest marks empty test bodies as passed. The function builds multi-line instructions with edge label enumeration — core LLM guidance for the pipeline. The edge-labels listing, status file path, and instruction text are not explicitly verified in isolation.

- **Recommendation:** Replace the empty body with real assertions calling `buildStatusInstruction` directly. Cover: path present in output, edge labels enumerated when edges exist, correct format when no outgoing edges, presence of the `'Do NOT skip writing this file'` text.
- **Resolution:** Replaced the single empty test body with 5 direct unit tests: (1) status file path in output, (2) "Do NOT skip writing this file" text present, (3) edge labels enumerated when edges have labels, (4) "can be one of" hint omitted when all edges are unlabelled, (5) hint omitted when node has no outgoing edges. Also imported `buildStatusInstruction` into the test file. 302 tests passing.

---

### FINDING-008: `parseStatusFile` silently defaults to `'success'` on unrecognised or missing outcome

- **Severity:** LOW
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/handlers/codergen.ts:73-86`
- **Description:** When an LLM writes `"outcome": "done"` or omits the field entirely, `parseStatusFile` silently returns `status: 'success'`:
  ```typescript
  } else {
    status = 'success'; // silent default
  }
  ```
  A missing or unrecognised outcome should arguably default to `'fail'` (requiring explicit success) rather than silently succeeding and allowing the pipeline to continue as if work completed correctly.

- **Recommendation:** Change the default to `status = 'fail'` with `failureReason: 'Missing or unrecognised outcome field in status.json'`. Alternatively keep the current default but emit a `warning` pipeline event so operators are notified. Update the test that currently asserts the `'success'` default.
- **Resolution:** Changed default from `status = 'success'` to `status = 'fail'` with `defaultedFailReason = 'Missing or unrecognised outcome field in status.json'`. Updated `failureReason` logic to use this specific message when the outcome was defaulted. Updated the two test cases that asserted the old `'success'` default to now assert `'fail'` with the new `failureReason`. 302 tests passing.

---

### FINDING-009: `WaitForHumanHandler` default_choice label matching is an undocumented spec extension

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/handlers/wait-human.ts:63-69`
- **Description:** The spec defines default choice lookup as `choices.find(c => c.to === defaultChoice || c.key === defaultChoice)`. The implementation adds a third case-insensitive condition: `c.label.toLowerCase() === defaultChoiceId.toLowerCase()`. Not a bug — it is a usability improvement — but it is an undocumented deviation.

- **Recommendation:** Document this as an intentional extension in either a code comment or the spec. No code change required.
- **Resolution:** Added a 4-line comment above the `choices.find` call explaining that the spec defines lookup by `c.to` and `c.key`, and that the `c.label` case-insensitive match is an intentional usability extension. No code change.

---

### FINDING-010: Runner does not write per-node outcome to `{logsRoot}/{nodeId}/status.json`

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/engine/runner.ts`, `docs/SPEC.md` Section 17.3
- **Description:** SPEC DoD Section 17.3 states: *"Outcome written to `{logsRoot}/{nodeId}/status.json`"*. The runner never writes per-node outcome files for non-codergen nodes (tool, conditional, wait-human, parallel, fan-in). Only `CodergenHandler` writes a `status.json`. The DoD is ambiguous about whether this applies to all node types or only codergen nodes.

- **Recommendation:** Clarify the spec: if all node types should emit outcome artifacts, add a `fs.writeFile` call in the runner after `executeWithRetry`. If only codergen nodes, update the DoD wording to reflect that.

---

### FINDING-011: `ToolHandler` does not support context variable interpolation in `tool_command`

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/handlers/tool.ts:74-80`
- **Description:** `ToolHandler` executes `tool_command` verbatim without substituting context variables. By contrast, `CodergenHandler` benefits from `$goal` substitution via `applyTransforms`. A user who writes `tool_command="run-tests --dir ${context.build_dir}"` in a DOT file will find the literal string passed unchanged to the shell. This limitation is not documented.

- **Recommendation:** Document this limitation explicitly in the spec and/or code comments. Optionally, apply the same `applyTransforms` variable substitution to `tool_command` values.

---

### FINDING-012: `StartHandler` and `ExitHandler` classes are dead code in the production path

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/handlers/start.ts`, `src/handlers/exit.ts`, `src/engine/runner.ts:104-112`
- **Description:** `StartHandler` and `ExitHandler` are defined, tested, and exported from `src/index.ts`. However, `runner.ts` never imports them — it registers anonymous inline handler objects instead:
  ```typescript
  registry.register('start', { async execute(): Promise<Outcome> { return { status: 'success' }; } });
  registry.register('exit',  { async execute(): Promise<Outcome> { return { status: 'success' }; } });
  ```
  The class files exist as library exports for external consumers but this intent is not documented.

- **Recommendation:** Either: (a) Have the runner import and use `StartHandler`/`ExitHandler` to eliminate duplication and make the tests exercise production code, or (b) Add a comment in `src/index.ts` noting these are exported for library consumers.

---

### FINDING-013: `ToolHandler` full stderr as `failureReason` — large multi-line output pollutes context

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/handlers/tool.ts:93-97`
- **Description:** When a tool exits with a non-zero code, `failureReason` is set to the full `stderr` string (up to 5000 chars), which can be multi-line compiler/test output. This propagates verbatim into pipeline events, checkpoints, and preambles.

- **Recommendation:** Truncate `failureReason` to the first line of stderr (or first 200 characters) and preserve full stderr only in `contextUpdates['tool.stderr']`.

---

## Statistics

- Total findings: 13
- Critical: 0
- High: 1
- Medium: 3
- Low: 7
- Trivial: 2
