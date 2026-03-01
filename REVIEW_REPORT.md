# Code Review Report

**Date:** 2026-03-01
**Reviewer:** AI Agent (second-pass)
**Test Status:** All passing (237/237)

## Summary

This is a fresh second-pass review conducted after all 15 findings from the first review were resolved. The implementation is functionally correct for the majority of use cases. Three MEDIUM spec deviations were found: (1) the session map is never persisted to checkpoints so full-fidelity CC sessions are lost on crash recovery, (2) `WaitForHumanHandler` returns `"fail"` on an unrecognized answer instead of defaulting to the first choice as the spec requires, and (3) `cmdRun` validates the graph before transforms are applied. Several LOW findings relate to missing defaults and a minor status parsing inversion.

---

## Findings

### FINDING-001: sessionMap never populated in checkpoint; full-fidelity sessions lost on resume

- **Severity:** HIGH
- **Category:** Spec Compliance / Correctness
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:283-295`, `src/model/checkpoint.ts:5-13`
- **Description:** The spec (Section 10.3) says: "Restore session manager from `checkpoint.sessionMap`." The `Checkpoint` interface contains a `sessionMap: Record<string, string>` field for persisting CC session IDs (keyed by `threadId`). However, the runner always saves `sessionMap: {}` (empty) at every checkpoint. The `SessionManager` instance lives inside `CodergenHandler` and has no connection to the runner's checkpoint-saving logic. On resume, `checkpoint.sessionMap` is loaded but nothing in the runner applies it anywhere. Result: pipelines using `full` fidelity with shared thread IDs will lose their CC session continuity on crash/resume — the resumed nodes start fresh CC sessions instead of continuing the conversation. The spec also notes that for the first node after resume, `full` fidelity should degrade to `summary:high` (Section 10.3, step 6), which is also not implemented.
- **Recommendation:** Thread `SessionManager` into `RunConfig` (add `sessionManager?: SessionManager`). In `run()`: (a) create a `SessionManager` and pass it in `RunConfig` if not provided, (b) pass the session manager to `CodergenHandler` via the registry setup step or directly in RunConfig, (c) populate `sessionMap: sessionManager.snapshot()` when saving checkpoints, (d) call `sessionManager.restore(checkpoint.sessionMap)` when resuming. Also implement the fidelity degradation for the first node after resume.
- **Fix:** Added `sessionManager?: SessionManager` to `RunConfig`. `run()` now creates a `SessionManager` from config or new, calls `sessionManager.restore(checkpoint.sessionMap)` on resume, and uses `sessionManager.snapshot()` when saving both mid-run and final checkpoints. `cli.ts` now creates a shared `SessionManager`, constructs `CodergenHandler` with it, and passes both `sessionManager` and `registry` to `run()`, establishing the connection between the handler and the checkpoint system. Two new tests added to `runner.test.ts` verify save and restore. Fidelity degradation for first-node-after-resume remains unimplemented (deferred).

---

### FINDING-002: WaitForHumanHandler returns "fail" on unrecognized answer instead of defaulting to first choice

- **Severity:** MEDIUM
- **Category:** Spec Compliance / Correctness
- **Status:** RESOLVED
- **File(s):** `src/handlers/wait-human.ts:86-97`
- **Description:** The spec (Section 9.7) says when no choice matches the user's answer, fall back to the first choice: `choices.find(...) ?? choices[0]`. The implementation instead returns `{ status: "fail", failureReason: "Unknown choice: ..." }`. This means if a user types an unrecognized response (a typo, or the full label instead of the accelerator key, or anything the matching logic doesn't handle), the human gate immediately fails and the pipeline takes the failure path. The spec's intent is that an unrecognized answer gracefully defaults to the first available choice, allowing pipelines to continue.
- **Recommendation:** Change the not-found branch to return the first-choice result instead of fail:
  ```typescript
  const selected = choices.find(...) ?? choices[0];
  // then return { status: "success", suggestedNextIds: [selected.to], ... }
  ```
- **Fix:** Changed `choices.find(...) ?? choices[0]` — the `if (!selected)` fail branch was removed and `choices[0]` is now used as the nullish-coalescing fallback. Added a test covering the unrecognized answer case. 240 tests pass.

---

### FINDING-003: WaitForHumanHandler returns "fail" on timeout/skip without default instead of "retry"

- **Severity:** MEDIUM
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/handlers/wait-human.ts:78-83`
- **Description:** The spec (Section 9.7) says: `return { status: "retry", failureReason: "Human gate timeout, no default" }` when `TIMEOUT` or `SKIPPED` is received and no `human.default_choice` is configured. The implementation returns `{ status: "fail", failureReason: "Human gate timed out or was skipped with no default choice" }`. With `"retry"` status, nodes that have `max_retries > 0` would re-prompt the human. With `"fail"`, the pipeline immediately routes to the fail path. For fully unattended pipelines with human gates and no defaults configured, this causes immediate failure instead of giving the human a second chance.
- **Recommendation:** Change the return value to `{ status: "retry", failureReason: "Human gate timed out or was skipped with no default choice" }` to match the spec.
- **Fix:** Changed `status: "fail"` to `status: "retry"` and updated the `failureReason` message to match the spec. Added a test covering SKIPPED with no default. 241 tests pass.

