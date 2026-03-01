# Code Review Report

**Date:** 2026-03-01
**Reviewer:** thirteenth-pass
**Test Status:** All passing (313/313 across 21 test files)

---

## Summary

This is the thirteenth code review pass of the Attractor TypeScript DAG pipeline execution engine. The prior twelve passes resolved 78 findings. The codebase is in excellent shape: all 313 tests pass, architecture is clean and well-layered, and spec compliance is high. This pass surfaces 3 findings — 1 LOW and 2 TRIVIAL. There are no HIGH or CRITICAL issues. The codebase is close to production-ready.

---

## Findings

### FINDING-001: `cmdRun` validates the raw (pre-transform) graph; `cmdValidate` validates the post-transform graph

- **Severity:** LOW
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/cli.ts:96-103`
- **Description:** The two validation commands behave inconsistently with respect to graph transforms. `cmdValidate` calls `applyTransforms(graph)` before `validate(graph)`, so the user sees diagnostics on the fully-transformed graph. `cmdRun` calls `validate(graph)` on the raw, untransformed graph (transforms are applied later, inside `run()`):

  ```ts
  // cmdRun (cli.ts ~line 96)
  const graph = parse(source as string);
  const diags = validate(graph);    // <-- raw graph, no transforms applied yet
  ...
  result = await run({ graph, ... });
  // Inside run(): applyTransforms(graph); validateOrThrow(graph);
  ```

  In practice this causes no observable bug today because the current transforms (goal variable substitution, stylesheet application) do not affect which validation rules fire. However, the inconsistency is a latent maintenance hazard: if a future transform changes a property that a validation rule inspects, `cmdRun` would silently show stale diagnostics, and the `validateOrThrow` inside `run()` would throw an uncaught error whose message would be less user-friendly than the formatted validation output.

- **Recommendation:** Add `applyTransforms(graph)` before the `validate(graph)` call in `cmdRun`. Since `applyTransforms` is idempotent, the second call inside `run()` is a harmless no-op. This brings `cmdRun` in line with `cmdValidate` and makes both commands show diagnostics on the final transformed graph:

  ```ts
  const graph = parse(source as string);
  applyTransforms(graph);   // <-- add this
  const diags = validate(graph);
  ```

---

### FINDING-002: `edge_selected` CLI format shows empty-string label for unlabeled edges

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/cli.ts:49-51`
- **Description:** In `formatEvent`, the `edge_selected` case always includes the edge label in quotes:

  ```ts
  case "edge_selected":
    return `${ts}   → edge "${event.label}" → ${event.to}`;
  ```

  When an edge has no label (the common case for unconditional default edges), `event.label` is `""`, producing output like:

  ```
  [00:05]   → edge "" → next-node
  ```

  The empty-quoted label is visually noisy and provides no information to the user. This output is only visible in `--verbose` mode, so its user impact is limited.

- **Recommendation:** Omit the label clause when the label is empty:

  ```ts
  case "edge_selected": {
    const labelPart = event.label ? ` "${event.label}"` : "";
    return `${ts}   →${labelPart} → ${event.to}`;
  }
  ```

---

### FINDING-003: `Interviewer.inform()` has no production callers

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/interviewer/interviewer.ts:7`, `src/handlers/wait-human.ts`
- **Description:** The `Interviewer` interface exposes an `inform(message: string, stage: string): void` method, and both `ConsoleInterviewer` and `AutoApproveInterviewer`/`QueueInterviewer` implement it. However, no production handler in the codebase ever calls `interviewer.inform(...)`. It is only exercised in the interviewer unit tests (to verify the method doesn't throw). The method signature and implementation are correct; the method is simply unused.

- **Recommendation:** No code change required. The method is a valid API surface for external consumers of the `Interviewer` interface (e.g., a custom UI interviewer). However, if the intent was for `WaitForHumanHandler` to call `inform()` to provide status messages during the human interaction flow (e.g., after a question is answered), the caller is missing. If that intent exists, add the call; otherwise, a brief comment in `interviewer.ts` noting it is intended for external use (not called internally) would prevent future confusion.

---

## Statistics

| Severity | Count |
|----------|-------|
| HIGH     | 0     |
| MEDIUM   | 0     |
| LOW      | 1     |
| TRIVIAL  | 2     |
| **Total**| **3** |

| Category     | Count |
|--------------|-------|
| Code Quality | 3     |

FINDING-001 (LOW) is actionable and should be fixed for consistency between the `run` and `validate` commands. FINDING-002 and FINDING-003 are trivial quality notes that require no immediate action.
