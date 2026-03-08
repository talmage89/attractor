## fix — 2026-03-08T17:26:26.320Z

All 4 bugs fixed, 588 tests passing, committed and pushed. Here's a summary:

**BUG-001 (test_a): Watchdog doesn't kill tool nodes**
- `runShellCommand()` now accepts an optional `abortSignal` parameter
- Adds an `abort` listener that kills the process group via SIGTERM (then SIGKILL after 2s)
- Handles pre-aborted signals by checking `signal.aborted` immediately after spawn
- `ToolHandler.execute()` passes `config.abortSignal` to `runShellCommand`

**Bug 1 (test_b): `--resume-last` ignores `--cwd`**
- `findLastCheckpoint()` now accepts a `cwd` parameter
- `workingCwd` is computed before the `--resume-last` logic, so the correct project directory is searched

**Bug 2 (test_b): `prompt_file_not_found` uses `process.cwd()`**
- `LintRule` type extended: `(graph: Graph, cwd?: string) => Diagnostic[]`
- `validate()` and `validateOrThrow()` accept optional `cwd` and thread it to all rules
- `promptFileNotFoundRule` uses `cwd ?? process.cwd()` for path resolution
- `cmdRun` passes `workingCwd`; `cmdValidate` passes `path.dirname(path.resolve(dotfile))`

**BUG-1 (test_c): `prompt_on_llm_nodes` false positive when `prompt_file` set**
- Added `!node.promptFile` to the condition — a node with `prompt_file` is properly configured

---

## fix — 2026-03-08T17:45:08.282Z

Done. Here's a summary of what was fixed:

**Bug fixed:** Default `logsRoot` did not respect `--cwd`

- **Root cause:** `cli.ts` line 198 used `path.join(".attractor", "runs", timestamp)` — a relative path that resolves against `process.cwd()`, not the `--cwd` project directory.
- **Fix:** Changed to `path.join(workingCwd, ".attractor", "runs", timestamp)` so runs always write checkpoints under the project directory specified by `--cwd`.
- **Test added:** New test in `cli.test.ts` verifies that when `--cwd projectDir` is given (without `--logs`), the checkpoint is written to `projectDir/.attractor/runs/` and not to the caller's directory.
- **Result:** 589 tests passing, build/typecheck clean, committed and pushed.

---

## fix — 2026-03-08T18:04:06.308Z

Fixed 2 bugs in `stripComments()` in `lexer.ts`:

1. **BUG-1 (crash)**: `//` inside a quoted string was treated as a line comment, stripping the closing `"` and causing "Unterminated string" parse errors. This affected any prompt/label containing URLs (`https://...`) or code comments.

2. **BUG-2 (data loss)**: `/* */` inside a quoted string was treated as a block comment, silently erasing the content between the markers.

**Root cause**: `stripComments()` processed characters without tracking whether it was inside a quoted string literal.

**Fix**: Added a quoted-string case at the start of the loop that passes string content through verbatim (handling `\"` and `\\` escape sequences) before checking for comment markers.

**Tests added**: 4 new lexer tests — `//` in string, URL with `//`, `/* */` in string, mixed comment+string on same line. 593 total tests passing.

---

## fix — 2026-03-08T18:16:36.937Z

Done. Here's a summary of what was fixed:

**Bug fixed:** `--resume-last` incorrectly reported "Last pipeline completed successfully, nothing to resume" after a pipeline that **failed** due to a goal gate violation.

**Root cause:** `cli.ts` only checked if `currentNode` was an exit node. But a failed pipeline (goal gate unsatisfied) also saves its final checkpoint with `currentNode` at the exit node.

**Fix:** After checking `isExitNode`, also verify that all `goal_gate=true` nodes in the graph have `status: "success"` in `checkpoint.nodeOutcomes`. Only then print the "completed successfully" message.

**Test added:** A regression test with a DAG containing a `goal_gate=true` node whose checkpoint shows `status: "fail"` — asserts the "nothing to resume" message is NOT printed.

---

## fix — 2026-03-08T18:29:44.744Z

Done. Here's a summary of what was fixed:

**BUG-B-001**: `attractor validate` emitted a false-positive `prompt_file_not_found` warning when the dotfile was inside `.attractor/` (e.g. `.attractor/pipeline.dag`).

**Root cause**: `cmdValidate` passed the dotfile's parent directory as `validateCwd`. When that directory is `.attractor/`, the `promptFileNotFoundRule` appended `.attractor` again, producing a double-prefix path (`.attractor/.attractor/prompts/test.md`).

**Fix** (`cli.ts:299`): After computing `validateCwd = path.dirname(path.resolve(dotfile))`, strip the `.attractor` component if present — stepping up to the project root. This matches `cmdRun`'s behavior of passing `workingCwd`.

**Test added**: Regression test in `cmdValidate` suite that creates a conventional `.attractor/pipeline.dag` + `.attractor/prompts/step.md` layout and verifies no `prompt_file_not_found` warning is emitted.

595 tests passing, build and typecheck clean, committed and pushed.

---

## fix — 2026-03-08T18:42:15.751Z

Done. Here's a summary of what was fixed:

**Bug fixed: BUG-A-001 / BUG-B-002** — Both test agents independently found the same issue: the `validateCwd` stripping in `cmdValidate` only handled the case where the dotfile was a *direct child* of `.attractor/` (e.g., `.attractor/pipeline.dag`). DAGs nested deeper (e.g., `.attractor/pipelines/deep/pipeline.dag`) would get `basename="deep"` which didn't match, so no stripping occurred, causing a false-positive `prompt_file_not_found` warning.

**Fix:** Replaced the `path.basename` check with `lastIndexOf(".attractor")` on the split path parts, which handles any nesting depth.

**Test added:** New test in `cli.test.ts` covering the nested `.attractor/pipelines/deep/pipeline.dag` layout.

**Result:** 596 tests passing (was 595), build and typecheck clean.