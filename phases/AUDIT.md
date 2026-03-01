# Phase Spec Audit: Problems, Gaps, and Ambiguities

Comparison of phase specs (01-08) against the [source Attractor spec](https://github.com/strongdm/attractor) and local `SPEC.md`. Evaluated from the perspective of an AI agent implementing each phase independently with a fresh context window.

---

## CRITICAL: Issues That Would Cause Incorrect Implementation

### 1. Missing `house` / `stack.manager_loop` shape mapping (Phase 5)

The source spec defines **9** shape-to-type mappings, including `house → stack.manager_loop`. The local SPEC.md explicitly excludes it (Section 1.2), which is a deliberate scoping decision — but **Phase 5 doesn't mention this exclusion**. An agent implementing the `SHAPE_TO_TYPE` map would produce an incomplete mapping without knowing why. If a DOT file uses `shape=house`, the handler registry silently falls through to the default (codergen) handler, which is wrong behavior without at least a validation warning.

**Suggestion:** Add `house` to the `SHAPE_TO_TYPE` map in Phase 5's `registry.ts` section (mapping to `"stack.manager_loop"`), and add a `typeKnownRule` entry for it in Phase 2. Either register a stub handler that returns `{ status: "fail", failureReason: "stack.manager_loop not implemented" }`, or add it as an "unimplemented" warning in validation. The agent needs to know this type exists but is out of scope.

### 2. Retry logic contradicts the source spec (Phase 5)

The local SPEC.md Section 8.5 retry pseudocode correctly shows that **FAIL returns immediately without retrying** — only RETRY triggers retries. However, Phase 5's completion criteria says:

> "Retry logic respects maxAttempts and backoff"

This is vague. The source spec's Section 11.5 (Definition of Done) itself has a contradictory statement: *"Nodes with `max_retries > 0` retried on RETRY or FAIL"* — but the normative pseudocode says otherwise. An agent reading only Phase 5 has no guidance on this. The runner test fixtures don't test retry behavior at all (no test for a handler that returns `{ status: "retry" }`).

**Suggestion:** Add explicit text to Phase 5: *"FAIL outcomes are returned immediately and do NOT trigger retry. Only RETRY status triggers retry. Only caught exceptions trigger retry."* Add a test case with a mock handler that returns `retry` twice then `success`.

### 3. `loopRestart` edge behavior is undefined (Phase 5)

The local SPEC.md Section 8.2 step (g) says:

> "If edge.loopRestart: Restart the run with a fresh logsRoot. RETURN."

But Phase 5 provides **zero implementation guidance or tests** for this behavior. An agent would see `loopRestart: boolean` on the Edge interface (Phase 1) and the brief mention in the runner pseudocode, but has no idea what "restart the run" means concretely. Does it re-call `run()` recursively? Does it create a new logs directory? What about state? Is the checkpoint cleared?

**Suggestion:** Either add a dedicated section in Phase 5 explaining loopRestart semantics (recursive call to `run()` with fresh logsRoot, reset completedNodes, preserve context), or explicitly defer it to Phase 8 with a note: *"loopRestart handling is deferred. The engine should throw 'loopRestart not yet implemented' if encountered."*

### 4. Dot-in-identifier lexer decision contradicts the source BNF (Phase 1)

Phase 1's lexer test explicitly decides:

> "The lexer treats dots in identifiers as part of the identifier. `human.default_choice` is one IDENTIFIER token."

But the source spec's BNF grammar says:

```
Identifier    ::= [A-Za-z_][A-Za-z0-9_]*
QualifiedId   ::= Identifier ( '.' Identifier )+
Key           ::= Identifier | QualifiedId
```

Dots are **not** part of the `Identifier` production. They're separators in `QualifiedId`, which is a parser-level construct. Making dots part of the lexer's identifier pattern means the lexer can't distinguish between `node.attr_name` (a qualified key) and a node named `node.attr_name` (which shouldn't be a valid node ID per the spec).

