## test_c — 2026-03-08T17:15:35.490Z

Testing complete. Here's a summary of what I found:

## Results: test_c (default_timeout, Comments, Break-on-result)

**Baseline**: 583 tests passing ✓, build clean ✓, typecheck clean ✓

### BUG-1: `prompt_on_llm_nodes` false positive when `prompt_file` is set

A codergen node configured with only `prompt_file` (the primary use case for the new feature) gets a spurious `[warning] (prompt_on_llm_nodes) LLM node 'X' has no prompt or label`. 

Root cause: `promptOnLlmNodesRule` in `validation/rules.ts:372` checks `!node.prompt && !hasExplicitLabel` but doesn't check `!node.promptFile`. Fix: add `&& !node.promptFile` to the condition.

### All Other Features Working Correctly

- **`default_timeout`**: Parsing (30m/1h/90m/ms integers), fallback chain (codergen: node→graph→1h; tool: node→graph→30s), and validation (0s/−1m → [error]) all work as specified ✓
- **Comments**: Line comments, block comments, inline positions, inside attribute blocks, before `digraph` all work ✓ (nested `/* /* */ */` causes a confusing Fatal error — noted as observation, not a spec violation)
- **Break-on-result**: `break;` is present immediately after `resultMessage = msg`, `finally` block cleans up timeout correctly ✓
- **`prompt_file` validation rules**: All three rules (non-codergen warning, conflict warning, not-found warning) work correctly ✓

---

## test_c — 2026-03-08T17:36:47.926Z

Testing complete. Here's a summary:

**Baseline:** 588 tests pass (515 + 73 LSP), build and typecheck clean.

**BUG-C1 fix verified (primary):** `prompt_on_llm_nodes` no longer fires false positives when `prompt_file` is set. All 14 combinations tested — correct nodes warn, correct nodes don't.

**Bug-B2 fix verified (secondary):** `prompt_file_not_found` now resolves relative to the dotfile's directory, not `process.cwd()`. Tested from a different working directory — no false positives, missing files still correctly caught.

**default_timeout regression:** Clean. All 7 tests pass — parsing, fallback chain (1h default), node override, `0s` error validation.

**No new bugs found.** The one pre-existing observation (nested `/* */` comments cause Fatal error) was already known from round 1 and is not a spec violation.

---

## test_c — 2026-03-08T17:49:28.823Z

Testing complete. Here's my summary:

## test_c Results: 2 Bugs Found

**All baseline tests pass** (589/589), build clean, typecheck clean.

### Bug 1 (Critical): `//` inside quoted string → parser crash
```
plan [shape=box, prompt="See https://example.com"]
# Fatal: Unterminated string at line N, column M
```
`stripComments()` in `lexer.ts` is not string-aware — it strips `//` to end-of-line even inside quoted values, consuming the closing `"`.

### Bug 2 (High): `/* */` inside quoted string → silent data loss
```
plan [shape=box, prompt="Read /* docs.md */ carefully"]
# prompt becomes: "Read                  carefully"
```
Same root cause: block comment stripping inside string literals erases content without error.

**Root cause**: `src/parser/lexer.ts` `stripComments()` processes the entire source without tracking quoted string boundaries.

### All other tests passed cleanly:
- **break-on-result**: 4/4 ✓ — generator breaks after result, doesn't hang
- **default_timeout**: 10/10 ✓ — parsing, validation, and runtime (tool killed in 327ms)
- **Comments** (outside strings): 10/10 ✓
- **Validation rules** (all new rules): 10/10 ✓
- **--resume-last edge cases**: 7/7 ✓

---

## test_c — 2026-03-08T18:08:18.230Z

## Summary

**Baseline**: 593 tests passing, build and typecheck clean.

**Integration tests run**: 38 tests across 4 areas.

**Bug found (1):**

**BUG-1: `--resume-last` says "Last pipeline completed **successfully**, nothing to resume" after a failed pipeline.**

When the most recent pipeline run fails (e.g., due to a goal gate violation with `exit 1`), but the checkpoint's `currentNode` is at the exit node, `--resume-last` prints "Last pipeline completed **successfully**, nothing to resume" (exit 0) — even though the pipeline exited with `Status: fail` (exit 1).

