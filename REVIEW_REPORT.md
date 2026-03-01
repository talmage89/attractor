# Code Review Report

**Date:** 2026-03-01
**Reviewer:** tenth-pass
**Test Status:** All passing (266/266)

## Summary

The Attractor codebase is in excellent shape after nine prior review cycles. All major correctness and spec-compliance issues have been resolved, and the test suite is green. This tenth-pass review identifies four non-trivial findings: one MEDIUM (accumulated cost lost across loop restarts), one LOW (ConsoleInterviewer deviates from spec format), one LOW (redundant `$goal` expansion in CodergenHandler), and one LOW (`checkpoint_saved` event carries a misleading `nodeId`). Two trivial findings round out the report.

---

## Findings

### FINDING-001: `loopRestart` discards accumulated `totalCostUsd` from the first run

- **Severity:** MEDIUM
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:383`
- **Description:** When an edge with `loopRestart: true` is selected, the runner tail-calls itself and returns the result of the restarted run directly:

  ```typescript
  return run({ ...config, logsRoot: restartLogsRoot, resumeFromCheckpoint: undefined });
  ```

  The `totalCostUsd` accumulated during the first run (before the restart) is never added to the restarted run's result. Callers that display or log total pipeline cost will silently under-report it whenever a loop restart occurs. In a pipeline that loops several times before exiting, the reported cost could represent only the last iteration.

  The existing test at `test/engine/runner.test.ts:361` verifies that the restarted run executes correctly and that the final status propagates, but it does not assert on `totalCostUsd` and therefore does not catch this gap.

- **Recommendation:** Before issuing the recursive `run()` call, capture the accumulated cost and add it to the returned result:

  ```typescript
  const restartResult = await run({ ...config, logsRoot: restartLogsRoot, resumeFromCheckpoint: undefined });
  return { ...restartResult, totalCostUsd: totalCostUsd + restartResult.totalCostUsd };
  ```

  Add a test that mocks `runCC` to return non-zero `costUsd`, triggers a loop restart, and asserts the final `totalCostUsd` is the sum of both run cycles.

---

### FINDING-002: `ConsoleInterviewer` deviates from spec format

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/interviewer/console.ts:11-21`
- **Description:** The SPEC (Section 12.2) defines the following format for the console interviewer:

  ```
  console.log(`\n[?] ${question.text}  (stage: ${question.stage})`);
  ```

  followed by type-specific prompts: `"Select: "` for `multiple_choice`, `"[Y/N]: "` for `yes_no`/`confirmation`, and `"> "` for `freeform`.

  The implementation deviates in several ways:
  1. The opening `[?]` banner with stage identifier is not printed. The stage is silently dropped, making it impossible for a human operator to know which pipeline node is asking the question.
  2. For `yes_no` and `confirmation` question types, no special `"[Y/N]: "` prompt is shown — the code falls into the `else` branch appending just a space, giving the user no guidance that a yes/no answer is expected.
  3. For `freeform` questions, no `"> "` prompt is shown — again only a trailing space.

  The practical impact is reduced operator usability: when a long-running pipeline pauses for human input, the operator has no visual cue about which stage is waiting or what kind of input is expected.

- **Recommendation:** Revise `ConsoleInterviewer.ask` to match the spec format:

  ```typescript
  console.log(`\n[?] ${question.text}  (stage: ${question.stage})`);
  if (question.type === "multiple_choice" && question.options) {
    for (const opt of question.options) {
      console.log(`  [${opt.key}] ${opt.label}`);
    }
    const response = await rl.question("Select: ");
    // ... match logic
  } else if (question.type === "yes_no" || question.type === "confirmation") {
    const response = await rl.question("[Y/N]: ");
    const isYes = ["y", "yes"].includes(response.trim().toLowerCase());
    return { value: isYes ? "YES" : "NO" };
  } else if (question.type === "freeform") {
    const response = await rl.question("> ");
    return { value: response, text: response };
  }
  ```

---

### FINDING-003: Redundant `$goal` expansion in `CodergenHandler`

- **Severity:** LOW
- **Category:** Code Quality
- **Status:** OPEN
- **File(s):** `src/handlers/codergen.ts:128`
- **Description:** `CodergenHandler.execute` performs `$goal` variable substitution on the node prompt:

  ```typescript
  prompt = prompt.replace(/\$goal/g, goal);
  ```

  However, `applyTransforms` (called by the runner at startup) has already performed this substitution before any handler is invoked. After transforms run, no `$goal` token remains in any node prompt, so the `replace` call in `CodergenHandler` is always a no-op. This creates a hidden implicit dependency: if the expansion order were ever changed (e.g., transforms removed or reordered), the codergen handler's copy would silently take over — or vice-versa — making the intent unclear.

  Additionally, `cli.ts:100-101` calls `applyTransforms` explicitly before passing the graph to `run()`, which calls `applyTransforms` a second time internally. The comment says the second call is "a no-op", but the stylesheet applicator re-applies the same values to nodes that lack explicit raw attributes. While functionally idempotent, the claim of "no-op" is slightly imprecise. These three expansion sites create unnecessary fragility.

