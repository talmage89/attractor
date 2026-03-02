# Code Review Report

**Date:** 2026-03-01
**Reviewer:** seventeenth-pass
**Test Status:** All passing (349/349 across 22 test files)

---

## Summary

This is the seventeenth code review pass of the Attractor TypeScript DAG pipeline execution engine. All 349 tests pass and the codebase is in excellent shape after 16 prior review cycles. This pass surfaces 3 findings: all LOW severity. FINDING-001 is a public API gap — the `Diagnostic` type (return type of the exported `validate()` function) is not itself exported from `src/index.ts`. FINDING-002 is the only remaining test coverage gap — `cmdVisualize` is exported but has no tests. FINDING-003 is a silent failure mode in checkpoint resume — if the checkpoint references a node that no longer exists in the (possibly modified) graph, the engine silently falls back to the start node instead of emitting a warning or throwing. No critical, high, or medium issues were found.

---

## Findings

### FINDING-001: `Diagnostic` type (return type of `validate()`) not exported from `src/index.ts`

- **Severity:** LOW
- **Category:** Integration / Code Quality
- **Status:** RESOLVED
- **File(s):** `src/index.ts`
- **Description:** The public API exports `validate()` and `validateOrThrow()`, both of which return `Diagnostic[]`. However, `Diagnostic` itself (and the related `Severity` type and `LintRule` function type) are not exported from `src/index.ts`:

  ```ts
  // src/index.ts — currently missing:
  // export type { Diagnostic, Severity } from "./validation/diagnostic.js";
  // export type { LintRule } from "./validation/rules.js";
  ```

  An external consumer who imports `validate` from the package and wants to type the return value or filter by severity is forced to import `Diagnostic` from a sub-path (`./validation/diagnostic.js`), bypassing the public API. This is a usability issue for library consumers and inconsistent with the fact that the functions using these types are exported.

  The same omission applies to:
  - `Severity` (used in `Diagnostic.severity`)
  - `LintRule` (the type for `extraRules` parameter in `validate()` and `validateOrThrow()`)

- **Recommendation:** Add the following exports to `src/index.ts`:

  ```ts
  export type { Diagnostic, Severity } from "./validation/diagnostic.js";
  export type { LintRule } from "./validation/rules.js";
  ```

  Optionally also export `Checkpoint` from `./model/checkpoint.js` for external tools that want to inspect or manipulate checkpoint files programmatically.

---

### FINDING-002: `cmdVisualize` has no test coverage

- **Severity:** LOW
- **Category:** Test Quality
- **Status:** OPEN
- **File(s):** `src/cli.ts`, `test/cli/cli.test.ts`
- **Description:** Review cycle 16 added tests for `cmdRun` and `cmdValidate` after exporting all three CLI command functions. However, `cmdVisualize` was exported but received no tests. It is the only exported CLI command without coverage:

  ```ts
  // test/cli/cli.test.ts — these are tested:
  describe("cmdValidate", () => { ... });
  describe("cmdRun", () => { ... });

  // missing:
  // describe("cmdVisualize", () => { ... });
  ```

  At minimum, the two error paths that don't require Graphviz to be installed should be tested:
  1. Missing dotfile argument → exits with code 3 and prints usage to stderr.
  2. Dotfile cannot be read → exits with code 3 and prints error to stderr.

  The Graphviz-dependent success path (`dot` process spawning) can be conditionally skipped using `vi.skipIf` or skipped when the `dot` binary is not found, to keep CI portable.

- **Recommendation:** Add a `describe("cmdVisualize", ...)` block in `test/cli/cli.test.ts` covering at least the argument-missing and file-not-found error paths, following the same pattern established for `cmdRun` and `cmdValidate`.

---

### FINDING-003: Silent fallback to start node when checkpoint's `currentNode` is not found in graph

- **Severity:** LOW
- **Category:** Correctness / Robustness
- **Status:** OPEN
- **File(s):** `src/engine/runner.ts:163-167`
- **Description:** When resuming from a checkpoint, the runner looks up the node to resume from in the current graph:

  ```ts
  // src/engine/runner.ts
  const resumeNode = graph.nodes.get(checkpoint.currentNode);
  if (resumeNode) {
    currentNode = resumeNode;
  }
  // No else branch: silently falls back to startNode
  ```

  If the checkpoint file references a node ID that no longer exists in the graph (e.g., the `.dot` file was modified and the node was renamed or removed after the checkpoint was saved), `resumeNode` is `undefined` and `currentNode` stays as `startNode` (initialized on line 131). The pipeline then silently restarts from the beginning.

  This silent fallback is dangerous because:
  1. The user believes they are resuming from a checkpoint, but are actually restarting from the beginning.
  2. Nodes already completed (per the restored `completedNodes`) will be re-executed, potentially writing duplicate artifacts, making duplicate API calls, or conflicting with prior results.
  3. The user gets no indication that the resume did not work as intended.

  A warning event should at minimum be emitted. A configurable strict mode could throw instead.

- **Recommendation:** Add a warning event (or throw an error) when the checkpoint node is not found:

  ```ts
  const resumeNode = graph.nodes.get(checkpoint.currentNode);
  if (resumeNode) {
    currentNode = resumeNode;
  } else {
    // Emit a warning so the user knows the resume didn't find the checkpoint node
    emit(config, {
      kind: "warning",
      message: `Checkpoint node '${checkpoint.currentNode}' not found in graph — resuming from start`,
      timestamp: Date.now(),
    });
    // currentNode remains startNode (already initialized above)
  }
  ```

  Alternatively, throw an error to make the failure explicit:

  ```ts
  if (!resumeNode) {
    throw new Error(
      `Checkpoint references node '${checkpoint.currentNode}' which does not exist in the current graph. ` +
      `The graph may have been modified after the checkpoint was saved.`
    );
  }
  ```

  Throwing is safer; a warning-based approach is more lenient. Either is better than the current silent fallback.

---

## Statistics

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 0     |
| MEDIUM   | 0     |
| LOW      | 3     |
| TRIVIAL  | 0     |
| **Total**| **3** |

| Category       | Count |
|----------------|-------|
| Integration    | 1     |
| Test Quality   | 1     |
| Correctness    | 1     |

All three findings are LOW severity. FINDING-001 and FINDING-002 are API surface/test coverage gaps with straightforward fixes. FINDING-003 is the most substantive: a silent failure mode during checkpoint resume that could cause user confusion or duplicate work, fixable with a one-line warning emission or a thrown error.
