# Code Review Report

**Date:** 2026-03-01
**Reviewer:** twelfth-pass
**Test Status:** All passing (304/304 across 21 test files)

---

## Summary

This is the twelfth code review pass of the Attractor TypeScript DAG pipeline execution engine. The prior eleven passes resolved 69 findings. The codebase is in excellent shape: all 304 tests pass, architecture is clean and well-layered, and spec compliance is high. This pass surfaces 9 new findings (4 LOW, 3 MEDIUM, 2 TRIVIAL) with no HIGH or CRITICAL issues.

The most actionable findings are the three test gaps (FINDING-001 through FINDING-003): three validation rules — `conditionSyntaxRule`, `stylesheetSyntaxRule`, and `retryTargetExistsRule` — have no dedicated test coverage in `validator.test.ts`. The spec-compliance findings (FINDING-004 through FINDING-007) document intentional or low-risk divergences. The remaining two findings are trivial code-quality notes.

---

## Findings

### FINDING-001: No test coverage for `conditionSyntaxRule`

- **Severity:** MEDIUM
- **Category:** Test Quality
- **Status:** RESOLVED
- **File(s):** `test/validation/validator.test.ts`, `src/validation/rules.ts`
- **Description:** `validator.test.ts` has dedicated `describe` blocks for 11 of the 14 implemented validation rules. `conditionSyntaxRule`, `stylesheetSyntaxRule`, and `retryTargetExistsRule` are all absent. For `conditionSyntaxRule` specifically, the rule is the primary guard against malformed condition expressions reaching `evaluateCondition` at runtime. Without a test, a regression that silently swallows parse errors in condition syntax would go undetected. The rule implementation is:

  ```ts
  // src/validation/rules.ts
  for (const edge of graph.edges) {
    if (!edge.condition) continue;
    const result = parseCondition(edge.condition);
    if (!result.ok) {
      diagnostics.push({ ... });
    }
  }
  ```

  There is no corresponding `describe("conditionSyntaxRule", ...)` in the test file.

- **Recommendation:** Add a `describe("conditionSyntaxRule", ...)` block with at least three cases: (1) a valid condition string passes, (2) a syntactically invalid condition string produces a diagnostic, (3) an empty condition string is skipped without error.

---

### FINDING-002: No test coverage for `stylesheetSyntaxRule`

- **Severity:** MEDIUM
- **Category:** Test Quality
- **Status:** RESOLVED
- **File(s):** `test/validation/validator.test.ts`, `src/validation/rules.ts`
- **Description:** `stylesheetSyntaxRule` validates the `model_stylesheet` graph attribute by calling `parseStylesheet`. A malformed stylesheet that reaches `applyTransforms` would throw at runtime. No dedicated test exists for this rule. The rule is implemented and reachable, but is not exercised in isolation.

- **Recommendation:** Add a `describe("stylesheetSyntaxRule", ...)` block with at least two cases: (1) a valid stylesheet passes without diagnostics, (2) a syntactically invalid stylesheet string produces an ERROR-level diagnostic. This mirrors the pattern used for `conditionSyntaxRule` in the implementation.

---

### FINDING-003: No test coverage for `retryTargetExistsRule`

- **Severity:** MEDIUM
- **Category:** Test Quality
- **Status:** RESOLVED
- **File(s):** `test/validation/validator.test.ts`, `src/validation/rules.ts`
- **Description:** `retryTargetExistsRule` checks that any `retry_target` attribute on a node references a node ID that exists in the graph. An invalid `retry_target` would cause `graph.nodes.get(retryTarget)` to return `undefined` inside `resolveRetryTarget`, which would silently skip the goal-gate retry — a subtle failure mode. No test exists for this rule.

- **Recommendation:** Add a `describe("retryTargetExistsRule", ...)` block with at least two cases: (1) a node whose `retry_target` references a valid node ID produces no diagnostic, (2) a node whose `retry_target` references a non-existent node ID produces an ERROR-level diagnostic.

---

### FINDING-004: `KNOWN_TYPES` in `type_known` rule includes `stack.manager_loop` which is not in the spec's type table

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/validation/rules.ts`
- **Description:** The spec's Section 6.2 `type_known` validation rule lists the following permitted handler types: `start`, `exit`, `codergen`, `conditional`, `wait.human`, `parallel`, `fan.in`, `tool`. The implementation's `KNOWN_TYPES` set also includes `stack.manager_loop`:

  ```ts
  const KNOWN_TYPES = new Set([
    "start", "exit", "codergen", "conditional",
    "wait.human", "parallel", "fan.in", "tool",
    "stack.manager_loop",   // <-- not in spec table
  ]);
  ```

  The spec explicitly defers `stack.manager_loop` to a future phase ("Phase 9+"). Including it in `KNOWN_TYPES` means graphs that set `type=stack.manager_loop` will pass validation but receive the stub handler that always returns `fail`. A user could write a graph that appears valid but always fails at the `stack.manager_loop` node, with no warning.

- **Recommendation:** Either (a) remove `stack.manager_loop` from `KNOWN_TYPES` so the `type_known` rule correctly flags it as unknown, OR (b) keep it but add a WARNING-level diagnostic specifically for `stack.manager_loop` nodes noting the type is not yet implemented. Option (a) is the simpler and spec-compliant choice.

---

### FINDING-005: `parseStatusFile` defaults unrecognized outcome to `"fail"` but spec defaults to `"success"`

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/handlers/codergen.ts`
- **Description:** The spec (Section 10.2) shows:

  ```
  outcome = parseStageStatus(obj.outcome) ?? "success"
  ```

  The implementation at lines 75–88 of `codergen.ts` instead defaults a missing or unrecognized `outcome` field to `"fail"`:

  ```ts
  const outcomeStr = obj.outcome;
  if (outcomeStr !== "success" && outcomeStr !== "fail" && outcomeStr !== "retry") {
    return { outcome: "fail", notes: "...", label: null };
  }
  ```

  This means a `status.json` file that omits the `outcome` field entirely (or has a typo) will cause the node to fail, whereas the spec would treat it as success. The implementation behavior is arguably safer for pipeline correctness, but it is a documented spec deviation.