**Suggestion:** This is actually fine for the implementation since node IDs never contain dots and qualified keys always appear in attribute contexts. But the phase spec should acknowledge the divergence: *"This is a simplification — the source BNF treats dots as separators in QualifiedId. Since node IDs never contain dots in practice, treating dotted names as single tokens at the lexer level is equivalent and simpler."*

### 5. Context class is used in Phase 3 tests but not created until Phase 4

Phase 3's condition evaluator tests import `Context`:

```typescript
import { Context } from "../../src/model/context";
```

But `context.ts` is specified as a Phase 4 file. An agent implementing Phase 3 independently would fail to compile these tests.

**Suggestion:** Either move `Context` to Phase 1 (it has no dependencies), or stub it in Phase 3's scope: *"Create a minimal Context class for condition evaluator tests. The full implementation is in Phase 4."*

### 6. `reachableFrom` function is specified in SPEC.md but never created in any phase

SPEC.md Section 5.3 lists:

```typescript
function reachableFrom(graph: Graph, nodeId: string): Set<string>
```

But Phase 1 only specifies `outgoingEdges`, `incomingEdges`, `findStartNode`, `findExitNode`, and `isTerminal`. Phase 2 uses BFS in the `reachabilityRule` but implements it inline. No phase ever creates the standalone `reachableFrom` function.

**Suggestion:** Either add `reachableFrom` to Phase 1's graph query helpers (it's a simple BFS utility that Phase 2 would reuse), or remove it from SPEC.md Section 5.3.

---

## HIGH: Issues That Would Cause Subtle Bugs or Missing Features

### 7. Edge selection Step 1 has an under-specified interaction with Steps 4-5 (Phase 5)

Phase 5 describes the 5-step algorithm but doesn't clarify a critical detail from the source spec: In Step 1, when multiple condition-matched edges exist, **`best_by_weight_then_lexical`** is applied to just the condition-matched set. Steps 4-5 operate on **unconditional edges only**. The phase spec's description is ambiguous about whether Steps 4-5 consider ALL remaining edges or just unconditional ones.

The source spec says:
> "Step 4: Highest weight. Among remaining eligible **unconditional** edges..."

Phase 5's edge-selection test `"condition match beats weight"` partially covers this, but there's no test for the case where Step 1 finds multiple condition matches and needs to tiebreak among them by weight.

**Suggestion:** Add a test case where two edges both have matching conditions but different weights. Also add explicit text: *"Steps 4-5 consider ONLY edges with empty condition strings."*

### 8. Missing `k_of_n` and `quorum` join policies (Phase 8)

The source spec defines **4** join policies: `wait_all`, `first_success`, `k_of_n`, and `quorum`. Phase 8 only implements `wait_all` and `first_success`. The local SPEC.md doesn't mention the other two.

**Suggestion:** This may be intentional scoping, but Phase 8 should explicitly state: *"Only `wait_all` and `first_success` are implemented. `k_of_n` and `quorum` are deferred."* An agent needs to know what to do if it encounters these values — probably treat them as `wait_all` with a warning.

### 9. Missing `error_policy` for parallel nodes (Phase 8)

The source spec defines 3 error policies (`fail_fast`, `continue`, `ignore`) for parallel execution. Phase 8 doesn't mention error policies at all. The parallel handler always uses `continue` behavior implicitly (collects all results).

**Suggestion:** Add a note: *"Error policy is not implemented. All parallel executions use implicit 'continue' behavior."*

### 10. Source spec graph attributes `stack.child_dotfile`, `stack.child_workdir`, `tool_hooks.pre`, `tool_hooks.post` are unmentioned

The source spec's Appendix A defines these graph-level attributes. None appear in any phase spec or in the `GraphAttributes` interface. While `stack.*` relates to the excluded `manager_loop`, `tool_hooks.*` is an independent feature that affects tool handler behavior.

