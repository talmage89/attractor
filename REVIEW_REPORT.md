# Code Review Report

**Date:** 2026-03-01
**Reviewer:** AI Agent (third-pass)
**Test Status:** All passing (246/246)

## Summary

This is a fresh third-pass review. The codebase is well-structured and functionally correct for basic linear/conditional pipelines. Three significant gaps were found: (1) the CLI only registers CodergenHandler, leaving ToolHandler and ParallelHandler unregistered so tool commands and parallel branches silently never execute in production; (2) the `PipelineEvent` union type is missing the `cc_event` and `error` variants specified in the spec; and (3) several observability events (`stage_retrying`, `human_question`, `human_answer`, CC forwarding) are defined but never emitted.

---

## Findings

### FINDING-001: CLI only registers CodergenHandler; ToolHandler and ParallelHandler are never registered

- **Severity:** HIGH
- **Category:** Spec Compliance / Correctness
- **Status:** RESOLVED
- **File(s):** `src/cli.ts:134-137`
- **Description:** The CLI creates a `HandlerRegistry` and only calls `registry.register("codergen", new CodergenHandler(sessionManager))`. The `ToolHandler`, `ParallelHandler`, and `FanInHandler` classes exist and are correct but are never instantiated or registered anywhere in the CLI. When the execution engine resolves a handler for a `tool` node (shape `parallelogram`) or `parallel` node (shape `component`), it falls through to the default mock handler which returns `{ status: "success" }` without executing anything. Effect: (a) Tool pipelines silently skip all shell command execution and report success; (b) Parallel pipelines never fan out — they return success without executing any branches. A user who builds a pipeline with `tool` or `parallel` nodes and runs `attractor run` will get incorrect results with no warning. The `FanInHandler` is also unregistered; since parallel never ran, fan-in also gets no meaningful results.
- **Recommendation:** In `cmdRun` in `cli.ts`, after creating the registry, also register the missing handlers:
  ```typescript
  import { ToolHandler } from "./handlers/tool.js";
  import { ParallelHandler } from "./handlers/parallel.js";
  import { FanInHandler } from "./handlers/fan-in.js";
  import { ConditionalHandler } from "./handlers/conditional.js";
  // ...
  registry.register("tool", new ToolHandler());
  registry.register("parallel", new ParallelHandler(registry));
  registry.register("parallel.fan_in", new FanInHandler());
  registry.register("conditional", new ConditionalHandler());
  ```
  Note: `ConditionalHandler` behaves identically to the mock (returns success), so it is lower priority, but registering it keeps the intent explicit and future-proofs the code.

---

### FINDING-002: PipelineEvent union type missing cc_event and error variants

- **Severity:** MEDIUM
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/model/events.ts:17-30`
- **Description:** The spec (Section 16.1) defines the full `PipelineEvent` union including:
  ```typescript
  | { kind: "cc_event"; nodeId: string; event: SDKMessage; timestamp: number }
  | { kind: "error"; message: string; nodeId?: string; timestamp: number }
  ```
  Neither variant is present in the current `events.ts`. This means: (a) TypeScript consumers of the `PipelineEvent` type cannot write exhaustive switch handlers for all event types; (b) any code that tries to emit these events will fail type-checking; (c) the spec's observability contract for CC SDK message forwarding cannot be met without first extending the type. The `error` event type in particular is useful for surfacing runtime errors to monitoring callers without crashing the pipeline.
- **Recommendation:** Add both variants to the `PipelineEvent` union. The `error` variant has no external dependencies and can be added immediately. The `cc_event` variant requires importing `SDKMessage` from `@anthropic-ai/claude-agent-sdk`; since `cc-backend.ts` already imports this, the import can be copied to `events.ts` (or the type re-exported from there).

---

### FINDING-003: stage_retrying event is defined but never emitted

- **Severity:** LOW
- **Category:** Spec Compliance / Test Quality
- **Status:** RESOLVED
- **File(s):** `src/engine/retry.ts:49-88`, `src/model/events.ts:23`
- **Description:** The spec (Section 16.1) defines `stage_retrying` with fields `nodeId`, `attempt`, `delayMs`, `timestamp`. The event type is present in `events.ts`. However, `executeWithRetry` in `retry.ts` never calls `config.onEvent` to emit this event during retry loops. Monitoring code that subscribes to pipeline events to track retry behavior will never see these events. Tests do not cover the emission of this event. The issue is structural: `executeWithRetry` receives `config: RunConfig` which has `onEvent`, so it has access to emit the event.
- **Recommendation:** In the retry loop within `executeWithRetry`, after computing `delay` and before sleeping, emit:
  ```typescript
  config.onEvent?.({
    kind: "stage_retrying",
    nodeId: node.id,
    attempt,
    delayMs: delay,
    timestamp: Date.now(),
  });
  ```
  Add a test that verifies `stage_retrying` events are emitted with correct `attempt` and `delayMs` fields.

---

### FINDING-004: human_question and human_answer events never emitted by WaitForHumanHandler

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/handlers/wait-human.ts:29-102`
- **Description:** The spec (Section 16.1) defines `human_question` and `human_answer` pipeline events. The `WaitForHumanHandler.execute()` receives `config: RunConfig` (aliased as `_config`) but never calls `config.onEvent`. As a result: (a) monitoring callers cannot observe when the pipeline pauses for human input; (b) the CLI's `formatEvent` handler at `src/cli.ts:49` handles `human_question` but would never receive it; (c) users building automated test harnesses around pipeline events cannot detect human gate prompts. The `Question` and `Answer` types needed for these events are already defined and imported in the file.
- **Recommendation:** Rename `_config` to `config` in the parameter list and add event emission:
  ```typescript
  config.onEvent?.({ kind: "human_question", question, timestamp: Date.now() });
  const answer = await this.interviewer.ask(question);
  config.onEvent?.({ kind: "human_answer", answer, timestamp: Date.now() });
  ```

