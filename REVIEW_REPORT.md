# Code Review Report

**Date:** 2026-03-01
**Reviewer:** AI Agent (sixth-pass)
**Test Status:** All passing (255/255)

## Summary

The codebase is in excellent shape after five prior review cycles with all previous findings resolved. This sixth-pass review found no critical or high-severity issues. Four low-severity findings were identified: a priority-order inconsistency between `resolveThreadId` and `resolveFidelity`, a gap in the `goalGateHasRetryRule` validation (misses `fallbackRetryTarget` at the graph level), edge fidelity values not being validated, and ToolHandler stderr not being exposed in context. Two trivial issues were also found: an unused constructor parameter and an outdated default model string.

---

## Findings

### FINDING-001: `resolveThreadId` checks node-level before edge-level, inconsistent with `resolveFidelity`

- **Severity:** LOW
- **Category:** Spec Compliance / Correctness
- **Status:** RESOLVED
- **File(s):** `src/model/fidelity.ts:22-32`
- **Description:** `resolveFidelity` correctly gives edge-level fidelity the highest priority (edge → node → graph → default). However, `resolveThreadId` has a different priority order: node-level `threadId` is checked *before* the incoming edge's `threadId`:
  ```typescript
  export function resolveThreadId(...): string {
    if (node.threadId) return node.threadId;           // node first
    if (incomingEdge?.threadId) return incomingEdge.threadId;  // edge second
    ...
  }
  ```
  The FINDING-001 resolution from review cycle 5 established that "edge-level fidelity/threadId has higher priority than node-level in the resolution chain." `resolveFidelity` honours this, but `resolveThreadId` does not: an edge-level `thread_id` attribute is silently ignored whenever the destination node already has an explicit `threadId`. A user writing `a -> b [thread_id="shared"]` where `b` has `thread_id="isolated"` would expect the edge to have no effect, but if they reverse it (no node threadId, edge threadId set), it would work. The inconsistency is confusing and deviates from the stated spec intent.
- **Recommendation:** Swap the priority order in `resolveThreadId` to mirror `resolveFidelity`: check `incomingEdge?.threadId` before `node.threadId`. Update the fidelity tests to verify edge > node for threadId.

---

### FINDING-002: `goalGateHasRetryRule` does not check `graph.attributes.fallbackRetryTarget`

- **Severity:** LOW
- **Category:** Spec Compliance / Correctness
- **Status:** RESOLVED
- **File(s):** `src/validation/rules.ts:239-256`
- **Description:** The `resolveRetryTarget` function (the runtime logic) checks four sources in priority order: `node.retryTarget → node.fallbackRetryTarget → graph.attributes.retryTarget → graph.attributes.fallbackRetryTarget`. The validation rule `goalGateHasRetryRule` is supposed to warn when a goal gate node has no reachable retry target, but it only checks `graph.attributes.retryTarget`, not `graph.attributes.fallbackRetryTarget`:
  ```typescript
  const graphHasRetry = !!graph.attributes.retryTarget;  // ← misses fallbackRetryTarget
  ```
  As a result, a graph with `fallback_retry_target="start"` (but no `retry_target`) would trigger a spurious warning on every goal gate node, even though the runtime would successfully find the fallback retry target. This creates false-positive warnings that could confuse users.
- **Recommendation:** Change the check to: `const graphHasRetry = !!graph.attributes.retryTarget || !!graph.attributes.fallbackRetryTarget;`

---

### FINDING-003: Edge fidelity values are not validated by `fidelityValidRule`

- **Severity:** LOW
- **Category:** Spec Compliance / Test Quality
- **Status:** RESOLVED
- **File(s):** `src/validation/rules.ts:201-214`
- **Description:** The `fidelityValidRule` only validates `node.fidelity` values but ignores `edge.fidelity`. A user who writes `a -> b [fidelity="typo"]` will get no warning, and `resolveFidelity` will silently use it as a `FidelityMode` (via an unsafe cast: `incomingEdge.fidelity as FidelityMode`). Since edge-level fidelity now takes the highest priority in the resolution chain (after FINDING-001 in review cycle 5), invalid edge fidelity values are more likely to have runtime impact than invalid node fidelity values. Similarly, `graph.attributes.defaultFidelity` is not validated.
- **Recommendation:** Extend `fidelityValidRule` to check edge fidelity values: iterate over `graph.edges` and flag any `edge.fidelity` that is non-empty and not in `VALID_FIDELITY`. Also check `graph.attributes.defaultFidelity` if non-empty.

---

### FINDING-004: `ToolHandler` does not expose `tool.stderr` in context updates

- **Severity:** LOW
- **Category:** Correctness / Usability
- **Status:** OPEN
- **File(s):** `src/handlers/tool.ts:82-98`
- **Description:** The `ToolHandler` captures stderr from the shell command but only exposes stdout as `tool.output` and exit code as `tool.exit_code` in context updates:
  ```typescript
  const contextUpdates: Record<string, string> = {
    "tool.output": output,       // stdout, truncated to MAX_OUTPUT_LENGTH
    "tool.exit_code": String(result.exitCode),
    // tool.stderr is missing
  };
  ```
  When a tool command fails, the failure reason is derived from stderr (`result.stderr || \`Exit code: ${result.exitCode}\``), but this is only stored as `Outcome.failureReason`, which is not directly accessible from context in subsequent stages or conditions. A user who wants to branch based on tool error output (e.g., `context.tool_stderr=permission denied`) cannot do so. This is a gap compared to `tool.output` (stdout), which is available in context.
- **Recommendation:** Add `"tool.stderr": result.stderr.slice(0, MAX_OUTPUT_LENGTH)` to the `contextUpdates` object so downstream stages can access and condition on tool stderr output.

---

### FINDING-005: Unused `sessionManager` parameter in `ParallelHandler` constructor

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/handlers/parallel.ts:69-73`
- **Description:** The `ParallelHandler` constructor accepts an optional `sessionManager?: SessionManager` parameter, but it is never referenced in the `execute` method or in `executeBranch`. The `cli.ts` creates `new ParallelHandler(registry)` (without a SessionManager), and the spec does not describe the parallel handler needing session management.
- **Recommendation:** Remove the `sessionManager` parameter from the `ParallelHandler` constructor since it is dead code.

---

### FINDING-006: Default model in `cc-backend.ts` references `claude-sonnet-4-5-20250514` (outdated)

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/backend/cc-backend.ts:54`
- **Description:** The default model is hardcoded as `claude-sonnet-4-5-20250514`. The current system runs on `claude-sonnet-4-6`, and the project notes specify that `claude-sonnet-4-6` is the latest Sonnet model. Users who don't specify an `llm_model` attribute will silently use an older model.
- **Recommendation:** Update the default model to `claude-sonnet-4-6` (or the canonical latest ID, e.g., `claude-sonnet-4-6-20251015` if applicable). Alternatively, add a comment explaining why a specific pinned model is preferred over the latest.

---

## Statistics

- Total findings: 6
- Critical: 0
- High: 0
- Medium: 0
- Low: 4
- Trivial: 2
