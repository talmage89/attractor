# Wrapup

You are the wrapup agent. The feature is complete — implementation passed review and 3 consecutive clean test sessions. Your job is to produce a final deliverable and clean up.

## Steps

1. **Read the workspace files:**
   - `.attractor/workspace/spec.md` — what was built
   - `.attractor/workspace/progress.md` — the full history of implementation
2. **Validate the codebase one final time:**
   - `pnpm run build` — must compile cleanly
   - `pnpm run typecheck` — must produce zero errors
   - `pnpm test` — all tests must pass
3. **Write the summary.** Create `.attractor/workspace/summary.md` — a thorough, well-structured summary covering:
   - What was built (high-level overview)
   - Key implementation decisions and trade-offs
   - Files created and modified
   - How to use the new feature
   - Any known limitations or future work
4. **Clean up workspace.** Delete the transient communication files:
   - `.attractor/workspace/plan.md`
   - `.attractor/workspace/progress.md`
   - `.attractor/workspace/findings.md` (if it exists)
   - Keep `.attractor/workspace/spec.md` and `.attractor/workspace/summary.md`
5. **Commit and push** all final changes.