**Suggestion:** At minimum, add these to the `raw` map so they're preserved. If `tool_hooks` should be implemented, add pre/post hook execution to the ToolHandler in Phase 6. If deferred, document it.

### 11. `has()` and `keys()` on Context don't exist in the source spec (Phase 4)

Phase 4 adds `has()` and `keys()` methods to Context. The source spec defines: `set`, `get`, `get_string`, `append_log`, `snapshot`, `clone`, `apply_updates`. No `has()` or `keys()`.

The source spec also defines `append_log(entry)` which **none** of the phases implement.

**Suggestion:** `has()` and `keys()` are reasonable additions. But the missing `append_log` could be a problem if any source spec behavior depends on it. Add a note acknowledging the divergence: *"Context adds `has()` and `keys()` for convenience. `append_log()` from the source spec is deferred."*

### 12. `generatePreamble` needs `completedNodes` and `nodeOutcomes` but CodergenHandler doesn't receive them (Phase 7)

Phase 7's `CodergenHandler.execute()` receives `(node, context, graph, config)`. But `generatePreamble()` requires `completedNodes: string[]` and `nodeOutcomes: Map<string, Outcome>`. These aren't on `RunConfig` or `Context`.

The local SPEC.md Section 9.5 has a comment acknowledging this gap: `/* completedNodes and nodeOutcomes from engine — passed via config or context */` — but doesn't resolve it.

**Suggestion:** Either extend `RunConfig` to include `completedNodes` and `nodeOutcomes`, or have the engine store them on the context before calling the handler (e.g., `context.set("__completedNodes", completedNodes)`). The phase spec needs to pick one approach explicitly.

### 13. Runner tests use `await import()` for graph helpers but test function is not async (Phase 1)

Phase 1's parser test uses dynamic `await import()`:

```typescript
it("outgoingEdges returns correct edges", () => {
  const { outgoingEdges } = await import("../../src/model/graph");
```

But the test function is not `async` — it's `it("...", () => {`. This will silently return a pending promise and the test will pass without actually running the assertion. An agent copying this verbatim will have tests that don't actually test anything.

**Suggestion:** Change to `it("...", async () => {` or use static imports.

---

## MEDIUM: Ambiguities and Missing Context

### 14. No guidance on how the engine handles the start node (Phases 5-6)

The execution loop says "find start node, enter traversal loop." But should the start node's handler be executed? Phase 6 defines `StartHandler` returning `{ status: "success" }`, and the local SPEC.md loop visits it. But Phase 5's runner test for `"handles pipeline with no work nodes (start -> exit)"` expects `completedNodes` to have length 0 — implying start and exit are NOT recorded in `completedNodes`.

This creates confusion: Is the start node executed but not recorded? Executed and recorded? Skipped entirely?

**Suggestion:** Add explicit text: *"The start node IS executed (handler returns success) but is NOT added to completedNodes. The exit node IS executed but is NOT added to completedNodes. Only work nodes are recorded."* — or whatever the intended behavior is. Be explicit.

### 15. Fidelity resolution in Phase 4 doesn't explain how `incomingEdge` is passed

`resolveFidelity(node, graph, incomingEdge?)` and `resolveThreadId(node, graph, incomingEdge?, previousNodeId?)` take an `incomingEdge` parameter. But Phase 5's runner never shows how the incoming edge is tracked and passed. The runner's traversal loop in SPEC.md step (h) says `currentNode = graph.nodes.get(edge.to)!` — the edge is available there, but Phase 5 doesn't mention passing it to fidelity resolution.

**Suggestion:** In Phase 5, add: *"After selecting an edge in step (f), the engine stores it as `lastEdge`. When executing the next node in step (b), pass `lastEdge` to `resolveFidelity()` and `resolveThreadId()`."*

### 16. Phase 3's stylesheet parser restricts properties to only 3, but the source spec says unrecognized properties should be "ignored with a warning"

Phase 3 says properties "must be one of: `llm_model`, `llm_provider`, `reasoning_effort`." The source spec says unrecognized properties are "ignored with a warning." Phase 3 doesn't specify what happens with unrecognized properties — does it throw? Ignore? Warn?

