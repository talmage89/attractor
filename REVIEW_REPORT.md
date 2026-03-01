# Code Review Report

**Date:** 2026-03-01
**Reviewer:** AI Agent (eighth-pass)
**Test Status:** All passing (260/260)

## Summary

The codebase is in excellent shape after seven prior review cycles. This eighth-pass review found no critical or high severity issues. One medium-severity issue was identified (the runner unconditionally overwrites caller-registered handlers for start/exit/wait.human, limiting library extensibility). Three low-severity spec compliance gaps and two trivial nits round out the findings.

---

## Findings

### FINDING-001: `runner.ts` unconditionally overwrites caller-registered start/exit/wait.human handlers

- **Severity:** MEDIUM
- **Category:** Correctness / Integration
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:107-109`
- **Description:** Every call to `run()` unconditionally registers three handlers on the caller-supplied registry:
  ```typescript
  registry.register("start", { async execute() { return { status: "success" }; } });
  registry.register("exit",  { async execute() { return { status: "success" }; } });
  registry.register("wait.human", new WaitForHumanHandler(config.interviewer));
  ```
  `HandlerRegistry.register()` is a plain `Map.set()` — it overwrites any previously registered handler for the same key. This means a library user who creates a custom registry, registers a `"start"` handler that performs setup work, then calls `run()`, will have that handler silently replaced with the stub. The same applies to custom `"exit"` or `"wait.human"` handlers. There is no warning or error. The public API (`HandlerRegistry.register()`) implies full control over registered types, but `run()` violates that contract for three specific types.
  - **Practical impact for `wait.human`:** If a caller registers their own `WaitForHumanHandler` (e.g., with a specialized interviewer or decorated logic), `run()` replaces it with one wrapping `config.interviewer`. The documented contract of passing both `registry` and `interviewer` is inconsistent.
  - **Practical impact for `start`/`exit`:** The stubs always return success, so overwriting a no-op custom handler has no behavioral effect. But overwriting a setup-performing custom handler silently breaks the caller.
- **Recommendation:** Change the registration strategy to use conditional registration — only register the built-in handler if no handler for that type has already been registered:
  ```typescript
  if (!registry.hasHandler("start")) {
    registry.register("start", { async execute() { return { status: "success" }; } });
  }
  ```
  This requires adding a `hasHandler(type: string): boolean` method to `HandlerRegistry`. Alternatively, document the overwrite behavior explicitly in the JSDoc for `run()` and `RunConfig`, so callers know not to pre-register these three types.
- **Resolution:** Added `hasHandler(typeString: string): boolean` to `HandlerRegistry`. Changed the three unconditional `registry.register()` calls in `run()` to conditional ones guarded by `!registry.hasHandler(...)`. Added a test verifying that caller-registered start/exit handlers are not overwritten.

---

### FINDING-002: `CodergenHandler` fallback success outcome omits spec-specified `notes` and `contextUpdates`

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/handlers/codergen.ts:209-218`
- **Description:** When CC executes successfully but the agent did not write a `status.json` file, the implementation falls back to:
  ```typescript
  outcome = { status: "success" };
  ```
  The spec (Section 9.5) specifies the fallback should be:
  ```typescript
  outcome = {
    status: "success",
    notes: `Stage completed: ${node.id}`,
    contextUpdates: {
      last_stage: node.id,
      last_response: ccResult.text.slice(0, 200),
    },
  };
  ```
  The `last_stage` and `last_response` context keys are useful for downstream stages that need to observe what the previous node did (e.g., a conditional node or a codergen node whose prompt references `$context.last_response`). The current bare fallback provides no context to subsequent stages.
- **Recommendation:** Update the fallback success case to match the spec, adding `notes` and `contextUpdates` with `last_stage` and `last_response`:
  ```typescript
  outcome = {
    status: "success",
    notes: `Stage completed: ${node.id}`,
    contextUpdates: {
      last_stage: node.id,
      last_response: ccResult.text.slice(0, 200),
    },
  };
  ```

---

### FINDING-003: Exit node handler failure is not reflected in `RunResult.status`

