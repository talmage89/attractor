# Implementation Plan

The spec declares 4 changes with an explicit implementation order. Adopted as-is.

---

## Phase 1: Centralized model registry with alias resolution (Spec Change 4)

**Goal**: Create a model alias registry and wire it into the codergen handler and CC backend.

**Files to create/modify**:
- Create `packages/attractor/src/model/models.ts` — `Models` const, `ModelAlias` type, `resolveModel()` function
- Modify `packages/attractor/src/handlers/codergen.ts` — call `resolveModel()` on `node.llmModel`
- Modify `packages/attractor/src/backend/cc-backend.ts` — replace hardcoded `"claude-sonnet-4-6"` with `Models.SONNET`
- Modify `packages/attractor/src/index.ts` — export `Models`, `resolveModel`, `ModelAlias`
- Create `packages/attractor/test/model/models.test.ts` — unit tests for `resolveModel` and `Models`
- Modify `packages/attractor/test/handlers/codergen.test.ts` — add integration test: set `node.llmModel = "opus"`, verify `runCC` receives `"claude-opus-4-6"`

**Acceptance criteria**:
- `resolveModel("opus")` → `"claude-opus-4-6"`, case-insensitive
- Unknown strings pass through unchanged
- `Models.SONNET` used as default in cc-backend instead of hardcoded string
- CodergenHandler resolves aliases before passing to CC backend
- All existing tests still pass + new model tests pass

**Dependencies**: None

---

## Phase 2: Better comparators in condition expressions (Spec Change 3)

**Goal**: Add `>`, `>=`, `<`, `<=` operators to condition parser and evaluator.

**Files to modify**:
- `packages/attractor/src/conditions/parser.ts` — extend `Clause.operator` type, ordered operator search
- `packages/attractor/src/conditions/evaluator.ts` — numeric comparison with NaN guards
- Check `packages/attractor/src/validation/rules.ts` — verify condition syntax validation rule accepts new operators (update if needed)
- Existing condition test files — add parser and evaluator test cases

**Acceptance criteria**:
- Parser recognizes all 6 operators (`=`, `!=`, `>`, `>=`, `<`, `<=`) with longest-match-first precedence
- Evaluator does float comparison for ordering operators, returns false on NaN
- Bare-key fallback still works
- Mixed conditions (`>=` with `&&` and `!=`) work correctly
- All existing tests pass + new condition tests pass

**Dependencies**: None (can run in parallel with Phase 1)

---

## Phase 3: Result visibility — append to response.md (Spec Change 2)

**Goal**: Change codergen handler to append to `response.md` and `prompt.md` instead of overwriting.

**Files to modify**:
- `packages/attractor/src/handlers/codergen.ts` — append with header separator instead of overwrite
- `packages/attractor/test/handlers/codergen.test.ts` — test append behavior

**Acceptance criteria**:
- `response.md` appends with `## <nodeId> — <ISO timestamp>` headers separated by `---`
- `prompt.md` uses the same append pattern
- First entry omits the leading `---`
- `status.json` continues to overwrite (no change)
- Executing a node twice produces both entries in order
- All existing tests pass + new codergen test passes

**Dependencies**: Phase 1 (codergen handler is modified in both — do Phase 1 first to avoid merge conflicts)

---

## Phase 4: User-facing documentation — `.dag` file terminology + all README updates (Spec Change 1 + docs from Changes 3, 4)

**Goal**: Update README.md with `.dag` terminology, model alias docs, and comparator docs.

**Files to modify**:
- `README.md` — `.dot` → `.dag` in user-facing examples, add model alias section, update condition operator docs

**Acceptance criteria**:
- Lines 5, 9, 42–49, 45, 195 use `.dag` instead of `.dot` per spec
- Line 211 ("DOT lexer and parser") remains unchanged
- Model Aliases subsection added with table and examples
- Conditions line updated to include `>`, `>=`, `<`, `<=` with example
- No runtime changes (CLI is extension-agnostic)
- All tests still pass

**Dependencies**: Phases 1–3 (so all code changes are done and README reflects final state)
