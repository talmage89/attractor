## test_plan — 2026-03-06T02:21:55.798Z

Test plan written to `.attractor/workspace/test-plan.md` with three agents:

- **test_a** — Semantic token classifier correctness (state machine, token mapping, modifiers, subgraphs, conditions)
- **test_b** — LSP server integration & extension package verification (capability, manifest, error resilience, language config)
- **test_c** — Build pipeline, SVG icon & end-to-end spec compliance (build artifacts, delta encoding, integration checklist)

Each agent has 5 specific scenarios. The coverage matrix ensures every spec requirement has at least one primary and one secondary agent, with the highest-risk code (the classifier) tested by all three from different angles.

---

## test_plan — 2026-03-06T02:40:30.319Z

Test plan updated at `.attractor/workspace/test-plan.md`. The plan is tailored for post-BUG-001 fix verification:

- **test_a**: Primary focus on the fix itself — bare assignment variants, `hasArrowAhead` terminator correctness, subgraph nesting, and node-decl path regression
- **test_b**: Extension manifest/LSP verification plus error resilience with malformed `EQUALS` inputs that stress the new code path
- **test_c**: Build pipeline integrity, full test suite, delta encoding with bare assignments, and attr key modifier regression matrix

All three agents overlap on the BUG-001 fix area from different angles to maximize confidence.

---

## test_plan — 2026-03-06T02:53:35.693Z

Test plan updated at `.attractor/workspace/test-plan.md`. The plan shifts focus to the quoted duration fix (the newest change) while maintaining coverage of BUG-001 and the extension package:

- **test_a**: Duration regex boundary testing (30s, 1500ms, edge cases like "30", "abc", "30ss"), all 5 attr contexts, non-timeout keys, BUG-001 interaction with duration values
- **test_b**: Extension manifest/LSP/SVG full audit, error resilience with timeout-related malformed inputs
- **test_c**: Build pipeline, delta encoding with duration values, attr modifier matrix, condition+duration coexistence