- **Severity:** LOW
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:261-296`
- **Description:** The terminal branch of the traversal loop executes the exit handler (an intentional spec extension documented in the code), then checks goal gates. However, `finalStatus` is only set to `"fail"` if a goal gate is unsatisfied or the goal gate retry limit is exceeded. If the exit handler returns `{ status: "fail" }`, the outcome is ignored with respect to `finalStatus`, and the pipeline reports `"success"` as long as goal gates are satisfied.

  The `ExitHandler` always returns `{ status: "success" }`, so this has no effect in standard usage. But as a library, a user registering a custom exit handler could reasonably expect that returning `fail` causes the pipeline to fail. The current behavior is surprising and undocumented.
- **Recommendation:** After executing the exit handler, propagate a `fail` outcome to `finalStatus` if no goal gate retry is triggered:
  ```typescript
  if (!gateResult.satisfied && retryTarget && ...) {
    // retry
  } else if (!gateResult.satisfied || exitOutcome.status === "fail") {
    finalStatus = "fail";
    break loop;
  } else {
    break loop;
  }
  ```
  Alternatively, document explicitly (in a JSDoc comment on `run()` or in the code) that exit handler failures are intentionally ignored when goal gates pass.
- **Resolution:** After the goal-gate check block in the terminal branch, added `if (exitOutcome.status === "fail") { finalStatus = "fail"; }` before `break loop`. Added a test verifying that a custom exit handler returning `fail` causes `RunResult.status` to be `"fail"` even when all goal gates pass.

---

### FINDING-004: `isStartNode` detection in runner.ts is inconsistent with `findStartNode`

- **Severity:** LOW
- **Category:** Correctness / Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:300`, `src/model/graph.ts:60-67`
- **Description:** The runner excludes the start node from `completedNodes` and `nodeOutcomes` via this check:
  ```typescript
  const isStartNode = currentNode.shape === "Mdiamond" || currentNode.type === "start";
  ```
  But `findStartNode` (which determines _which_ node to start execution from) uses different criteria:
  ```typescript
  if (node.shape === "Mdiamond") return node;
  return graph.nodes.get("start") ?? graph.nodes.get("Start") ?? null;
  ```
  The validation rule `startNodeRule` also recognizes `id === "start"` or `id === "Start"` as valid start nodes.

  **Consequence:** A node with `id = "start"` (valid start node per spec) but without `shape === "Mdiamond"` and without an explicit `type = "start"` attribute would be:
  - Correctly found as the start node by `findStartNode` ✓
  - Correctly flagged as a start node by the validator ✓
  - Incorrectly **included** in `completedNodes` and `nodeOutcomes` by the runner ✗

  Including the start node in `nodeOutcomes` could trigger incorrect goal gate evaluation if the start node happens to have `goal_gate = true`, or create unexpected entries in checkpoint data.
- **Recommendation:** Unify the start node detection. The simplest fix is to compare the current node against the result of `findStartNode`:
  ```typescript
  const isStartNode = currentNode.id === startNode.id;
  ```
  Or add `id === "start" || id === "Start"` to the `isStartNode` check to match `findStartNode`'s fallback logic.
- **Resolution:** Changed the `isStartNode` check on runner.ts:310 from the shape/type heuristic to `currentNode.id === startNode.id`, which delegates to the already-computed `startNode` reference. Added a test verifying that a start node named `"start"` (no `shape=Mdiamond`, no `type` attribute) is excluded from `completedNodes`.

---

### FINDING-005: `handlerTypeFor` in `runner.ts` duplicates `SHAPE_TO_TYPE` from `registry.ts`

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/engine/runner.ts:73-88`, `src/handlers/registry.ts:19-29`
- **Description:** `runner.ts` contains a local `shapeMap` object used exclusively for emitting `stage_started` events:
  ```typescript
  const shapeMap: Record<string, string> = {
    Mdiamond: "start",
    Msquare: "exit",
    box: "codergen",
    hexagon: "wait.human",
    diamond: "conditional",
    component: "parallel",
    tripleoctagon: "parallel.fan_in",
    parallelogram: "tool",
    house: "stack.manager_loop",
  };
  ```
  This is identical (with one minor cosmetic difference: the comment) to `SHAPE_TO_TYPE` in `registry.ts`. If a new handler type is added, both maps must be updated, increasing the risk of inconsistency.
- **Recommendation:** Import and reuse `SHAPE_TO_TYPE` from `registry.ts` in `handlerTypeFor`:
  ```typescript
  import { SHAPE_TO_TYPE } from "../handlers/registry.js";
  // ...
  return SHAPE_TO_TYPE[node.shape] ?? "default";
  ```

---

### FINDING-006: Step label comment "e. CHECKPOINT" appears after steps f and g in `runner.ts`

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/engine/runner.ts:375-376`
- **Description:** The spec defines the traversal loop steps in order: b (execute), c (record), d (apply context), e (checkpoint), f (select edge), g (loop restart), h (advance). The implementation intentionally reorders these — checkpoint is saved **after** edge selection (f) and loop restart check (g) so the checkpoint can record `edge.to` (the next node) directly. This is a valid design decision noted in the comment `"(save with nextNode = edge.to)"`.

  However, the comment still uses the spec's letter "e" for the checkpoint step, which now appears between the code for steps g and h. This makes the code harder to audit for spec compliance — it looks like step e is out of order rather than being an intentional implementation choice.
- **Recommendation:** Rename the comment to make the intentional deviation explicit:
  ```typescript
  // CHECKPOINT — intentionally placed after edge selection (spec step e)
  // so we can record currentNode = edge.to (the node to resume from).
  ```
  This removes the misleading spec step letter and makes the reasoning transparent.

---

## Statistics

- Total findings: 6
- Critical: 0
- High: 0
- Medium: 1
- Low: 3
- Trivial: 2