- **Recommendation:** Remove the `$goal` expansion from `CodergenHandler.execute` (lines 127-128), relying solely on `applyTransforms` for variable substitution. This makes the ownership of `$goal` expansion unambiguous. As a follow-up, add a comment in `transforms.ts` noting that `$goal` substitution is the canonical expansion point for node prompts.

---

### FINDING-004: `checkpoint_saved` event carries the completed node ID, not the resume node ID

- **Severity:** LOW
- **Category:** Correctness
- **Status:** OPEN
- **File(s):** `src/engine/runner.ts:410-414`
- **Description:** After saving a checkpoint, the runner emits:

  ```typescript
  emit(config, {
    kind: "checkpoint_saved",
    nodeId: currentNode.id,   // <-- the node just completed
    timestamp: Date.now(),
  });
  ```

  But the checkpoint saved at line 397 stores `currentNode: edge.to` — the **next** node to execute on resume. The `nodeId` in the event therefore refers to the completed node, while the checkpoint's `currentNode` refers to the node that will run next. Any consumer of `checkpoint_saved` that uses `nodeId` to understand "where the pipeline is checkpointed" will be misled: the event says "node A was checkpointed" but the actual resume point is node B.

  The SPEC defines `checkpoint_saved` with a `nodeId` field but gives no explicit guidance on which node it should name. Given the checkpoint's semantic purpose (save the resume point), `nodeId` in the event should logically match the checkpoint's `currentNode` (i.e., `edge.to`).

- **Recommendation:** Change the `checkpoint_saved` emit to use `edge.to` as the `nodeId`:

  ```typescript
  emit(config, {
    kind: "checkpoint_saved",
    nodeId: edge.to,
    timestamp: Date.now(),
  });
  ```

  Update the test in `test/engine/runner.test.ts` that asserts on `checkpoint_saved` events to verify the correct node ID is reported.

---

### FINDING-005: `"warning"` event kind is not in the SPEC's `PipelineEvent` union

- **Severity:** TRIVIAL
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/model/events.ts:33`
- **Description:** The implementation adds a `"warning"` variant to `PipelineEvent`:

  ```typescript
  | { kind: "warning"; message: string; nodeId?: string; timestamp: number }
  ```

  This variant is not listed in SPEC Section 16.1's `PipelineEvent` union. The spec ends at `"error"`. The warning event is currently emitted only by `ParallelHandler` when an unrecognized `join_policy` is encountered (`src/handlers/parallel.ts:90-95`). While this is a useful extension, it is undocumented.

- **Recommendation:** Either (a) add the `"warning"` event to the spec in `docs/SPEC.md` Section 16.1 to formally document this extension, or (b) fold the warning into an `"error"` event with an appropriate severity tag. No action is strictly required — this finding does not break any behavior.

---

### FINDING-006: `FanInHandler` always returns `"success"` regardless of branch outcomes

- **Severity:** TRIVIAL
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/handlers/fan-in.ts:46-52`
- **Description:** `FanInHandler.execute` always returns `{ status: "success" }` as the outer status, even when all branches failed:

  ```typescript
  return {
    status: "success",
    contextUpdates: {
      "parallel.fan_in.best_outcome": best.status,
      "parallel.fan_in.best_notes": best.notes ?? "",
    },
  };
  ```

  The best branch outcome (including `"fail"`) is stored in `context["parallel.fan_in.best_outcome"]` for downstream edge conditions to inspect, but the fan-in node itself always succeeds. This means edge selection from a fan-in node cannot use `outcome=fail` to route to an error handler — it must use `context.parallel.fan_in.best_outcome=fail` instead.

  The test at `test/handlers/parallel.test.ts` explicitly asserts this behavior as expected. It is likely intentional — the fan-in is a "reporting" node, not a "gate" node — but it is a subtle semantic difference from what a user might expect.

- **Recommendation:** Add a comment in `fan-in.ts` explicitly documenting that the fan-in node always succeeds and that downstream routing on branch failure should use `context.parallel.fan_in.best_outcome`. No code change is required if this behavior is intentional.

---

## Statistics

- Total findings: 6
- Critical: 0
- High: 0
- Medium: 1
- Low: 3
- Trivial: 2
