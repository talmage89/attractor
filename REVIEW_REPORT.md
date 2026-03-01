# Code Review Report

**Date:** 2026-03-01
**Reviewer:** AI Agent (fifth-pass)
**Test Status:** All passing (252/252)

## Summary

The codebase is in excellent shape after four prior review cycles with all previous findings resolved. This fifth-pass review found a medium-severity spec compliance gap (edge-level fidelity and thread_id overrides are silently ignored), three low-severity correctness and compliance issues (infinite goal-gate retry loop, always-empty nodeRetries in checkpoints, error events not printed by default without --verbose), and three trivial issues.

---

## Findings

### FINDING-001: Edge-level `fidelity` and `thread_id` attributes are never applied

- **Severity:** MEDIUM
- **Category:** Spec Compliance / Correctness
- **Status:** RESOLVED
- **File(s):** `src/handlers/codergen.ts:135,139`, `src/model/fidelity.ts:11-32`, `src/engine/runner.ts:21-38`
- **Description:** The `Edge` interface has `fidelity: string` and `threadId: string` fields, and the `resolveFidelity`/`resolveThreadId` functions accept an optional `incomingEdge?: Edge` parameter specifically to honour these overrides (edge-level fidelity/threadId has higher priority than node-level in the resolution chain). However, no code path ever passes the incoming edge to these functions:
  - `CodergenHandler.execute()` calls `resolveFidelity(node, graph)` (line 135) and `resolveThreadId(node, graph)` (line 139), omitting the third argument entirely.
  - `RunConfig` does not expose the incoming edge that led to the current node, so handlers have no way to access it.

  As a result, a user who sets `fidelity="full"` or `thread_id="shared"` on an *edge* (e.g., `a -> b [fidelity="full"]`) would see no effect — `resolveFidelity` will skip the `incomingEdge?.fidelity` branch and fall through to the node-level or graph-level defaults. This makes edge-level fidelity and threadId effectively dead attributes despite being parsed and stored in the Edge model.
- **Recommendation:** Add an optional `incomingEdge?: Edge` field to `RunConfig` (in `src/engine/runner.ts`). Before calling `executeWithRetry`, the runner should set this field to the edge that was selected (`edge` from `selectEdge`). Then `CodergenHandler` can read `config.incomingEdge` and pass it to `resolveFidelity` and `resolveThreadId`. No API breaking change is needed since the field would be optional.

---

### FINDING-002: Goal-gate retry loop has no iteration limit

- **Severity:** LOW
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:221-231`
- **Description:** When the terminal node's goal-gate check fails and a `retryTarget` is found, the runner sets `currentNode = retryNode` and continues the traversal loop with no guard on how many times this can happen:
  ```typescript
  if (!gateResult.satisfied && gateResult.failedNode) {
    const retryTarget = resolveRetryTarget(gateResult.failedNode, graph);
    if (retryTarget) {
      const retryNode = graph.nodes.get(retryTarget)!;
      currentNode = retryNode;
      continue loop;  // ← no counter, no max
    }
    ...
  }
  ```
  If the retry subgraph consistently produces a failing outcome for the goal-gate node (e.g., the LLM can't satisfy the goal), the pipeline will loop indefinitely, consuming resources and never terminating. The per-node retry policy (via `RetryPolicy.maxAttempts`) only limits retries within a single handler invocation, not goal-gate-driven re-traversals.
- **Recommendation:** Introduce a goal-gate retry counter. Track the number of goal-gate-driven restarts (e.g., `let goalGateRetries = 0`) and compare it against a configurable maximum (e.g., from `graph.attributes.defaultMaxRetry` or a new `max_goal_gate_retries` attribute). When the limit is exceeded, break the loop with `finalStatus = "fail"`.

---

### FINDING-003: `nodeRetries` is always serialized as `{}` in checkpoints

- **Severity:** LOW
- **Category:** Correctness / Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:312-323`, `src/engine/runner.ts:345-356`, `src/model/checkpoint.ts:5-13`
- **Description:** The `Checkpoint` interface includes a `nodeRetries: Record<string, number>` field, which implies intent to persist per-node retry counts so that a resumed pipeline knows how many retries have already been consumed. However, the runner always saves `nodeRetries: {}`:
  ```typescript
  await saveCheckpoint({
    ...
    nodeRetries: {},  // always empty
    ...
  }, config.logsRoot);
  ```
  In practice, if a pipeline crashes mid-execution while a node is retrying (e.g., on attempt 3 of 5), resuming from checkpoint will restart that node from attempt 1. Depending on the use case, this could cause more retries than intended or re-execute expensive operations that had already partially succeeded (retried twice). The `nodeRetries` field is validated in `loadCheckpoint` as a required field but its value is never used on resume.
