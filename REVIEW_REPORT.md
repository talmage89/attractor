# Code Review Report

**Date:** 2026-03-01
**Reviewer:** fourteenth-pass
**Test Status:** All passing (313/313 across 21 test files)

---

## Summary

This is the fourteenth code review pass of the Attractor TypeScript DAG pipeline execution engine. All 313 tests pass and the architecture remains clean and well-layered. This pass surfaces 7 findings: 1 HIGH, 2 MEDIUM, 3 LOW, and 1 TRIVIAL. The HIGH finding is a spec compliance gap where the `autoStatus` node property is parsed and modeled throughout the system but CodergenHandler never evaluates it at runtime, meaning `auto_status=true` nodes silently ignore the attribute. The MEDIUM findings expose a validation inconsistency where `terminalNodeRule` and `exitNoOutgoingRule` use a narrower definition of "terminal node" than `isTerminal()` itself.

---

## Findings

### FINDING-001: `autoStatus` node property is never evaluated in CodergenHandler

- **Severity:** HIGH
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/handlers/codergen.ts:218-257`, `docs/SPEC.md:993-996`
- **Description:** The spec (Section 9.5, step 9) defines an AUTO STATUS step:

  ```ts
  // 9. AUTO STATUS
  if (node.autoStatus && outcome.status === undefined) {
    outcome = { status: 'success', notes: 'auto-status: handler completed without writing status' };
  }
  ```

  The `autoStatus` field is fully wired: it is parsed from `auto_status` attribute in `parser.ts`, present in `GraphNode` interface (`graph.ts:36`), and set to `false` in all test fixtures. However, `CodergenHandler.execute()` contains no reference to `autoStatus` at all. After step 8 (read status file), the code proceeds directly to step 9 (write final status) without any auto-status check. No test sets `autoStatus: true` to verify the feature.

  The practical effect: pipeline graphs that declare `auto_status=true` on a codergen node intend for the node to succeed even if the agent doesn't write a `status.json`. Today such nodes would `fail` (per the deliberate fail-safe deviation in `parseStatusFile`) or succeed/fail based on `ccResult.success` (per the catch block), ignoring the `auto_status` attribute entirely.

- **Recommendation:** Add an `autoStatus` check between step 8 and step 9 in `CodergenHandler.execute()`. The semantics should be: when `node.autoStatus === true` and the outcome was determined by the fallback path (status file missing/invalid), override to success. One approach:

  ```ts
  // After step 8 catch block, before step 9:
  if (node.autoStatus && outcome.status === 'fail') {
    const isStatusFileMissing = /* track whether status file was absent */;
    if (isStatusFileMissing) {
      outcome = { status: 'success', notes: 'auto-status: agent completed without writing status.json' };
    }
  }
  ```

  Add a corresponding test with `autoStatus: true` that verifies no status file → success outcome.

---

### FINDING-002: `terminalNodeRule` does not recognize `type='exit'` nodes — inconsistency with `isTerminal()`

- **Severity:** MEDIUM
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/validation/rules.ts:40-54`, `src/model/graph.ts:78-80`
- **Description:** `isTerminal()` (graph.ts:78) identifies terminal nodes as:
  ```ts
  node.shape === 'Msquare' || node.type === 'exit' || node.id === 'exit' || node.id === 'end'
  ```

  But `terminalNodeRule` (rules.ts:41-42) uses only:
  ```ts
  n.shape === 'Msquare' || n.id === 'exit' || n.id === 'end'
  ```

  It omits `n.type === 'exit'`. This means a node declared with `type='exit'` (but without shape `Msquare` and with a non-exit/end id) is treated as terminal at runtime by `isTerminal()`, but the validator does not count it when checking whether at least one terminal node exists. A graph with only a `type='exit'` node would fire a false `terminal_node` error from the validator, then succeed at runtime — the opposite of what should happen.

- **Recommendation:** Add `n.type === 'exit'` to the filter predicate in `terminalNodeRule`:
  ```ts
  const exitNodes = [...graph.nodes.values()].filter(
    (n) => n.shape === 'Msquare' || n.type === 'exit' || n.id === 'exit' || n.id === 'end'
  );
  ```
  Update the error message to mention `type=exit` as a valid terminal indicator. Add a validator test with a `type='exit'` node to verify no `terminal_node` error is emitted.

---

### FINDING-003: `exitNoOutgoingRule` only validates the first terminal node; multi-exit graphs partially bypassed

