# Implementation Plan

The spec contains 6 feature sections. None declare numbered phases, so the plan below breaks them into 7 right-sized phases ordered by dependency and complexity.

---

## Phase 1: Break on Result in `runCC`

**Goal:** Add `break` after capturing the result message in `cc-backend.ts` to prevent the `for await` loop from blocking on a hung generator.

**Files to modify:**
- `packages/attractor/src/backend/cc-backend.ts` — add `break` after `resultMessage = msg`
- `packages/attractor/test/backend/cc-backend.test.ts` — add test verifying loop exits after result

**Acceptance criteria:**
- `break` added after `resultMessage = msg` in the `for await` loop
- All existing tests continue to pass
- `finally` block still runs (timeout cleanup)

**Dependencies:** None

---

## Phase 2: Comment Test Coverage

**Goal:** Add explicit test cases for comments in various positions. Verify LSP doesn't choke on comments.

**Files to modify:**
- `packages/attractor/test/parser/parser.test.ts` (or new `test/parser/comments.test.ts`) — add tests for:
  - `//` line comments inline after attributes
  - `//` comments between node declarations
  - `/* */` block comments spanning multiple lines
  - Comments inside attribute blocks
  - Comments between edge declarations
- Verify LSP lexer handles comments (read LSP source, confirm it uses same `stripComments`)

**Acceptance criteria:**
- Explicit test cases for comments in various positions (inline, between declarations, block comments)
- LSP confirmed to use the same lexer (no choke)
- All tests pass

**Dependencies:** None

---

## Phase 3: Default Graph-Wide Codergen Timeout (`default_timeout`)

**Goal:** Add `default_timeout` graph attribute that provides a fallback timeout for codergen and tool nodes.

**Files to modify:**
- `packages/attractor/src/model/graph.ts` — add `defaultTimeout: number | null` to `GraphAttributes`
- `packages/attractor/src/parser/parser.ts` — handle `default_timeout` in `applyGraphAttributeKV` via `parseTimeout()`; initialize `defaultTimeout: null` in `defaultGraphAttributes()`
- `packages/attractor/src/handlers/codergen.ts` — use `node.timeout ?? graph.attributes.defaultTimeout ?? 3_600_000`
- `packages/attractor/src/handlers/tool.ts` — use `node.timeout ?? graph.attributes.defaultTimeout ?? 30_000`
- `packages/attractor/src/validation/rules.ts` — add `invalidDefaultTimeoutRule`: non-positive → `[error]`
- `packages/attractor/test/parser/parser.test.ts` — test parsing `default_timeout`
- `packages/attractor/test/handlers/codergen.test.ts` — test fallback chain
- `packages/attractor/test/handlers/tool.test.ts` — test fallback chain
- `packages/attractor/test/validation/rules.test.ts` — test validation rule

**Acceptance criteria:**
- `default_timeout` graph attribute parsed and stored
- Codergen nodes without explicit timeout use graph default, falling back to 1h
- Tool nodes without explicit timeout use graph default, falling back to 30s
- Node-level `timeout` overrides graph default
- Validation rejects non-positive values
- All tests pass

**Dependencies:** None

---

## Phase 4: Prompt Files for DAG Nodes (`prompt_file`)

**Goal:** Add `prompt_file` attribute that reads prompt content from a file at execution time, with path relative to `.attractor/`.

**Files to modify:**
- `packages/attractor/src/model/graph.ts` — add `promptFile: string` to `GraphNode`
- `packages/attractor/src/parser/parser.ts` — handle `prompt_file` in `applyNodeAttr`, initialize in `defaultGraphNode`
- `packages/attractor/src/handlers/codergen.ts` — if `node.promptFile` is set and `node.prompt` is empty, resolve path relative to `.attractor/`, read file, apply `$goal` substitution, use as prompt; handle missing file → fail outcome
- `packages/attractor/src/engine/transforms.ts` — apply `$goal` substitution to promptFile contents (or handle in codergen handler after file read)
- `packages/attractor/src/validation/rules.ts` — add rules:
  - `prompt_file` on non-codergen node → `[warning]`
  - Both `prompt` and `prompt_file` set → `[warning]`
  - File not found at path relative to `.attractor/` → `[warning]`
- `packages/attractor/test/parser/parser.test.ts` — test parsing `prompt_file`
- `packages/attractor/test/handlers/codergen.test.ts` — test file reading, precedence, missing file, `$goal` expansion
- `packages/attractor/test/validation/rules.test.ts` — test all three validation rules

**Acceptance criteria:**
- `prompt_file` attribute parsed and stored on `GraphNode`
- CodergenHandler reads file and uses contents as prompt
- `prompt` takes precedence when both are set
- Variable expansion (`$goal`) applies to file contents
- Missing file at runtime → fail outcome, not crash
- Validation warns on: missing files, conflicts (both prompt and prompt_file), misuse (non-codergen nodes)
- All tests pass