**Suggestion:** Add: *"Unrecognized property names are silently ignored (not added to the declarations map). No error is thrown."*

### 17. Phase 8's `executeBranch` is under-specified

Phase 8 says `executeBranch` is "a simplified traversal loop" but doesn't specify critical behaviors:
- Does it use `executeWithRetry`, or call the handler directly?
- Does it emit events?
- Does it apply context updates within the branch?
- What happens if a branch hits a conditional node?

**Suggestion:** Specify: *"`executeBranch` reuses `selectEdge` and handler dispatch from the registry. It DOES apply context updates to the cloned context within the branch. It does NOT save checkpoints. It does NOT emit pipeline-level events (only parallel-specific events). It terminates at fan-in nodes, terminal nodes, or dead ends."*

### 18. No test for checkpoint resume behavior (Phases 4-5)

Checkpoint save/load is tested in Phase 4, but no phase tests the actual **resume-from-checkpoint** flow. Phase 5's runner tests don't include a `resumeFromCheckpoint` test. An agent implementing resume would have no way to verify correctness.

**Suggestion:** Add a runner test that: (1) runs a pipeline that saves a checkpoint partway through, (2) loads that checkpoint and resumes, (3) verifies the pipeline completes from the resumed point.

### 19. Phase 7's CC SDK mock may not match real SDK API

Phase 7 mocks `query()` as returning an async generator, but the actual `@anthropic-ai/claude-agent-sdk` API may differ. The mock yields `{ type: "system", subtype: "init" }`, `{ type: "assistant" }`, and `{ type: "result" }` — but these type names may not match the real SDK's message types (`SDKSystemMessage`, `SDKAssistantMessage`, `SDKResultMessage`).

**Suggestion:** Add a note: *"The mock structure should match the actual SDK types. Verify against the installed `@anthropic-ai/claude-agent-sdk` package's TypeScript definitions before writing tests."*

### 20. `SKIPPED` status handling is absent from all phases

The source spec defines `SKIPPED` as a valid `StageStatus`. The local SPEC.md's `StageStatus` type includes it. But no phase explains when or how a node gets status `SKIPPED`, and the retry logic doesn't handle it. The execution engine's traversal loop doesn't account for it.

**Suggestion:** Add to Phase 5: *"SKIPPED status is used when a node is bypassed (e.g., via conditional routing). The engine does not execute skipped nodes — SKIPPED is informational only and may be set by custom handlers."*

### 21. Phase 2's `conditionSyntaxRule` and `stylesheetSyntaxRule` are stubs that Phase 3 must update

Phase 2 explicitly says these rules are stubs: *"For Phase 2, implement a minimal check"* and *"Full integration in Phase 3."* Phase 3's completion criteria mentions: *"Phase 2 validation rules for conditions/stylesheet can now use real parsers."*

But if an agent implements Phase 3 with a fresh context, they might not know they need to go back and update Phase 2's rules. The update target files (`src/validation/rules.ts`) are listed in Phase 2's scope, not Phase 3's.

**Suggestion:** Add `src/validation/rules.ts` to Phase 3's file list explicitly, with a note: *"Update `conditionSyntaxRule` and `stylesheetSyntaxRule` to use the real parsers from this phase, replacing the Phase 2 stubs."*

---

## LOW: Minor Issues and Polish

### 22. Duration parsing belongs in the parser, but test placement is ambiguous

Phase 1 shows duration literals like `timeout="900s"` being converted to milliseconds on `GraphNode.timeout`. But the conversion logic (string to ms) isn't specified in the parser section. Is it done during lexing, parsing, or as a separate step? The test expects `900000` on the node's timeout field, implying the parser does the conversion.

**Suggestion:** Add a brief note in the parser section: *"When assigning `timeout` to a GraphNode, convert duration strings to milliseconds: ms=1, s=1000, m=60000, h=3600000, d=86400000."*

