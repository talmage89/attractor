# Attractor — Code Review Instructions

You are performing a thorough code review of the Attractor project. Your goal is to produce an extensive report covering correctness, quality, test coverage, and adherence to the specification.

## Preparation

1. Read the full specification: `docs/SPEC.md`
2. Read the phase overview: `docs/phases/00-overview.md`
3. Read the audit document: `docs/phases/AUDIT.md`
4. Read every source file in `src/` and every test file in `tests/`
5. Run `npx vitest` to confirm all tests pass before starting the review

## Review Dimensions

Evaluate the codebase across all of the following dimensions. Be thorough — this review is the quality gate between implementation and real usage.

### 1. Spec Compliance

For each phase (1-8), compare the implementation against its phase spec (`docs/phases/0N-*.md`):

- Are all specified functions and classes implemented?
- Do function signatures match the spec?
- Are all specified behaviors handled (including edge cases called out in the spec)?
- Are all type definitions present and correct?
- Are enum values and string literals exactly as specified?
- Are all 13 validation rules implemented correctly?
- Does the edge selection algorithm follow the specified 5-step priority?
- Does the retry policy match the spec (exponential backoff, jitter, max retries)?

### 2. Correctness

- **Logic errors:** Off-by-one errors, incorrect conditions, wrong operator precedence.
- **Null/undefined handling:** Missing null checks, unsafe property access.
- **Async correctness:** Missing awaits, unhandled promise rejections, race conditions.
- **Error handling:** Are errors caught and propagated correctly? Are error messages clear?
- **Type safety:** Any use of `any`, unsafe casts, or type assertions that bypass safety?
- **Edge cases:** Empty graphs, single-node graphs, cycles (should be caught by validation), missing attributes.

### 3. Test Quality

- **Coverage:** Are all public functions tested? Are edge cases covered?
- **Assertions:** Do tests assert the right things? Are assertions specific enough?
- **Isolation:** Do tests depend on each other or on external state?
- **Fixtures:** Are test fixtures representative? Do they cover the cases specified in phase specs?
- **Missing tests:** Identify any behaviors specified in the spec that lack test coverage.
- **Test correctness:** Do any tests assert incorrect expected values?

### 4. Code Quality

- **Readability:** Is the code clear and self-documenting?
- **Consistency:** Are naming conventions consistent? Is the code style uniform?
- **Duplication:** Is there duplicated logic that should be shared?
- **Complexity:** Are there overly complex functions that should be decomposed?
- **Dead code:** Unused imports, unreachable branches, commented-out code.
- **Module boundaries:** Are module responsibilities clear and well-separated?

### 5. Security and Robustness

- **Injection risks:** Does the ToolHandler sanitize shell commands?
- **Path traversal:** Are file paths validated before writing?
- **Resource limits:** Are there timeout protections? Memory concerns with large graphs?
- **Input validation:** Are external inputs (DOT files, CLI arguments) validated?

### 6. Integration Concerns

- **Module interfaces:** Do modules compose correctly at integration points?
- **Public API:** Does `src/index.ts` export everything needed for external consumers?
- **CLI:** Does the CLI parse arguments correctly and handle errors gracefully?
- **Checkpoint/Resume:** Can a pipeline actually be resumed from a checkpoint?

## Report Format

Write the report to `REVIEW_REPORT.md` in the project root using this structure:

```markdown
# Code Review Report

**Date:** YYYY-MM-DD
**Reviewer:** AI Agent
**Test Status:** All passing / N failures

## Summary

Brief overall assessment (2-3 sentences).

## Findings

### FINDING-NNN: Short title

- **Severity:** CRITICAL / HIGH / MEDIUM / LOW / TRIVIAL
- **Category:** Spec Compliance / Correctness / Test Quality / Code Quality / Security / Integration
- **Status:** OPEN
- **File(s):** `src/path/to/file.ts:NN`
- **Description:** What the issue is.
- **Recommendation:** How to fix it.

(Repeat for each finding)

## Statistics

- Total findings: N
- Critical: N
- High: N
- Medium: N
- Low: N
- Trivial: N
```

## Severity Definitions

- **CRITICAL:** Broken functionality, data loss risk, security vulnerability. Must fix.
- **HIGH:** Incorrect behavior, missing spec requirement, significant logic error. Must fix.
- **MEDIUM:** Suboptimal implementation, weak test coverage, potential issues. Should fix.
- **LOW:** Minor code quality issues, minor naming concerns. Nice to fix.
- **TRIVIAL:** Stylistic preferences, minor nits. No action required — will not block the review cycle.

## Important Notes

- Number findings sequentially (FINDING-001, FINDING-002, etc.).
- Be specific: include file paths, line numbers, and concrete examples.
- For each finding, provide a clear, actionable recommendation.
- The review cycle continues until a review report has zero non-trivial (CRITICAL/HIGH/MEDIUM/LOW) findings. Only then is the code considered ready for usage testing.
- When a subsequent agent fixes a finding, they change its `Status:` from `OPEN` to `RESOLVED`.
- If a finding turns out to be a non-issue upon closer inspection, it should be changed to `Status: WONTFIX` with a justification.