- **Recommendation:** Track per-node retry counts in the runner (e.g., `const nodeRetries = new Map<string, number>()`) and update it inside `executeWithRetry` or via the `stage_retrying` event. Persist the current counts in each checkpoint save. On resume, load the saved retry counts and pass them as the starting attempt to `executeWithRetry` for the current node. If full retry-count persistence is out of scope, at minimum document that the field is intentionally unused (e.g., rename it to `nodeRetries_reserved` or remove it from the interface).

---

### FINDING-004: `error` events are not printed to stderr unless `--verbose` is passed

- **Severity:** LOW
- **Category:** Usability / Correctness
- **Status:** RESOLVED
- **File(s):** `src/cli.ts:122-134`
- **Description:** The `onEvent` handler in `cmdRun` only prints events to stderr for a fixed set of "normal" events:
  ```typescript
  if (
    verbose ||
    event.kind === "pipeline_started" ||
    event.kind === "pipeline_completed" ||
    event.kind === "stage_started" ||
    event.kind === "stage_completed" ||
    event.kind === "human_question"
  ) {
    process.stderr.write(line + "\n");
  }
  ```
  The `error` event kind is not in this list. As a result, when a handler throws an exception and retries are exhausted (emitting a `{ kind: "error", nodeId, message }` event), users running without `--verbose` see no output about the failure. The pipeline may silently produce a `fail` status with no visible error message, making diagnosis difficult. The only visible output would be the final `stage_completed` event with `status: "fail"` and the pipeline summary.
- **Recommendation:** Add `event.kind === "error"` to the default-printed set (alongside `stage_completed`). Errors are exceptional and should always be surfaced to the user regardless of verbosity level.

---

### FINDING-005: Unrecognized `join_policy` warning emitted via `process.stderr.write` instead of `config.onEvent`

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/handlers/parallel.ts:92-95`
- **Description:** The phase 8 spec says: "If an unrecognized join policy is encountered, treat it as `wait_all` and emit a warning via `config.onEvent`." The implementation emits the warning directly to `process.stderr`:
  ```typescript
  process.stderr.write(
    `[attractor] Warning: node "${node.id}" has unrecognized join_policy "${joinPolicy}"; defaulting to "wait_all"\n`
  );
  ```
  While there is no dedicated "warning" variant in `PipelineEvent`, using `process.stderr.write` bypasses the event system entirely. Callers who subscribe to `config.onEvent` to capture all runtime messages (e.g., for logging, monitoring, or testing) will miss this warning. The current test also monkeypatches `process.stderr.write` to assert this — a sign that the test is tightly coupled to the implementation detail rather than the observable interface.
- **Recommendation:** Either (a) add a `{ kind: "warning"; message: string; nodeId?: string; timestamp: number }` variant to `PipelineEvent` and emit it via `config.onEvent?.({...})`, or (b) emit an `error`-kind event with an appropriate message. Option (a) is preferred as it gives callers a distinct category. The test should then check for an emitted event rather than patching stderr.

---

### FINDING-006: CLI summary does not print total cost; `RunResult` has no `totalCostUsd` field

- **Severity:** TRIVIAL
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/cli.ts:167-172`, `src/engine/runner.ts:41-47`
- **Description:** The phase 8 spec says `cmdRun` should "Print summary: status, completed nodes, duration, **total cost**." The current summary output only prints status, completed nodes, and duration:
  ```typescript
  process.stdout.write(`\nStatus: ${result.status}\n`);
  process.stdout.write(`Completed nodes: ${result.completedNodes.join(", ")}\n`);
  process.stdout.write(`Duration: ${durationS}s\n`);
  ```
  The `RunResult` interface has no `totalCostUsd` field. While individual stage costs are now propagated through `Outcome.costUsd` and `stage_completed` events (fixed in review cycle 4), the runner never aggregates them into a pipeline-level total. As a result, users cannot see how much a complete pipeline run cost without manually summing stage-level costs from logs.
- **Recommendation:** Add `totalCostUsd: number` to the `RunResult` interface. In `runner.ts`, sum `outcome.costUsd ?? 0` for each completed node and include the total in the returned result. In `cmdRun`, print `Total cost: $X.XX` when `totalCostUsd > 0`.

---

### FINDING-007: Unused `import * as path from "node:path"` in `runner.ts`

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:2`
- **Description:** `import * as path from "node:path"` is declared at line 2 of `runner.ts` but `path` is never referenced anywhere in the file. The loop-restart logic uses template literals (`${config.logsRoot}-restart-${Date.now()}`), not `path.join`, and checkpoint I/O is delegated to `saveCheckpoint`/`loadCheckpoint` in `checkpoint.ts` which imports its own `path`.
- **Recommendation:** Remove the unused import.

---

## Statistics

- Total findings: 7
- Critical: 0
- High: 0
- Medium: 1
- Low: 4
- Trivial: 2