---

### FINDING-005: CodergenHandler doesn't forward CC SDK messages as cc_event pipeline events

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/handlers/codergen.ts:183`
- **Description:** The spec (Section 9.5) says the codergen handler should call `runCC(prompt, ccOptions, (event) => { config.onEvent?.({kind: "cc_event", nodeId: node.id, event, timestamp: Date.now()}) })`. The implementation calls `runCC(finalPrompt, ccOptions)` without the third `onEvent` callback argument. CC SDK messages (assistant messages, tool uses, progress) are silently dropped. Users who subscribe to pipeline events to observe CC execution in real time (e.g., for streaming output to a UI) receive nothing. This is coupled with FINDING-002: even after adding the callback, the `cc_event` type would need to be in the `PipelineEvent` union before it can be safely emitted.
- **Recommendation:** Pass the event callback as the third argument to `runCC`:
  ```typescript
  const ccResult = await runCC(finalPrompt, ccOptions, (sdkEvent) => {
    config.onEvent?.({ kind: "cc_event", nodeId: node.id, event: sdkEvent, timestamp: Date.now() });
  });
  ```
  This is blocked by FINDING-002; fix that first.

---

### FINDING-006: index.ts missing exports for handler classes and registry

- **Severity:** LOW
- **Category:** Integration / Public API
- **Status:** OPEN
- **File(s):** `src/index.ts`
- **Description:** The public API exported from `src/index.ts` includes `run`, `validate`, `parse`, and the interviewer classes, but omits: `HandlerRegistry`, `CodergenHandler`, `ToolHandler`, `WaitForHumanHandler`, `ParallelHandler`, `FanInHandler`, `ConditionalHandler`, `SessionManager`, and `applyTransforms`. An external consumer who imports `attractor` as a library and wants to build a custom pipeline using these classes must reach into internal module paths (e.g., `attractor/src/handlers/registry.js`) which breaks encapsulation and will fail when the package is compiled to `dist/`. The CLI workaround (importing directly) works only in the monorepo context.
- **Recommendation:** Add to `src/index.ts`:
  ```typescript
  export { HandlerRegistry } from "./handlers/registry.js";
  export { CodergenHandler } from "./handlers/codergen.js";
  export { ToolHandler } from "./handlers/tool.js";
  export { ParallelHandler, executeBranch } from "./handlers/parallel.js";
  export { FanInHandler } from "./handlers/fan-in.js";
  export { WaitForHumanHandler } from "./handlers/wait-human.js";
  export { ConditionalHandler } from "./handlers/conditional.js";
  export { SessionManager } from "./backend/session-manager.js";
  export { applyTransforms } from "./engine/transforms.js";
  export type { Handler } from "./handlers/registry.js";
  ```

---

### FINDING-007: Fidelity degradation for first node after resume not implemented

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** OPEN
- **File(s):** `src/engine/runner.ts:112-130`
- **Description:** The spec (Section 10.3, step 6) states: "For the first node after resume, if it was using `full` fidelity, degrade to `summary:high` because in-memory CC sessions cannot be serialized." The resume logic in `runner.ts` correctly restores the session map and sets `currentNode` but does not implement fidelity degradation. In practice this may not matter (the CC SDK persists sessions to disk and `resume: sessionId` reconstructs the session), but it is a documented spec deviation. This was previously noted as deferred in review cycle 2 FINDING-001 but remains unimplemented.
- **Recommendation:** After restoring the session manager in the resume block, track a `firstNodeAfterResume` flag:
  ```typescript
  let firstNodeAfterResume = true;
  ```
  Then in CodergenHandler (or by passing the flag via RunConfig), when `firstNodeAfterResume && fidelity === "full"`, override fidelity to `"summary:high"` for that one node call and clear the flag. Alternatively, degrade in the resume block by calling `sessionManager.clear()` and relying on preamble generation.

---

## Statistics

- Total findings: 7
- Critical: 0
- High: 1 (RESOLVED)
- Medium: 1 (RESOLVED)
- Low: 5 (4 OPEN, 1 RESOLVED)
- Trivial: 0
