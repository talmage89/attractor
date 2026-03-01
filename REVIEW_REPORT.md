# Code Review Report

**Date:** 2026-03-01
**Reviewer:** sixteenth-pass
**Test Status:** All passing (339/339 across 22 test files)

---

## Summary

This is the sixteenth code review pass of the Attractor TypeScript DAG pipeline execution engine. All 339 tests pass and the codebase remains in excellent shape after 15 prior review cycles. This pass surfaces 2 findings: both LOW severity. FINDING-001 is a persistent inconsistency in the CLI where `cmdRun` validates the graph without first applying transforms, while `cmdValidate` correctly applies transforms first. FINDING-002 is a test coverage gap: the CLI command functions (`cmdRun`, `cmdValidate`, `cmdVisualize`) have no tests at all, which is why FINDING-001 was never caught automatically. No critical, high, or medium issues were found.

---

## Findings

### FINDING-001: `cmdRun` validates without applying transforms first — inconsistent with `cmdValidate`

- **Severity:** LOW
- **Category:** Code Quality / Spec Compliance
- **Status:** OPEN
- **File(s):** `src/cli.ts:99-100`
- **Description:** The `cmdRun` function calls `validate(graph)` immediately after `parse(source)` without first calling `applyTransforms(graph)`:

  ```ts
  // src/cli.ts (cmdRun)
  const graph = parse(source as string);
  const diags = validate(graph);   // ← no applyTransforms before this!
  ```

  In contrast, `cmdValidate` correctly calls `applyTransforms` first:

  ```ts
  // src/cli.ts (cmdValidate)
  const graph = parse(source as string);
  applyTransforms(graph);          // ← correct
  const diags = validate(graph);
  ```

  The spec (Section 8.2) requires that transforms be applied before validation: "Apply transforms: variable expansion, stylesheet application. Run `validateOrThrow(graph)`. Abort on errors." The `run()` function itself applies transforms internally (`applyTransforms(graph)` at runner.ts:117) before calling `validateOrThrow`, so pipeline *execution* is not affected — the graph is transformed correctly during the `run()` call. The problem is the early-exit validation feedback printed to the user in `cmdRun`. If the user runs `attractor run pipeline.dot`, they get validation output from an untransformed graph while `attractor validate pipeline.dot` produces output from a transformed graph.

  In practice no current validation rule produces a different result on the transformed graph vs the raw graph (transforms expand `$goal` in `node.prompt` and apply stylesheet `llmModel`/`llmProvider`/`reasoningEffort` overrides to nodes — none of the 15 validation rules inspect those fields after transformation). However, the inconsistency violates the principle of least surprise: users expect `attractor run` and `attractor validate` to apply the same rules. Any future validation rule that depends on transformed data (e.g. a rule that checks expanded prompt content, or a rule that validates that a stylesheet-applied model name is non-empty) would silently produce incorrect results from `cmdRun`.

  The memory notes that FINDING-001 in review cycle 13 was described as "added `applyTransforms` before validate in `cmdRun`" — but examining the current source shows this fix was either never applied or was subsequently reverted.

- **Recommendation:** Add `applyTransforms(graph)` between `parse()` and `validate()` in `cmdRun`, matching `cmdValidate`:

  ```ts
  const graph = parse(source as string);
  applyTransforms(graph);          // add this line
  const diags = validate(graph);
  ```

  Note: the `run()` call on line 152 passes the same `graph` object, and `run()` internally calls `applyTransforms(graph)` again (which is idempotent — applying transforms twice is safe because stylesheet application only sets properties when not already set via raw node attributes, and `$goal` expansion is a string replace). Alternatively, the early `validate()` call in `cmdRun` could be removed entirely and replaced with a call to `validateOrThrow()` inside the `try/catch` around `run()`, relying on `run()`'s internal validation for the error check. Either approach would fix the inconsistency.

---

### FINDING-002: CLI command functions have no test coverage

- **Severity:** LOW
- **Category:** Test Quality
- **Status:** OPEN
- **File(s):** `test/cli/cli.test.ts`, `src/cli.ts`
- **Description:** The file `test/cli/cli.test.ts` tests only the `formatEvent` pure function. The three CLI command functions — `cmdRun`, `cmdValidate`, and `cmdVisualize` — have zero test coverage:

  ```ts
  // test/cli/cli.test.ts — only this export is tested:
  import { formatEvent } from "../../src/cli.js";
  ```

  No test imports or exercises `cmdRun`, `cmdValidate`, or `cmdVisualize`. The integration tests in `test/integration/end-to-end.test.ts` test `run()` and `validate()` directly, bypassing the CLI layer entirely.

  As a result:
  - FINDING-001 (the missing `applyTransforms` in `cmdRun`) was not caught by tests and persisted across multiple review cycles.
  - CLI argument parsing, exit code behavior, diagnostic formatting, and error handling in these three functions cannot regress visibly.
  - Incorrect CLI option handling (e.g. `--permission-mode` parsing, `--resume` path handling) would be invisible until a manual smoke test.

  The CLI functions call `process.exit()` and write to `process.stderr`/`process.stdout`, which makes unit testing them require mocking. However, lightweight integration tests are straightforward to write by invoking the functions via a helper that captures output and stubs `process.exit`.

- **Recommendation:** Add targeted tests for at least `cmdRun` and `cmdValidate` covering:
  1. `cmdValidate` on a valid pipeline produces zero error diagnostics and exits with code 0.
  2. `cmdValidate` on an invalid pipeline (missing start node) exits with code 2 and prints error diagnostics.
  3. `cmdRun` on a valid pipeline applies transforms before validating (regression test for FINDING-001: a pipeline where the `promptOnLlmNodesRule` or a future rule depends on the transformed graph should produce correct diagnostics).
  4. `cmdRun` with a missing dotfile exits with code 3 and prints usage.

  These tests can mock `process.exit` via `vi.spyOn(process, 'exit').mockImplementation(() => { throw new ExitError(code); })` and capture stderr by overriding `process.stderr.write`.

---

## Statistics

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 0     |
| MEDIUM   | 0     |
| LOW      | 2     |
| TRIVIAL  | 0     |
| **Total**| **2** |

| Category       | Count |
|----------------|-------|
| Code Quality   | 1     |
| Test Quality   | 1     |

Both findings are LOW severity. FINDING-001 is a concrete code inconsistency with a one-line fix. FINDING-002 is a structural test gap that allowed FINDING-001 to persist. Neither affects the correctness of pipeline execution — the `run()` engine path is fully correct and covered by 339 passing tests.