- **Recommendation:** If strict spec compliance is desired, change the fallback to `"success"`. If the current "fail-safe" behavior is intentional, add a comment explaining the deliberate deviation from the spec's `?? "success"` default, so future reviewers do not treat it as a bug.

---

### FINDING-006: `ConsoleInterviewer.inform()` does not include the `stage` parameter in its log format

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/interviewer/console.ts`
- **Description:** The spec's `ConsoleInterviewer.inform()` description shows the output format as `[i] (${stage}) ${message}`. The implementation is:

  ```ts
  inform(stage: string, message: string): void {
    console.log(message);
  }
  ```

  The `stage` parameter is accepted but silently dropped. Users of the CLI will see the message without stage context, making it harder to correlate informational messages to specific pipeline stages.

- **Recommendation:** Update `inform()` to include the stage in the output:

  ```ts
  inform(stage: string, message: string): void {
    console.log(`[i] (${stage}) ${message}`);
  }
  ```

  Update any existing `interviewer.test.ts` assertions for `inform` to match the new format.

---

### FINDING-007: `Checkpoint` interface includes `nodeOutcomes` field not present in spec

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/model/checkpoint.ts`
- **Description:** The spec's Checkpoint interface (Section 9) defines these fields: `timestamp`, `currentNode`, `completedNodes`, `nodeRetries`, `contextValues`, `sessionMap`. The implementation adds a `nodeOutcomes` field:

  ```ts
  export interface Checkpoint {
    timestamp: number;
    currentNode: string;
    completedNodes: string[];
    nodeOutcomes: Record<string, Outcome>;  // <-- not in spec
    nodeRetries: Record<string, number>;
    contextValues: Record<string, unknown>;
    sessionMap: Record<string, string>;
  }
  ```

  This extension is practically necessary: goal-gate evaluation on resume requires `nodeOutcomes` to be restored. Without it, `checkGoalGates` would always see an empty outcomes map after resume and would fail to detect unsatisfied gates. The extension is correct and beneficial; it simply diverges from the spec interface.

- **Recommendation:** No code change required. Add a comment in `checkpoint.ts` at the `nodeOutcomes` field noting it is an intentional extension beyond the spec, required for correct goal-gate evaluation after checkpoint resume.

---

### FINDING-008: Dead/empty test body in `codergen.test.ts`

- **Severity:** TRIVIAL
- **Category:** Test Quality
- **Status:** OPEN
- **File(s):** `test/handlers/codergen.test.ts`
- **Description:** Line 576–578 contains a test with an empty body and a comment saying it is "tested implicitly":

  ```ts
  it("parses a valid status file", () => {
    // Tested implicitly via the "reads status.json" test above
  });
  ```

  Empty test bodies always pass and give false confidence in coverage. They show up as passing tests in the output but exercise no code.

- **Recommendation:** Either delete the empty test entirely, or replace the body with a direct `parseStatusFile` unit test (it is exported from `codergen.ts`). A direct unit test would also cover the `parseStatusFile` spec deviation documented in FINDING-005.

---

### FINDING-009: Double `applyTransforms` call — CLI calls it before `run()`, which calls it again internally

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/cli.ts`, `src/engine/runner.ts`
- **Description:** `cmdRun` in `cli.ts` calls `applyTransforms(graph)` before calling `run()`:

  ```ts
  // cli.ts ~line 101
  applyTransforms(graph);
  validateOrThrow(graph);
  // ...
  await run({ graph, ... });
  ```

  `run()` in `runner.ts` then calls `applyTransforms(graph)` again at line 117:

  ```ts
  // runner.ts line 117
  applyTransforms(graph);
  ```

  The current `applyTransforms` implementation is idempotent (string substitution with `replaceAll` on strings that no longer contain `$goal` after the first pass, and stylesheet application is also safe to repeat). So there is no observable bug. However, the double call is misleading and could become a real problem if `applyTransforms` is ever extended with a non-idempotent operation (e.g., accumulating rules into an array).

- **Recommendation:** Remove the `applyTransforms(graph)` call from `cmdRun` in `cli.ts` and rely solely on the call inside `run()`. The CLI's pre-run `validateOrThrow` already operates on parsed (not yet transformed) graph data, and the spec does not require transforms before validation. Alternatively, keep the CLI call but remove the one inside `run()` — but the second approach is riskier because callers who use `run()` directly (e.g., tests) would then need to call `applyTransforms` themselves.

---

## Statistics

| Severity | Count |
|----------|-------|
| HIGH     | 0     |
| MEDIUM   | 3     |
| LOW      | 4     |
| TRIVIAL  | 2     |
| **Total**| **9** |

| Category         | Count |
|------------------|-------|
| Test Quality     | 4     |
| Spec Compliance  | 4     |
| Code Quality     | 1     |

All 9 findings are **OPEN**. No findings from this pass require immediate action to maintain correctness — the codebase is functionally sound. FINDING-001, FINDING-002, and FINDING-003 (test gaps) are the highest-priority items as they represent missing safety nets for runtime error paths.
