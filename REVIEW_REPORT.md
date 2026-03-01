# Code Review Report

**Date:** 2026-03-01
**Reviewer:** AI Agent (ninth-pass)
**Test Status:** All passing (263/263)

## Summary

The codebase continues to be in excellent shape after eight prior review cycles. This ninth-pass review found no critical or high-severity issues. One medium-severity issue was identified (`parseDurationToMs` relies on object key insertion order to disambiguate `"ms"` from `"s"`). Four low-severity issues round out the findings: a misleading event field, dead code in `autoStatus`, a validation rule that never fires, and an unimplemented spec feature (`previousNodeId` in thread resolution). Two trivial nits close out the report.

---

## Findings

### FINDING-001: `parseDurationToMs` relies on object key insertion order to disambiguate `"ms"` from `"s"`

- **Severity:** MEDIUM
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/parser/parser.ts:10-26`
- **Description:** `parseDurationToMs` iterates `Object.entries(DURATION_MS)` and returns on the first matching `.endsWith(suffix)`. Because `"250ms".endsWith("s")` is `true` (the `"s"` entry would also match), the function's correctness depends on `"ms"` being iterated before `"s"`. In V8, non-integer string keys are iterated in insertion order, and `"ms"` appears first in the literal, so this works today. However, the logic is fragile: reordering the `DURATION_MS` object (e.g., alphabetically) or running on a non-V8 engine would cause durations like `"250ms"` to silently return `250000` instead of `250`.
- **Recommendation:** Sort entries by suffix length descending before iterating, so longer suffixes are always checked first:
  ```typescript
  for (const [suffix, multiplier] of Object.entries(DURATION_MS).sort(
    (a, b) => b[0].length - a[0].length
  )) {
  ```
  This eliminates the insertion-order dependency with a minimal, self-documenting change.

---

### FINDING-002: `edge_selected` event `reason` field is inaccurate for non-condition, non-weight selections

- **Severity:** LOW
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:400`
- **Description:** The `edge_selected` event is emitted with:
  ```typescript
  reason: edge.condition ? "condition" : "weight"
  ```
  The `selectEdge` algorithm has five steps, two of which do not use conditions or weights: step 2 (preferred-label matching) and step 3 (suggested-next-ids). When an edge is selected via either of those steps, the event incorrectly reports `reason: "weight"`. This is an observability defect that makes pipeline traces misleading for these common selection cases.
- **Recommendation:** Either extend the `reason` field to include `"preferred_label"` and `"suggested_next"` values (requires `selectEdge` to return the selection method alongside the edge), or widen the type to a string and emit a more accurate value such as `"auto"` when neither condition nor explicit weight was the deciding factor. The minimal fix is:
  ```typescript
  reason: edge.condition ? "condition" : "auto"
  ```
  which at least removes the false implication that weight was the selection mechanism.

---

### FINDING-003: `autoStatus` check `!outcome.status` is dead code

- **Severity:** LOW
- **Category:** Correctness
- **Status:** OPEN
- **File(s):** `src/handlers/codergen.ts:229-232`
- **Description:** The comment at line 229 reads "if autoStatus and outcome status is somehow undefined, default to success". The check `!outcome.status` can never be true at that point:
  - If `status.json` was read successfully, `parseStatusFile` always returns an `Outcome` with a `status` field (defaulting to `"success"` if the field is missing or invalid).
  - If `status.json` was absent or failed to parse, the `catch` block (lines 209-226) always assigns either `{ status: "success", ... }` or `{ status: "fail", ... }`.

  The `autoStatus` guard is therefore permanently dead. A developer reading the code might believe this fallback provides meaningful protection, when in fact it provides none.
- **Recommendation:** Remove the dead check. If the intent was to detect the "no status file was written" case specifically and auto-succeed, that logic needs to be placed _before_ the `catch` block, using a boolean flag that records whether the file was successfully read, then conditional on `node.autoStatus`:
  ```typescript
  let statusFileFound = false;
  try {
    const statusContent = await fs.readFile(statusFilePath, "utf-8");
    // ...
    statusFileFound = true;
  } catch { }
  if (!statusFileFound && node.autoStatus && ccResult.success) {
    outcome = { status: "success", notes: `Stage completed: ${node.id}` };
  }
  ```

---

### FINDING-004: `promptOnLlmNodesRule` validation rule effectively never fires

- **Severity:** LOW
- **Category:** Correctness
- **Status:** OPEN
- **File(s):** `src/validation/rules.ts:275-289`
- **Description:** The rule fires when `isLlmNode && !node.prompt && !node.label`. However, the parser always sets `label` to the node's ID when no explicit label is specified (see `defaultGraphNode` in `parser.ts`). This means `node.label` is always a non-empty string for every node produced by the parser, making `!node.label` permanently false. The rule can never trigger for any valid graph, rendering it a silent no-op. The test for this rule (`validator.test.ts`) does not exercise the warning path, only the non-warning path, which confirms the warning was never reachable.
- **Recommendation:** Change the condition to detect nodes with no explicit `prompt` attribute and whose label equals their ID (the default, auto-assigned value):
  ```typescript
  const hasExplicitLabel = node.raw.has("label");
  if (isLlmNode && !node.prompt && !hasExplicitLabel) {
  ```
  This requires `raw` (the set of explicitly-parsed attributes) to be available on `GraphNode`. If `raw` is not exposed, an alternative is to compare `node.label === node.id` as a proxy for "no explicit label was set". Add a test that verifies the warning fires for a box node with no `prompt` and no explicit `label`.

---

### FINDING-005: `resolveThreadId`'s `previousNodeId` parameter is never supplied by any caller

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/model/fidelity.ts:22-32`, `src/handlers/codergen.ts:139`
- **Description:** The spec (Section 11.3) defines thread ID resolution precedence as: node > edge > class-derived > **previous node ID**. The implementation correctly defines the four-argument `resolveThreadId(node, graph, incomingEdge?, previousNodeId?)` signature, but the only call site at `codergen.ts:139` passes only three arguments:
  ```typescript
  const threadId = resolveThreadId(node, graph, config.incomingEdge);
  ```
  `previousNodeId` is therefore always `undefined`, causing the fallback at line 31 to always return `node.id` instead of the previous node's ID. The spec-described "use previous node as thread" feature is never exercised. This means two sequential LLM nodes in the same pipeline always get different thread IDs (their own IDs) rather than sharing the previous node's thread when not otherwise configured.
- **Recommendation:** Pass the previous node's ID into `CodergenHandler.execute`. The runner tracks `currentNode` at advance-time; the simplest fix is to add a `previousNodeId?: string` field to `NodeConfig` (or `RunConfig`) and populate it just before advancing:
  ```typescript
  // In runner.ts, before updating currentNode:
  nodeConfig.previousNodeId = currentNode.id;
  currentNode = graph.nodes.get(edge.to)!;
  ```
  Then update `codergen.ts` to forward it: `resolveThreadId(node, graph, config.incomingEdge, config.previousNodeId)`.

---

### FINDING-006: `timeout: 0` immediately aborts a CC session with no guard

- **Severity:** TRIVIAL
- **Category:** Correctness
- **Status:** OPEN
- **File(s):** `src/backend/cc-backend.ts:34-36`
- **Description:** If `options.timeout` is `0`, `setTimeout(() => abortController.abort(), 0)` fires on the next tick, aborting the CC session before it has a chance to produce any output. There is no guard against zero. A `timeout: 0` attribute on a node (which the DOT parser would produce as `0` milliseconds if the user writes `timeout = "0"`) would cause every execution of that node to immediately fail with a timeout error. This is most likely a misconfiguration rather than intentional behavior.
- **Recommendation:** Add a guard to skip the timeout setup for zero values:
  ```typescript
  if (options.timeout !== undefined && options.timeout > 0) {
  ```
  Alternatively, document that `timeout: 0` means "abort immediately" in the attribute reference. The parser's `parseDurationToMs` function does not produce `0` for any valid duration string (bare `"0"` would parse to `0`), so this is only triggered by an explicit zero timeout in the DOT source.

---

### FINDING-007: `edge_selected` event is emitted after the checkpoint save, inverting observable order

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/engine/runner.ts:374-402`
- **Description:** The sequence is: (1) save checkpoint (lines 376-387), (2) emit `checkpoint_saved` (lines 389-393), (3) emit `edge_selected` (lines 395-402). A consumer of the event stream therefore observes `checkpoint_saved` before `edge_selected`, even though the edge selection logically precedes the checkpoint. The checkpoint correctly stores `edge.to` as the next node, so the data is correct; only the event ordering is counter-intuitive. An `onEvent` consumer correlating `edge_selected` events with checkpoint saves would see them in reversed order.
- **Recommendation:** Swap the order: emit `edge_selected` first, then save the checkpoint and emit `checkpoint_saved`. The checkpoint content (`edge.to`) is already known at the point of edge selection and does not depend on the event emission.

---

## Statistics

- Total findings: 7
- Critical: 0
- High: 0
- Medium: 1
- Low: 4
- Trivial: 2
