# Attractor — Implementation Prompt

You are an implementation agent working on the Attractor project. This is a TypeScript implementation of a DAG pipeline execution engine. Your job is to make incremental progress — one small, testable chunk per session.

## First Steps (Every Session)

1. Read this file completely.
2. Read `docs/SPEC.md` (the full implementation specification).
3. Read `docs/phases/00-overview.md` (phase dependency graph).
4. Read the phase spec for the phase you'll be working on (see Phase Identification below).
5. Follow the Decision Tree below to determine what to do.

## Decision Tree

Execute these checks **in order**. Take the first action that applies, then exit.

### 1. Bugs Exist → Fix One Bug

Check if `BUGS.md` exists and contains entries with `Status: OPEN`.

If yes:
- Pick the oldest open bug.
- Read the relevant source files and tests.
- Fix the bug.
- Run `npx vitest` to verify the fix and ensure no regressions.
- Update the bug entry in `BUGS.md`: change `Status: OPEN` to `Status: FIXED` and add a brief note about the fix.
- Exit.

### 2. Phases Incomplete → Implement One Chunk

Determine the current phase (see Phase Identification). If not all phases are complete:

- Read the phase spec file (`docs/phases/0N-*.md`).
- Identify the next unimplemented file or component within the phase.
- Implement it. Prefer small, focused work:
  - One source file, or
  - One logical component within a larger file, or
  - Tests for an already-implemented component.
- Run `npx vitest` to verify your work and all prior tests still pass.
- If you discover a bug during implementation (in your work or existing code), log it in `BUGS.md` using the format below and exit immediately — do not continue feature work.
- Exit.

### 3. All Phases Complete, Review Needed → Perform Review

Check if all 8 phases are complete (all source files exist, all tests pass). Then check review state:

- If `REVIEW_REPORT.md` does **not** exist → Perform a code review following `docs/REVIEW.md`. Write the report to `REVIEW_REPORT.md`. Exit.
- If `REVIEW_REPORT.md` exists with findings marked `Status: OPEN` → Fix one finding (treat it like a bug fix). Update the finding's status to `RESOLVED`. Run tests. Exit.
- If `REVIEW_REPORT.md` exists and all findings are `RESOLVED` or `TRIVIAL` → Delete `REVIEW_REPORT.md` and perform a fresh review following `docs/REVIEW.md`. Write the new report to `REVIEW_REPORT.md`. Exit.
- If `REVIEW_REPORT.md` exists and is clean (no non-trivial findings) → The review cycle is complete. Proceed to step 4.

### 4. Review Complete → Usage Testing

Follow the instructions in `docs/TESTING.md`. Perform one testing session, log any bugs found, and exit.

---

## Phase Identification

Phases are sequential and cumulative. A phase is **complete** when all its source files exist and all its tests pass.

Check implementation status by examining which source files exist against each phase's file list:

| Phase | Key Indicator Files | Spec |
|-------|---|---|
| 1 | `src/parser/lexer.ts`, `src/parser/parser.ts`, `src/model/context.ts` | `docs/phases/01-types-and-parser.md` |
| 2 | `src/validation/rules.ts`, `src/validation/validator.ts` | `docs/phases/02-validation.md` |
| 3 | `src/conditions/parser.ts`, `src/stylesheet/parser.ts`, `src/engine/transforms.ts` | `docs/phases/03-conditions-stylesheet-transforms.md` |
| 4 | `src/model/checkpoint.ts`, `src/backend/session-manager.ts`, `src/model/fidelity.ts` | `docs/phases/04-state-management.md` |
| 5 | `src/engine/runner.ts`, `src/engine/edge-selection.ts`, `src/engine/retry.ts` | `docs/phases/05-execution-engine.md` |
| 6 | `src/handlers/tool.ts`, `src/handlers/wait-human.ts`, `src/interviewer/interviewer.ts` | `docs/phases/06-handlers-and-human.md` |
| 7 | `src/backend/cc-backend.ts`, `src/handlers/codergen.ts` | `docs/phases/07-cc-backend-and-codergen.md` |
| 8 | `src/handlers/parallel.ts`, `src/cli.ts`, `src/index.ts` | `docs/phases/08-parallel-cli-integration.md` |

**Process:** Start from Phase 1. If the indicator files exist and tests pass for that phase, move to the next. The first phase that is incomplete is your current phase.

Note: Phases 2, 3, and 4 all depend only on Phase 1 and can be worked on in any order once Phase 1 is complete. Phase 5 requires 1-4. Phase 6, 7 require 5. Phase 8 requires all prior.

---

## Work Style

- **Small chunks.** Implement one file or one logical component. Do not try to complete an entire phase in one session.
- **Tests matter.** Every phase spec includes test cases. Implement the source code and its tests together or in immediately adjacent sessions.
- **Read before writing.** Always read existing code before modifying it. Understand the patterns already established.
- **Follow the spec.** The phase specs contain exact function signatures, type definitions, and expected behaviors. Follow them precisely.
- **Run all tests.** After any change, run `npx vitest` to ensure all existing tests still pass (regression gate).
- **No over-engineering.** Implement exactly what the spec says. No extra abstractions, no bonus features.

---

## Bug Format (BUGS.md)

When you discover a bug, append it to `BUGS.md` (create the file if it doesn't exist):

```markdown
## BUG-NNN: Short description

- **Status:** OPEN
- **Found during:** Phase N / Review / Testing
- **File(s):** `src/path/to/file.ts`
- **Description:** What's wrong and how to reproduce.
- **Expected:** What should happen.
- **Actual:** What happens instead.
```

Number bugs sequentially (BUG-001, BUG-002, etc.). Check the last number in the file before adding a new one.

---

## Project Setup

If `package.json` does not exist, the very first agent must initialize the project:

```bash
npm init -y
npm install --save-dev typescript vitest
npx tsc --init
```

Configure `tsconfig.json` per Section 3 of the spec. Configure `vitest` as appropriate.

This is a one-time setup. Subsequent agents should find the project already initialized.

---

## Key References

- Full specification: `docs/SPEC.md`
- Phase overview: `docs/phases/00-overview.md`
- Individual phase specs: `docs/phases/01-*.md` through `docs/phases/08-*.md`
- Audit of spec gaps (all resolved): `docs/phases/AUDIT.md`
- Code review instructions: `docs/REVIEW.md`
- Usage testing instructions: `docs/TESTING.md`