---

### FINDING-004: cmdRun validates graph before transforms are applied

- **Severity:** MEDIUM
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/cli.ts:87-97`
- **Description:** The spec (Section 15, `attractor run` steps 1-3) specifies: "1. Read and parse the DOT file. 2. Apply transforms. 3. Validate." In `cmdRun`, `validate(graph)` is called at line 90 before `run()`, which applies transforms internally. So validation happens on the untransformed graph: `$goal` placeholders have not been expanded in node prompts, and stylesheet rules have not been applied. A stylesheet syntax validation would still catch problems (since `stylesheetSyntaxRule` re-parses the stylesheet string). However, the validation results are technically operating on a different state than what the engine will actually use, which is confusing and may give incorrect results as new rules are added.
- **Recommendation:** Call `applyTransforms(graph)` in `cmdRun` before `validate()`. Since `applyTransforms` is idempotent (the second call inside `run()` is a no-op), double application is safe. Update the comment at line 87 accordingly.
- **Fix:** Added `applyTransforms(graph)` call between `parse()` and `validate()` in `cmdRun`. Updated the comment to explain that `applyTransforms` is idempotent so the second call inside `run()` is a no-op. All 241 tests pass.

---

### FINDING-005: cc-backend missing default model and maxTurns

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/backend/cc-backend.ts:47-66`
- **Description:** The spec (Section 7.2) specifies that the `query()` call should use `model: options.model ?? "claude-sonnet-4-5-20250514"` and `maxTurns: options.maxTurns ?? 200` as defaults. The implementation only sets `model`, `maxTurns`, and `effort` if they are explicitly provided (`if (options.model !== undefined) queryOptions.model = options.model`). When not provided, the CC SDK uses its own internal defaults, which may differ from the spec's intended defaults. In particular, if the SDK defaults to a different model or a lower turn limit, pipeline behavior could differ unexpectedly.
- **Recommendation:** Apply the spec's defaults: `queryOptions.model = options.model ?? "claude-sonnet-4-5-20250514"` and `queryOptions.maxTurns = options.maxTurns ?? 200`. Effort can remain conditional since `"high"` may already be the SDK default.
- **Fix:** Replaced conditional `if (options.model !== undefined)` and `if (options.maxTurns !== undefined)` assignments with `queryOptions.model = options.model ?? "claude-sonnet-4-5-20250514"` and `queryOptions.maxTurns = options.maxTurns ?? 200`. Added a test verifying defaults are applied when neither option is specified. 242 tests pass.

