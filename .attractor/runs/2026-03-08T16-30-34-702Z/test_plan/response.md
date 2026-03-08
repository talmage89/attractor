## test_plan — 2026-03-08T17:13:31.406Z

Test plan written to `.attractor/workspace/test-plan.md` with three agents:

- **test_a**: Primary on watchdog (highest risk — 5 files, full lifecycle), secondary on break-on-result & abort signal plumbing
- **test_b**: Primary on prompt_file (file I/O, $goal substitution, 3 validation rules) + resume-last (CLI scanning, checkpoint inspection), secondary on watchdog validation
- **test_c**: Primary on default_timeout (CodergenHandler + ToolHandler fallback chains) + comments + break-on-result, secondary on prompt_file validation

Every spec section has at least one primary assignment. High-risk areas (watchdog, prompt_file) have deliberate overlap via secondary assignments. Each agent has 5 concrete integration test scenarios including `.mjs` scripts and real CLI invocations.

---

## test_plan — 2026-03-08T17:34:25.598Z

Test plan written to `.attractor/workspace/test-plan.md`. Three agents assigned:

- **test_a**: Primary on BUG-001 (tool abort signal fix) + tool regression. Secondary on --resume-last --cwd.
- **test_b**: Primary on Bug-B1 (--resume-last --cwd) + Bug-B2 (prompt_file_not_found path). Secondary on tool abort.
- **test_c**: Primary on BUG-C1 (prompt_on_llm_nodes false positive) + prompt validation regression. Secondary on prompt_file path + default_timeout.

Each bug fix has primary + secondary coverage across agents.

---

## test_plan — 2026-03-08T17:47:12.902Z

Test plan written to `.attractor/workspace/test-plan.md`. Round 3 assigns 3 agents:

- **test_a**: logsRoot --cwd fix verification + full cwd path resolution audit + watchdog regression
- **test_b**: prompt_file runtime behavior + $goal substitution + feature combinations + logsRoot secondary
- **test_c**: break-on-result, default_timeout, comments edge cases + validation rules + --resume-last edge cases

Every spec section has primary coverage. The logsRoot fix (most recent) gets primary + secondary verification. All 5 previous bug fixes get implicit regression coverage through broader feature tests.

---

## test_plan — 2026-03-08T18:06:06.957Z

Round 4 test plan written. Focus areas:

- **test_a**: stripComments fix deep dive — escaped quotes, multi-line comments, string/comment interaction edge cases; secondary: default_timeout + watchdog regression
- **test_b**: prompt_file with comment-like content, cross-feature integration (all 6 features in one DAG); secondary: independent stripComments verification
- **test_c**: --resume-last and break-on-result regression, comments in complex DAG topologies, full baseline test suite validation

---

## test_plan — 2026-03-08T18:20:07.760Z

Round 5 test plan written. Three agents assigned:

- **test_a**: Primary on resume-last goal gate fix verification + edge cases (no gates, multiple gates, missing nodeOutcomes). Secondary on break-on-result + logsRoot regression.
- **test_b**: Primary on cross-feature integration (all 6 features combined, prompt_file+comments, watchdog+default_timeout). Secondary overlap on resume-last goal gate fix.
- **test_c**: Primary on full 8-fix cumulative regression sweep, CLI error paths, baseline test suite. Secondary on stripComments untested edge cases.

---

## test_plan — 2026-03-08T18:32:36.820Z

Round 6 test plan written to `.attractor/workspace/test-plan.md`. It assigns 3 agents:

- **test_a**: BUG-B-001 fix verification + validate path edge cases (dotfiles inside/outside/nested `.attractor/`), plus `cli.ts` cumulative regression (5 of 9 fixes touched this file)
- **test_b**: Cross-feature integration (all 6 features in one pipeline), prompt_file validation (all 3 rules), BUG-B-001 independent verification
- **test_c**: Full 9-fix regression sweep, baseline test suite + build, CLI error paths, stripComments final edge cases

---

## test_plan — 2026-03-08T18:44:38.528Z

Test plan written to `.attractor/workspace/test-plan.md`. Round 7 focuses on:

- **test_a**: Verify the Round 6 `lastIndexOf(".attractor")` fix at 1, 2, and 3+ nesting depths, plus a non-`.attractor/` non-regression case
- **test_b**: Cross-feature integration (all 6 features in one DAG), validate from different CWDs, prompt_file rule coverage, CLI error paths
- **test_c**: Full 596-test baseline, programmatic 10-fix regression sweep via `.mjs` scripts, stripComments edge cases, default_timeout/watchdog validation edge cases

All 3 agents overlap on the latest fix verification. Every prior bug fix is retested.