**Dependencies:** None

---

## Phase 5: Resume Last Pipeline (`--resume-last`)

**Goal:** Add `--resume-last` flag to the CLI that automatically finds and resumes from the most recent run's checkpoint.

**Files to modify:**
- `packages/attractor/src/cli.ts` — add `--resume-last` flag to `cmdRun`; implement logic to:
  1. Scan `.attractor/runs/` for directories sorted descending
  2. Find first containing `checkpoint.json`
  3. Check if pipeline completed successfully → print message, exit 0
  4. Otherwise pass checkpoint path to `run()` as `resumeFromCheckpoint`
  5. Error if both `--resume` and `--resume-last` provided
  6. Error if no prior runs found
- `packages/attractor/test/cli/cli.test.ts` (or extend existing CLI tests) — test:
  - `--resume-last` finds most recent checkpoint
  - Error when no prior runs exist
  - Mutual exclusion with `--resume`
  - Completed pipeline → "nothing to resume" message

**Acceptance criteria:**
- `--resume-last` flag added to CLI
- Correctly identifies most recent run directory
- Resumes from checkpoint node, skipping already-completed nodes
- New logs directory created for resumed run
- Errors clearly when no prior runs exist
- `--resume` and `--resume-last` are mutually exclusive
- All tests pass

**Dependencies:** None (uses existing checkpoint/resume infrastructure)

---

## Phase 6: Watchdog — Parsing, Validation, and State Model

**Goal:** Add `watchdog_idle` and `watchdog_poll` graph attributes with parsing, validation, and the `WatchdogState` type.

**Files to modify:**
- `packages/attractor/src/model/graph.ts` — add `watchdogIdle: number | null` and `watchdogPoll: number | null` to `GraphAttributes`
- `packages/attractor/src/parser/parser.ts` — handle `watchdog_idle` and `watchdog_poll` in `applyGraphAttributeKV` via `parseTimeout()`
- `packages/attractor/src/engine/watchdog.ts` (new) — export `WatchdogState` interface and helper functions:
  - `createWatchdog(idleMs, pollMs, emit)` — creates state + starts interval
  - `trackActivity(watchdog, nodeId)` — updates last-activity timestamp
  - `registerNode(watchdog, nodeId, abortController)` — registers node for tracking
  - `unregisterNode(watchdog, nodeId)` — cleans up after node completes
  - `stopWatchdog(watchdog)` — clears interval
- `packages/attractor/src/validation/rules.ts` — add rules:
  - `watchdog_poll` without `watchdog_idle` → `[warning]`
  - `watchdog_idle` < `watchdog_poll` → `[warning]`
  - Non-positive `watchdog_idle` → `[error]`
- `packages/attractor/test/parser/parser.test.ts` — test parsing watchdog attributes
- `packages/attractor/test/engine/watchdog.test.ts` (new) — unit tests for watchdog state management
- `packages/attractor/test/validation/rules.test.ts` — test validation rules

**Acceptance criteria:**
- `watchdog_idle` and `watchdog_poll` graph attributes parsed and stored
- WatchdogState interface and helpers implemented with unit tests
- Validation rules for misconfiguration
- All tests pass

**Dependencies:** None

---

## Phase 7: Watchdog — Runtime Integration

**Goal:** Wire the watchdog into the runner's traversal loop, CodergenHandler, and ParallelHandler.

**Files to modify:**
- `packages/attractor/src/engine/runner.ts` — add `RunConfig.abortSignal?: AbortSignal`; integrate watchdog lifecycle:
  - Start after `pipeline_started` if `watchdog_idle` set
  - Create per-node AbortController, register with watchdog
  - Update `wrappedOnEvent` to call `trackActivity` on `cc_event` / `stage_started`
  - Clean up node from watchdog after execution
  - Stop watchdog at `pipeline_completed`
- `packages/attractor/src/handlers/codergen.ts` — combine watchdog abort signal with timeout abort signal via event listener
- `packages/attractor/src/handlers/parallel.ts` — thread `abortSignal` through to branch execution; create per-branch AbortControllers registered with watchdog
- `packages/attractor/test/engine/runner.test.ts` — integration tests for watchdog kill behavior
- `packages/attractor/test/handlers/codergen.test.ts` — test abort signal integration

**Acceptance criteria:**
- Watchdog only activates when `watchdog_idle` is set
- Active nodes tracked via event stream heartbeats
- Idle nodes killed via AbortController after configured duration
- Warning event emitted on watchdog kill
- Parallel branches tracked independently
- Timer cleaned up at pipeline end
- All tests pass

**Dependencies:** Phase 6 (watchdog state model)
