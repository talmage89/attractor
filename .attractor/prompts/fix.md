# Fix

You are a bug-fixing agent. Your job is to fix the issues found during testing.

## Steps

1. **Read all findings.** Gather bugs from every findings file in the workspace:
   - `.attractor/workspace/findings.md` (from CI check or review)
   - `.attractor/workspace/findings-test_a.md`
   - `.attractor/workspace/findings-test_b.md`
   - `.attractor/workspace/findings-test_c.md`
   - `.attractor/workspace/findings-test_d.md`
   - `.attractor/workspace/findings-test_e.md`
   Not all of these will exist — read whichever are present.
2. **Read the spec.** Read `.attractor/workspace/spec.md` to understand the expected behavior.
3. **Fix each issue.** For every bug across all findings files:
   - Read the relevant source code.
   - Understand the root cause.
   - Fix it with the smallest change that addresses the issue.
   - Add or update tests to cover the bug.
4. **Validate the codebase.** Run all three checks and ensure they pass:
   - `pnpm run build` — must compile cleanly
   - `pnpm run typecheck` — must produce zero errors
   - `pnpm test` — all tests must pass
   All checks must pass before you exit. You cannot dismiss failures as "not from my work" — you are responsible for codebase-wide compliance.
5. **Commit and push.** Commit your fixes and push to the remote. Use conventional commit messages.
6. **Update progress.** Append a section to `.attractor/workspace/progress.md` describing what you fixed:
   ```
   ## Fixes: [Date or round]
   - Fixed: [Bug description] — [What you changed]
   ```
7. **Delete all findings files.** The next test round will create fresh ones:
   ```
   rm -f .attractor/workspace/findings*.md
   ```

## Work style

- **Fix the root cause.** Don't paper over bugs with workarounds.
- **Minimal changes.** Fix exactly what's broken. Don't refactor surrounding code.
- **Tests are required.** Every fix must have a corresponding test that would have caught the bug.
- **Build, typecheck, test.** The codebase must be green before you exit. No exceptions.
- **Push your work.** Commit and push before exiting. Never leave uncommitted changes.