- **Severity:** MEDIUM
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/validation/rules.ts:72-86`, `src/model/graph.ts:69-75`
- **Description:** `exitNoOutgoingRule` calls `findExitNode(graph)` which returns the **first** terminal node found (graph.ts:69-75 iterates `graph.nodes.values()` and returns on first `Msquare` match, then falls back to id-based lookups). If a graph has multiple terminal nodes, only the first one is validated for outgoing edges. A second exit node with outgoing edges would pass validation silently.

  Furthermore, `findExitNode` itself uses only shape and id criteria (no `type === 'exit'`), compounding the gap from FINDING-002: a `type='exit'` node with outgoing edges would not be checked by `exitNoOutgoingRule` at all.

- **Recommendation:** Refactor `exitNoOutgoingRule` to iterate all terminal nodes using the same complete predicate from FINDING-002:
  ```ts
  function exitNoOutgoingRule(graph: Graph): Diagnostic[] {
    const exitNodes = [...graph.nodes.values()].filter(
      (n) => n.shape === 'Msquare' || n.type === 'exit' || n.id === 'exit' || n.id === 'end'
    );
    return exitNodes
      .filter((exit) => outgoingEdges(graph, exit.id).length > 0)
      .map((exit) => ({
        rule: 'exit_no_outgoing',
        severity: 'error' as const,
        message: 'Exit node must not have outgoing edges',
        nodeId: exit.id,
      }));
  }
  ```

---

### FINDING-004: `cmdRun` applies transforms twice — once in CLI, once inside `run()`

- **Severity:** LOW
- **Category:** Code Quality
- **Status:** RESOLVED
- **File(s):** `src/cli.ts:100`, `src/engine/runner.ts:117`
- **Description:** `cmdRun` calls `applyTransforms(graph)` at line 100, then passes the graph to `run()`. Inside `run()`, `runner.ts:117` calls `applyTransforms(graph)` again on the same mutable graph object. Every transform is applied twice.

  Currently `applyTransforms` only substitutes `$goal` tokens in node prompts — applying this twice is idempotent since no `$goal` tokens remain after the first pass. However, this is fragile: any future non-idempotent transform (e.g., one that appends text, increments a counter, or normalizes lossy data) would produce incorrect results silently.

- **Recommendation:** Remove the `applyTransforms(graph)` call from `cmdRun` (cli.ts line 100). The internal call in `runner.ts` is the canonical pre-execution location. The CLI's `validate(graph)` call before `run()` will then operate on the untransformed graph — this is acceptable since `runner.ts` also calls `validateOrThrow(graph)` internally and will catch structural errors before execution begins.

  Alternatively, if the pre-run CLI validation should always see the transformed graph, keep the CLI's `applyTransforms` call and remove the one from `runner.ts`. Choose one authoritative location.

---

### FINDING-005: `stack.manager_loop` is registered as a handler but absent from `KNOWN_TYPES` — spurious validation warning

- **Severity:** LOW
- **Category:** Code Quality
- **Status:** RESOLVED
- **File(s):** `src/handlers/registry.ts:28,37-43`, `src/validation/rules.ts:165-174`
- **Description:** `HandlerRegistry` registers a stub handler for `'stack.manager_loop'` (the type mapped from `house` shape via `SHAPE_TO_TYPE`), meaning the runtime will handle nodes of this type (returning `fail` with an "unimplemented" message). However, `KNOWN_TYPES` in `rules.ts:165-174` does not include `'stack.manager_loop'`.

  As a result, any graph with a `house`-shaped node (which the parser maps to type `stack.manager_loop`) will receive a `type_known` validation **warning** claiming the type is unrecognized, even though the runtime handles it (however minimally). The validator test at line 235-248 intentionally asserts this warning, documenting the inconsistency rather than correcting it.

- **Recommendation:** Add `'stack.manager_loop'` to `KNOWN_TYPES` and update the corresponding validator test to assert the warning is **not** emitted. Alternatively, if the feature is truly deferred, remove the `house` → `stack.manager_loop` mapping from `SHAPE_TO_TYPE` and remove the stub handler registration, so users get a clean "unrecognized type" warning from the validator and a "no handler" error at runtime — consistent failure modes.

---

### FINDING-006: `tool.stderr` context key in `ToolHandler` is not covered by any test

- **Severity:** LOW
- **Category:** Test Quality
- **Status:** RESOLVED
- **File(s):** `src/handlers/tool.ts:88`, `test/handlers/tool-handler.test.ts`
- **Description:** `ToolHandler.execute()` sets `contextUpdates['tool.stderr']` at `tool.ts:88` alongside `tool.output` and `tool.exit_code`. There is no test in `test/handlers/tool.test.ts` or any other test file that asserts `contextUpdates['tool.stderr']` is set. A search for `tool.stderr` and `tool_stderr` across the entire test directory returns no matches.

  If the `'tool.stderr'` key were accidentally renamed or removed, no test would catch the regression.

- **Recommendation:** Add a test case in `tool.test.ts` that runs a command which writes to stderr and asserts that `contextUpdates['tool.stderr']` is present with the expected content. An already-failing command test is the natural place for this, since stderr is captured in both success and failure cases.

- **Resolution:** Added two tests to `test/handlers/tool-handler.test.ts`: one verifying `tool.stderr` is set on success (command writes to stderr, exits 0) and one on failure (command writes to stderr, exits nonzero). 320 tests passing.

---

### FINDING-007: Two test cases in `parseStatusFile` block share an identical description

- **Severity:** TRIVIAL
- **Category:** Test Quality
- **Status:** OPEN
- **File(s):** `test/handlers/codergen.test.ts:583,610`
- **Description:** Two separate `it()` calls in the `parseStatusFile` describe block share the identical description `'defaults to fail when outcome field is missing'` (lines 583 and 610). Both test the same scenario (missing outcome field) with slightly different input and assertion styles (the second uses `toContain` instead of `toBe`). Duplicate test descriptions create ambiguity in test output and CI logs.

- **Recommendation:** Give the second test a distinct description (e.g., `'defaults to fail when outcome field is missing (notes used as failureReason)'`) or merge the two into a single test case.

---

## Statistics

| Severity | Count |
|----------|-------|
| HIGH     | 1     |
| MEDIUM   | 2     |
| LOW      | 3     |
| TRIVIAL  | 1     |
| **Total**| **7** |

| Category        | Count |
|-----------------|-------|
| Spec Compliance | 2     |
| Correctness     | 1     |
| Test Quality    | 2     |
| Code Quality    | 2     |

FINDING-001 (HIGH) must be fixed — `autoStatus` is a named feature in the spec that is completely unimplemented at runtime. FINDING-002 and FINDING-003 (MEDIUM) should be fixed together as they share the same root cause (inconsistent terminal-node detection predicate). FINDING-004, FINDING-005, and FINDING-006 (LOW) are quality improvements that reduce fragility and improve test coverage. FINDING-007 (TRIVIAL) is a minor test hygiene issue.