### 23. Phase 1 fixture `BRANCHING` uses `timeout="900s"` in a `node []` defaults block

The fixture has `node [shape=box, timeout="900s"]`. The timeout is a string `"900s"`, not a bare duration. The parser needs to handle duration conversion for both bare duration tokens (`900s`) AND quoted strings that look like durations (`"900s"`). Phase 1's implementation notes don't address this ambiguity.

**Suggestion:** Add: *"Duration strings may appear as bare tokens (`900s`) or quoted strings (`\"900s\"`). Both should be converted to milliseconds when assigned to `timeout`."*

### 24. Missing `parallel.fan_in` in Phase 2's `typeKnownRule` test

Phase 2 tests `wait.human` as a known type but doesn't test `parallel.fan_in` or `parallel`. Since these have dots/underscores, they're worth verifying.

### 25. Phase 8 CLI defaults to `bypassPermissions` which may surprise users

The CLI defaults to `--permission-mode bypassPermissions`. This is a security-relevant default that should at least be called out explicitly with rationale.

---

## Summary

All 25 issues have been resolved in the phase specs.

| Priority | Count | Resolution |
|----------|-------|------------|
| Critical | 6 | All resolved: Context moved to Phase 1, retry semantics explicit, loopRestart deferred with throw, lexer dots acknowledged, reachableFrom added to Phase 1, house/manager_loop shape added |
| High | 7 | All resolved: edge selection clarified, join policies documented as deferred, preamble data via context `__` keys, async test bugs fixed |
| Medium | 8 | All resolved: start/exit node handling explicit, resume test added, SKIPPED status documented, executeBranch fully specified |
| Low | 4 | All resolved: duration parsing noted, fixture consistency clarified, CLI defaults rationalized |

### Resolution Details

| # | Resolution | Phase(s) Modified |
|---|-----------|-------------------|
| 1 | Added `house → stack.manager_loop` to SHAPE_TO_TYPE + stub fail handler | 2, 5 |
| 2 | Added explicit FAIL/RETRY/exception semantics + retry test cases | 5 |
| 3 | loopRestart deferred with throw "not yet implemented" | 5 |
| 4 | Added simplification note to lexer acknowledging BNF divergence | 1 |
| 5 | Moved Context class + tests from Phase 4 to Phase 1 | 1, 3, 4 |
| 6 | Added `reachableFrom()` to Phase 1 graph helpers; Phase 2 uses it | 1, 2 |
| 7 | Added clarification text + tiebreak test for condition-matched edges | 5 |
| 8 | Added deferred note for `k_of_n`/`quorum` join policies | 8 |
| 9 | Added deferred note for error policy (implicit `continue`) | 8 |
| 10 | Added note about unimplemented source spec graph attributes | 8 |
| 11 | Added divergence note on `has()`/`keys()` and deferred `append_log` | 1 |
| 12 | Engine stores `__completedNodes`/`__nodeOutcomes` on context for handlers | 5, 7 |
| 13 | Changed graph helper test callbacks to `async` | 1 |
| 14 | Added explicit start/exit node handling text | 5 |
| 15 | Added `lastEdge` tracking for fidelity/thread resolution | 5 |
| 16 | Added "unrecognized properties silently ignored" behavior | 3 |
| 17 | Fully specified `executeBranch` behavior (retry, context, events, termination) | 8 |
| 18 | Added checkpoint resume test | 4 |
| 19 | Added SDK compatibility note for mock structure | 7 |
| 20 | Added SKIPPED status note in retry semantics | 5 |
| 21 | Added `src/validation/rules.ts` to Phase 3 files to update | 3 |
| 22 | Added duration conversion note in parser section | 1 |
| 23 | Added note about bare vs. quoted duration strings | 1 |
| 24 | Added `parallel.fan_in` and `stack.manager_loop` to typeKnownRule test | 2 |
| 25 | Added rationale for `bypassPermissions` default | 8 |