The spec requires checking that the pipeline "completed successfully (all goal gates satisfied)" before showing this message. The implementation only checks if `currentNode` is an exit node. Root cause: `cli.ts` line ~183 — `isExitNode` check doesn't verify pipeline success status.

**All other tests PASS:**
- `--resume-last` error cases (no runs dir, empty dir, mutual exclusion, corrupted checkpoint)
- `--resume-last` end-to-end (mid-run resume, ghost node handling, sort order, type=exit/id=end detection)
- `break-on-result`: `break` correctly placed after `resultMessage = msg`, inside `try` block before `finally`
- Comments in complex DAG structures: mid-arrow, inside attribute blocks, before digraph keyword, multiple block comments, stripComments fix verified

---

## test_c — 2026-03-08T18:22:21.696Z

**test_c complete — no bugs found.**

## Summary

**Baseline:** 594 tests passing (521 attractor + 73 LSP), build and typecheck clean.

**Tests run (38 total, all PASS):**

1. **Regression sweep (16 tests)** — exercised all 8 previously-fixed bugs:
   - strip-1/strip-2: `//` and `/* */` inside quoted strings preserved correctly
   - BUG-C1: `prompt_on_llm_nodes` no longer false-positive when `prompt_file` set
   - Bug-B2: `prompt_file_not_found` correctly resolves relative to `cwd`/dotfile dir
   - `default_timeout` parsing and validation
   - `watchdog_idle`/`watchdog_poll` parsing and validation
   - `prompt_file` attribute parsing and validation rules

2. **Resume-last end-to-end (Scenario 3)** — ran a real tool pipeline, confirmed logs under `test-c-e2e/.attractor/runs/` (logsRoot fix), and `--resume-last` correctly detected "nothing to resume"

3. **stripComments edge cases (13 tests)** — escaped quotes, empty `/**/` inside/outside strings, consecutive comments, non-nested block comments — all handled correctly

4. **CLI error paths** — mutual exclusion, missing files, no prior runs, unknown commands — all produce clear error messages and correct exit codes; Round 4 goal gate fix confirmed end-to-end

---

## test_c — 2026-03-08T18:34:37.657Z

**test_c complete — no bugs found.**

Results summary:
- **Baseline**: 595 tests passing, build clean, zero type errors ✓
- **9-fix regression sweep** (18 tests): all PASS — strip-1/strip-2, BUG-C1, BUG-B-001, default_timeout, watchdog parsing all verified ✓
- **Resume-last e2e**: no-runs error, successful-run "nothing to resume", gate-check fix (fail/success), logsRoot fix, Bug-B1 --cwd fix — all correct ✓
- **CLI error paths**: mutually-exclusive flags, missing runs dir, missing file args, unknown command, parse error, invalid timeout validation — all clear ✓
- **stripComments edge cases** (31 tests): escaped quotes, empty block comments, consecutive line comments, nested comment-like content in strings, multi-line blocks, etc. — all PASS ✓

---

## test_c — 2026-03-08T18:46:52.138Z

All done. Here's a summary of what I did as `test_c`:

## Results: No Bugs Found

**Baseline:** 596/596 tests pass, build and typecheck clean.

**Integration tests executed:**
- `test_c-round7-main.mjs` — 46 tests (43 pass; 3 were test-setup bugs, not app bugs)
- `test_c-round7-edge-cases.mjs` — **25/25 pass** (corrected versions of the 3 failed tests)
- Prior round regression scripts — **31/31 pass**

**Key verifications:**
1. **Round 6 fix confirmed**: `lastIndexOf(".attractor")` correctly strips the path at 1, 2, and 3+ nesting levels; missing prompt files still warn correctly at all depths
2. **All 10 prior bug fixes hold** — no regressions found
3. **resume-last gate-check**: failed goal gate at exit node does NOT print "nothing to resume"
4. **stripComments adversarial**: URLs, escaped quotes, `/* */` inside strings, multi-line blocks — all handled correctly
5. **watchdog/default_timeout validation**: all 3 watchdog rules and `invalid_default_timeout` fire correctly