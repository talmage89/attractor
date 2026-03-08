# Review Findings

## CI Status
- Build: PASS
- Typecheck: PASS (zero errors)
- Tests: PASS (583 tests, 29 test files)

## Diff Review (base: b13c243)

### Section 1: Comments in DAG Files
- 8 explicit tests covering line/block comments in all positions (inline, between declarations, inside attribute blocks, spanning lines)
- LSP verified to use same `lex()` function — no changes needed
- README created with comment syntax documentation and examples
- **Verdict: PASS**

### Section 2: Resume Last Pipeline (`--resume-last`)
- `--resume-last` boolean flag added to CLI arg parser
- `findLastCheckpoint()` scans `.attractor/runs/` sorted descending, finds first with `checkpoint.json`
- Mutual exclusion with `--resume` checked (exit 3)
- Exit node detection checks shape/type/id correctly
- No prior runs → clear error message
- 4 tests covering mutual exclusion, no prior runs, exit node detection, lexicographic ordering
- **Verdict: PASS**

### Section 3: Prompt Files (`prompt_file`)
- `promptFile: string` added to `GraphNode`, parsed in `applyNodeAttr`
- CodergenHandler reads file relative to `config.cwd/.attractor/`, applies `$goal` substitution via `replaceAll`
- `prompt` takes precedence (`if (!prompt && node.promptFile)`)
- Missing file returns `{ status: "fail" }` with clear error, no crash
- 3 validation rules: non-codergen warning, conflict warning, not-found warning
- LSP semantic tokens: STRING values already classified as `string` type (no change needed)
- 16 tests (3 parser, 4 codergen, 9 validation)
- **Verdict: PASS**

### Section 4: Default Timeout (`default_timeout`)
- `defaultTimeout: number | null` added to `GraphAttributes`, parsed via `parseTimeout()`
- CodergenHandler: `node.timeout ?? graph.attributes.defaultTimeout ?? 3_600_000` (1h fallback)
- ToolHandler: `node.timeout ?? graph.attributes?.defaultTimeout ?? 30_000` (30s fallback)
- `invalidDefaultTimeoutRule`: non-positive → `[error]`
- 13 tests (4 parser, 4 validator, 3 codergen, 2 tool handler)
- **Verdict: PASS**

### Section 5: Watchdog
- `watchdogIdle` and `watchdogPoll` added to `GraphAttributes`, parsed via `parseTimeout()`
- `WatchdogState` interface with `createWatchdog`, `trackActivity`, `registerNode`, `unregisterNode`, `stopWatchdog`
- Polling interval checks idle duration, aborts via `AbortController`, emits warning
- `interval.unref()` prevents keeping Node.js alive past pipeline completion
- Runner: watchdog started after `pipeline_started`, stopped before `pipeline_completed` and before `loop_restart`
- Per-node AbortController created, registered, and unregistered around `executeWithRetry`
- `wrappedOnEvent` calls `trackActivity` on `cc_event` and `stage_started`
- CodergenHandler forwards `config.abortSignal` to `runCC`
- cc-backend.ts combines external abort signal with internal timeout controller
- ParallelHandler: per-branch AbortControllers registered/unregistered independently (both static and dynamic paths)
- 3 validation rules: poll-without-idle warning, idle-shorter-than-poll warning, non-positive-idle error
- 30 tests (3 parser, 11 watchdog unit, 10 validation, 4 runner integration, 2 codergen)
- **Verdict: PASS**

### Section 6: Break on Result
- `break` added after `resultMessage = msg` in the `for await` loop
- `finally` block still runs (clears timeout)
- 1 test verifying post-result messages are not forwarded
- **Verdict: PASS**

## Code Quality
- Consistent with existing codebase patterns
- No dead code or duplication
- Test helpers properly updated with new fields (`promptFile`, `defaultTimeout`, `watchdogIdle`, `watchdogPoll`)
- Error handling follows established conventions
- Type safety maintained (typecheck clean)

## Conclusion

No findings. Implementation matches specification.
