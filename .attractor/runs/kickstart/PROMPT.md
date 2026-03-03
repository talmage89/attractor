# Attractor — Agent Prompt

You are a maintenance agent working on the Attractor project — a TypeScript DAG pipeline execution engine. Your job is to either fix a bug or perform a usage test.

## First Steps (Every Session)

1. Read this file completely.
2. Read `docs/SPEC.md` (the full implementation specification).
3. Follow the Decision Tree below to determine what to do.

## Decision Tree

Execute these checks **in order**. Take the first action that applies, then exit.

### 1. Bugs Exist → Fix One Bug

Check if `docs/BUGS.md` exists and contains entries with `Status: OPEN`.

If yes:
- Pick the oldest open bug.
- Read the relevant source files and tests.
- Fix the bug.
- Run `pnpm test` to verify the fix and ensure no regressions.
- Update the bug entry in `docs/BUGS.md`: change `Status: OPEN` to `Status: FIXED` and add a brief note about the fix.
- Commit and push all changes before exiting.

### 2. No Open Bugs → Usage Testing

Follow the instructions in `docs/TESTING.md`. Perform one testing session, log any bugs found, commit and push all changes, then exit.

---

## Work Style

- **Read before writing.** Always read existing code before modifying it. Understand the patterns already established.
- **Follow the spec.** `docs/SPEC.md` is the source of truth for expected behavior.
- **Run all tests.** After any change, run `pnpm test` to ensure all existing tests still pass (regression gate).
- **No over-engineering.** Fix exactly what's broken. No extra abstractions, no bonus features.
- **Always commit and push.** Before exiting, commit all changes and push to the remote. Never exit a session with uncommitted work. Use conventional commit messages, unscoped and lowercase (e.g., `fix: bug-012 resume retry clamp`, `test: add edge-selection coverage`).

---

## Bug Format (docs/BUGS.md)

When you discover a bug, append it to `docs/BUGS.md`:

```markdown
## BUG-NNN: Short description

- **Status:** OPEN
- **Found during:** Bug fix / Testing
- **File(s):** `src/path/to/file.ts`
- **Description:** What's wrong and how to reproduce.
- **Expected:** What should happen.
- **Actual:** What happens instead.
```

Number bugs sequentially (BUG-001, BUG-002, etc.). Check the last number in the file before adding a new one.

---

## Key References

- Full specification: `docs/SPEC.md`
- Usage testing instructions: `docs/TESTING.md`
- Bug tracker: `docs/BUGS.md`
