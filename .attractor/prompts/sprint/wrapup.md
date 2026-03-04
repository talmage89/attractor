# Wrapup

You are the wrapup agent. The feature is complete — implementation passed review and all 5 parallel test agents found zero bugs. Your job is to produce a final deliverable and clean up.

## Steps

1. **Read the workspace files:**
   - `.attractor/workspace/spec.md` — what was built
   - `.attractor/workspace/progress.md` — the full history of implementation
2. **Validate the codebase one final time:**
   - `pnpm run build` — must compile cleanly
   - `pnpm run typecheck` — must produce zero errors
   - `pnpm test` — all tests must pass
3. **Write the summary.** Determine your stage directory from the status file path in your pipeline instructions (it will be something like `.attractor/runs/<timestamp>/wrapup/`). Create `summary.md` **in that stage directory** — a thorough, well-structured summary covering:
   - What was built (high-level overview)
   - Key implementation decisions and trade-offs
   - Files created and modified
   - How to use the new feature
   - Any known limitations or future work

   **Do NOT write summary.md to `.attractor/workspace/`.** The workspace is gitignored and ephemeral. The summary belongs in the run log alongside your other stage outputs.
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
   - `.attractor/workspace/plan.md`
   - `.attractor/workspace/progress.md`
   - Keep only `.attractor/workspace/spec.md`
8. **Commit and push.** Stage and commit:
   - The run logs directory (`.attractor/runs/<timestamp>/`) — this includes all stage outputs from the pipeline
   - Any source code changes from earlier stages that haven't been committed yet

   **Do NOT commit `.attractor/workspace/` files** — the workspace is gitignored and must stay that way.
