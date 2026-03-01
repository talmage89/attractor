# Code Review Report

**Date:** 2026-03-01
**Reviewer:** AI Agent (fourth-pass)
**Test Status:** All passing (249/249)

## Summary

The codebase is in good shape after three prior review cycles. All previous findings have been resolved. This fourth-pass review found three new issues: cost information collected by `CodergenHandler` is silently discarded and never surfaced in `stage_completed` events (a functional gap that makes the CLI's cost display dead code); the `error` pipeline event variant is defined in the type union but never emitted anywhere; and the `formatEvent` function in the CLI doesn't handle `error` events specifically. One trivial constructor signature divergence was also noted.

---

## Findings

### FINDING-001: `stage_completed` events never include `costUsd` — cost display is dead code

- **Severity:** MEDIUM
- **Category:** Spec Compliance / Correctness
- **Status:** RESOLVED
- **File(s):** `src/engine/runner.ts:194-200`, `src/handlers/codergen.ts:190-196`, `src/model/outcome.ts`, `src/cli.ts:33-36`
- **Description:** The `PipelineEvent` type for `stage_completed` has `costUsd?: number`. The CLI's `formatCost(event.costUsd)` and `formatEvent` for `stage_completed` handle this field and would display `$Y.YY` in stage summaries. However, the runner always emits `stage_completed` without `costUsd`:
  ```typescript
  emit(config, {
    kind: "stage_completed",
    nodeId: currentNode.id,
    outcome,
    durationMs: Date.now() - nodeStart,
    timestamp: Date.now(),
    // costUsd is never provided
  });
  ```
  The root cause is architectural: `CodergenHandler` has access to `ccResult.costUsd` (a non-zero float after real CC execution), but the `Outcome` interface has no `costUsd` field, so the value cannot be passed back to the runner. As a result, every `stage_completed` event has `costUsd: undefined`, `formatCost` always returns `""`, and users never see cost information in pipeline progress output — even though real CC runs incur measurable costs.
- **Recommendation:** Add `costUsd?: number` to the `Outcome` interface in `src/model/outcome.ts`. In `CodergenHandler.execute()`, set `outcome.costUsd = ccResult.costUsd` before returning. In `runner.ts`, extract `costUsd` from the outcome and include it in the `stage_completed` emit:
  ```typescript
  emit(config, {
    kind: "stage_completed",
    nodeId: currentNode.id,
    outcome,
    durationMs: Date.now() - nodeStart,
    costUsd: outcome.costUsd,
    timestamp: Date.now(),
  });
  ```
  Add a test in `codergen.test.ts` verifying that `outcome.costUsd` is populated from `ccResult.costUsd`.

---

### FINDING-002: `formatEvent` doesn't handle the `error` event kind

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/cli.ts:40-65`
- **Description:** The phase 8 spec defines the `error` event format as `[MM:SS] ✗ message`. The `PipelineEvent` union includes `{ kind: "error"; message: string; nodeId?: string; timestamp: number }`. However, the `formatEvent` switch statement in `cli.ts` has no `case "error"` branch. The `error` event falls through to the `default` case:
  ```typescript
  default:
    if ("kind" in event) {
      return `${ts} [${(event as { kind: string }).kind}]`;
    }
    return `${ts} [event]`;
  ```
  This produces `[MM:SS] [error]` — the error message is silently dropped. If error events were ever emitted, users would see unhelpful output with no indication of what went wrong.
- **Recommendation:** Add a `case "error"` branch before the `default`:
  ```typescript
  case "error":
    return `${ts} ✗ ${event.message}`;
  ```
  Add a test in `cli.test.ts` for this case.

---

### FINDING-003: `error` pipeline events are never emitted

- **Severity:** LOW
- **Category:** Spec Compliance / Observability
- **Status:** OPEN
- **File(s):** `src/engine/runner.ts`, `src/engine/retry.ts`
- **Description:** The `error` variant was added to `PipelineEvent` in a prior review cycle to "surface runtime errors to monitoring callers without crashing the pipeline." However, no code path in the system actually emits this event:
  - `executeWithRetry` catches handler exceptions and converts them to `{ status: "fail" }` outcomes — no `error` event is emitted.
  - The runner's outer `try/catch` in `run()` doesn't emit events (and by that point, `config.onEvent` may not be reachable).
  - The CLI's outer `catch` in `cmdRun` just writes to stderr and exits.

  Users building automated test harnesses or monitoring integrations who subscribe to `onEvent` and want to detect runtime errors programmatically cannot do so. The `error` event type is defined but vestigial.
- **Recommendation:** In `executeWithRetry`, when the maximum attempts are exhausted via exception (the final `catch` path at line 60-62), emit an error event before returning:
  ```typescript
  config.onEvent?.({
    kind: "error",
    nodeId: node.id,
    message: message,
    timestamp: Date.now(),
  });
  return { status: "fail", failureReason: message };
  ```
  Also consider emitting in the runner when `validateOrThrow` fails (before throwing) so that callers using `onEvent` can detect validation failures without parsing exception messages.

---

### FINDING-004: `ParallelHandler` constructor signature diverges from spec

- **Severity:** TRIVIAL
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/handlers/parallel.ts:68-71`
- **Description:** The phase 8 spec defines the `ParallelHandler` constructor as `constructor(private registry: HandlerRegistry, private sessionManager: SessionManager)`. The implementation only accepts `registry`:
  ```typescript
  export class ParallelHandler implements Handler {
    constructor(private registry: HandlerRegistry) {}
  ```
  The `sessionManager` parameter is omitted. Since parallel branches in the current implementation don't make CC calls that require session management, this doesn't affect functionality. The `cli.ts` registrations and all tests use `new ParallelHandler(registry)` and pass without issue. This is purely a spec deviation.
- **Recommendation:** Add `private sessionManager?: SessionManager` as a second constructor parameter to align with the spec and future-proof the implementation for branches that may invoke CodergenHandler.

---

## Statistics

- Total findings: 4
- Critical: 0
- High: 0
- Medium: 1
- Low: 2
- Trivial: 1