---

### FINDING-006: parseStatusFile defaults invalid/missing outcome to "fail" instead of "success"

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/handlers/codergen.ts:73-86`
- **Description:** The spec (Section 9.5) shows `parseStatusFile` as returning `status: parseStageStatus(obj.outcome as string) ?? "success"` — defaulting to `"success"` when the outcome field is missing or unrecognized. The implementation defaults to `"fail"`. A CC agent that writes a status file with `{ "outcome": "done" }` (invalid status string) will get `"fail"` in the implementation but `"success"` in the spec. More significantly, if the `outcome` field is missing entirely, the spec treats it as success while the implementation fails the node. The spec's fallback-to-CC-success path (the `catch` block) only handles the case where the file itself can't be read or parsed, not where `outcome` is absent/invalid.
- **Recommendation:** Change the default in the `else` branch from `"fail"` to `"success"` to match the spec: if the CC agent wrote a parseable status file but omitted the `outcome` field, treat it as success.
- **Fix:** Changed `status = "fail"` to `status = "success"` in the unrecognized-outcome `else` branch of `parseStatusFile`. Added two tests: one verifying a missing `outcome` field defaults to `"success"`, another verifying an unrecognized string (e.g. `"done"`) also defaults to `"success"`. 244 tests pass.

---

### FINDING-007: parallel.ts does not emit event warning for unrecognized join_policy

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/handlers/parallel.ts:88-91`
- **Description:** The Phase 8 spec says: "If an unrecognized join policy is encountered, treat it as `wait_all` and emit a warning via `config.onEvent`." The implementation silently treats unrecognized values as `wait_all` without any event or log. While there is no `"warning"` event type defined in `PipelineEvent`, the spec's intent is to make the fallback visible. Users who misconfigure `join_policy="k_of_n"` (which is listed in the source spec but deferred) would get silent fallback to `wait_all` with no indication.
- **Recommendation:** When `joinPolicy` is neither `"wait_all"` nor `"first_success"`, write a message to `process.stderr` or emit a custom event, so the operator knows the configured policy was not honored.
- **Fix:** When `joinPolicy` is an unrecognized value, `process.stderr.write()` is now called with a message including the node ID, the unrecognized policy name, and the fallback policy. A test verifies the warning is emitted and that behavior falls back to `wait_all`. 245 tests pass.

---

### FINDING-008: evaluator.ts resolveKey treats empty context value as "not found"

- **Severity:** TRIVIAL
- **Category:** Correctness
- **Status:** RESOLVED
- **File(s):** `src/conditions/evaluator.ts:12-16`
- **Description:** In `resolveKey`, when a key starts with `"context."`:
  ```typescript
  const full = context.getString(key);
  if (full !== "") return full;
  return context.getString(key.slice(8));
  ```
  If the context explicitly contains the key `context.foo` with value `""` (empty string), the condition `full !== ""` is false, so it falls through and tries `context.getString("foo")` instead. This means a key explicitly set to `""` is indistinguishable from a missing key — the fallback fires incorrectly. In practice, pipeline stages rarely set empty-string context values, but it is a correctness gap.
- **Recommendation:** Use `context.has(key)` instead of checking for non-empty string: `if (context.has(key)) return context.getString(key);`.
- **Fix:** Replaced `const full = context.getString(key); if (full !== "") return full;` with `if (context.has(key)) return context.getString(key);`. Added a test verifying that when `context.flag` is explicitly set to `""` and `flag` is set to `"yes"`, the condition `context.flag=yes` correctly evaluates to false and `context.flag=` evaluates to true. 246 tests pass.

---

## Statistics

- Total findings: 8
- Critical: 0
- High: 1 (RESOLVED)
- Medium: 3 (RESOLVED)
- Low: 3 (2 RESOLVED, 1 RESOLVED)
- Trivial: 1 (RESOLVED)
