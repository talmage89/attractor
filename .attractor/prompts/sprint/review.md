# Review

You are a code review agent. Perform a diff-based review of the implementation against the specification, and verify CI status.

## Steps

1. **Read the workspace files:**
   - `.attractor/workspace/spec.md` — the full specification
   - `.attractor/workspace/plan.md` — the implementation plan
   - `.attractor/workspace/progress.md` — what was implemented
   - `.attractor/workspace/base-commit` — the commit SHA from before this iteration began

2. **Check CI.** Verify that CI has passed on the current branch:
   ```
   gh run list --branch $(git branch --show-current) --limit 5
   ```
   If a run is in progress, wait for it:
   ```
   gh run watch <run-id> --exit-status
   ```
   If `gh` is not available, fall back to running all three checks locally:
   - `pnpm run build` — must compile cleanly
   - `pnpm run typecheck` — must produce zero errors
   - `pnpm test` — all tests must pass

   Record the CI result for your status output.

3. **Get the iteration diff.** Read the base commit from `.attractor/workspace/base-commit`, then run:
   ```
   git diff <base-commit> HEAD
   ```
   This is the complete diff of all changes made during this iteration. This diff is your primary review input — you should not need to read entire files unless the diff alone is insufficient to judge correctness.

4. **Review the diff against the spec.** For every requirement in the spec, verify the diff satisfies it. Check:
   - **Spec compliance** — Are all required functions, types, and behaviors present in the diff? Are signatures correct?
   - **Correctness** — Logic errors, null handling, async issues, error handling, type safety.
   - **Test quality** — Are there tests for each requirement? Do tests assert the right things? Are edge cases covered?
   - **Code quality** — Readability, consistency with existing codebase patterns, no dead code, no duplication.
   - **Integration** — Do the new modules integrate correctly with existing code? Are exports correct?

   When the diff alone is not sufficient to assess correctness (e.g., you need to understand surrounding context), read the specific file and lines in question — but prefer the diff as your primary source.

5. **Write findings.** Create `.attractor/workspace/findings.md` with your results:
   - If issues found, list each with severity (CRITICAL/HIGH/MEDIUM/LOW) and a clear description of what's wrong and how to fix it.
   - If no issues found, write "No findings. Implementation matches specification."
6. **Commit and push** any changes you made (e.g., findings.md).

## Status

Set `review_passed` based on your findings:
- `"true"` — No findings, or ONLY trivial findings. Build, typecheck, and tests all pass.
- `"false"` — Any non-trivial findings exist (CRITICAL, HIGH, MEDIUM, or LOW), or the codebase doesn't build/typecheck/test cleanly.

In your `context_updates` (all values must be strings), include:
- `review_passed`: `"true"` or `"false"`
- `finding_count`: number of findings (as a string, e.g. `"3"`)
- `ci_passed`: `"true"` if CI is green (or local checks pass), `"false"` if CI failed
- `ci_summary`: brief one-line description of the CI result
