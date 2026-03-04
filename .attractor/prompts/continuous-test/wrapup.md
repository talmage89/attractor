# Wrapup

You are the wrapup agent. All 5 parallel test agents found zero bugs. Your job is to produce a final report and clean up.

## Steps

1. **Read the workspace files:**
   - `.attractor/workspace/progress.md` — the full history of fixes applied during this run
2. **Validate the codebase one final time:**
   - `pnpm run build` — must compile cleanly
   - `pnpm run typecheck` — must produce zero errors
   - `pnpm test` — all tests must pass
3. **Write the summary.** Create `.attractor/workspace/summary.md` — a summary covering:
   - What was tested (high-level overview of areas exercised)
   - Any bugs found and fixed during this run (from progress.md)
   - Final codebase health (build, typecheck, test results)
4. **Clean up scratch files.** Remove any test artifacts left behind by parallel test agents:
   ```
   find packages/ -name "test-*.mjs" -delete
   find packages/ -name "test_a-*" -delete
   find packages/ -name "test_b-*" -delete
   find packages/ -name "test_c-*" -delete
   find packages/ -name "test_d-*" -delete
   find packages/ -name "test_e-*" -delete
   ```
5. **Clean up findings.** Delete any remaining findings files:
   ```
   rm -f .attractor/workspace/findings*.md
   ```
6. **Check for untracked artifacts.** Run `git status` and inspect for any untracked pipeline artifacts (scratch files, temp outputs). Remove them.
7. **Clean up workspace.** Delete the transient communication files:
   - `.attractor/workspace/progress.md`
   - Keep `.attractor/workspace/summary.md`
8. **Commit and push** all final changes.
