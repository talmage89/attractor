# Code Review Report

**Date:** 2026-03-01
**Reviewer:** fifteenth-pass
**Test Status:** All passing (320/320 across 21 test files)

---

## Summary

This is the fifteenth code review pass of the Attractor TypeScript DAG pipeline execution engine. All 320 tests pass and the codebase is in excellent shape after 14 prior review cycles. This pass surfaces 3 findings: 2 LOW and 1 TRIVIAL. The LOW findings are a spec compliance gap (stylesheet parser silently ignores unrecognized properties instead of emitting a warning) and an API inconsistency (`findExitNode()` uses a narrower terminal-node predicate than `isTerminal()`). No critical, high, or medium issues were found.

---

## Findings

### FINDING-001: Stylesheet parser silently ignores unrecognized properties — spec requires a warning

- **Severity:** LOW
- **Category:** Spec Compliance
- **Status:** RESOLVED
- **File(s):** `src/stylesheet/parser.ts:87-90`
- **Description:** The spec (Section 13.2) states: "Recognized properties: `llm_model`, `llm_provider`, `reasoning_effort`. Unrecognized properties are ignored **with a warning**." The implementation at `parser.ts:87-90` silently skips unrecognized properties with only a source comment:

  ```ts
  if (property && KNOWN_PROPERTIES.has(property)) {
    declarations.set(property, value);
  }
  // Unrecognized properties are silently ignored
  ```

  No warning is emitted anywhere — not from `parseStylesheet`, `applyStylesheet`, or `applyTransforms`. A pipeline author who misspells a property name (e.g., `llm_Model`, `reasoning-effort`, `model`) receives no feedback that the setting was ignored. The misconfiguration passes silently.

- **Recommendation:** The cleanest approach is to add a new lint rule `stylesheetUnknownProperty` in `src/validation/rules.ts` that parses the stylesheet and emits a `warning`-severity diagnostic for each unrecognized property declaration. This fits naturally into the existing validation system and runs before execution. Example:

  ```ts
  function stylesheetUnknownPropertyRule(graph: Graph): Diagnostic[] {
    const stylesheet = graph.attributes.modelStylesheet;
    if (!stylesheet) return [];
    const diags: Diagnostic[] = [];
    try {
      const rules = parseStylesheet(stylesheet);
      for (const rule of rules) {
        // StyleRule.declarations only contains KNOWN properties;
        // compare raw parse against known set by re-parsing manually,
        // OR extend parseStylesheet to return unknown properties as a separate list.
      }
    } catch { /* syntax error caught by stylesheetSyntaxRule */ }
    return diags;
  }
  ```

  Alternatively, extend `parseStylesheet` to return `{ rules: StyleRule[], unknownProperties: string[] }` and have `applyTransforms` log them (e.g. via `console.warn` or by extending the function signature to accept an optional warning callback).

---

### FINDING-002: `findExitNode()` uses narrower terminal-node predicate than `isTerminal()` — API inconsistency

- **Severity:** LOW
- **Category:** Code Quality
- **Status:** RESOLVED
- **File(s):** `src/model/graph.ts:69-80`
- **Description:** The two exported functions for identifying exit/terminal nodes use different predicates:

  ```ts
  // isTerminal (line 78-80) — the COMPLETE predicate:
  export function isTerminal(node: GraphNode): boolean {
    return node.shape === "Msquare" || node.type === "exit" || node.id === "exit" || node.id === "end";
  }

  // findExitNode (lines 69-75) — the NARROW predicate (missing `type === "exit"`):
  export function findExitNode(graph: Graph): GraphNode | null {
    for (const node of graph.nodes.values()) {
      if (node.shape === "Msquare") return node;
    }
    return graph.nodes.get("exit") ?? graph.nodes.get("end") ?? null;
  }
  ```

  `findExitNode` does not check `node.type === "exit"`. A graph that uses `type='exit'` on a node with a non-standard id (e.g., `done [type="exit"]`) would be handled correctly at runtime by `isTerminal()` but `findExitNode()` would return `null` for that graph. While `findExitNode` is not used in the runtime engine (the runner uses `isTerminal()` directly), it is exported from `graph.ts` and callable by external consumers and tests. Consumers who rely on `findExitNode` to locate the terminal node would get incorrect results for `type='exit'` nodes.

  Previous review cycles (14: FINDING-002/003) updated `terminalNodeRule` and `exitNoOutgoingRule` to use the complete predicate, but `findExitNode` was not updated at the same time.

- **Recommendation:** Update `findExitNode` to use the same predicate as `isTerminal()`:

  ```ts
  export function findExitNode(graph: Graph): GraphNode | null {
    for (const node of graph.nodes.values()) {
      if (node.shape === "Msquare" || node.type === "exit") return node;
    }
    return graph.nodes.get("exit") ?? graph.nodes.get("end") ?? null;
  }
  ```

  This makes the two exported functions consistent. A test verifying that `findExitNode` returns the node for a `type='exit'` graph would also be appropriate.

---

### FINDING-003: `FidelityMode` type is not exported from public `index.ts`

- **Severity:** TRIVIAL
- **Category:** Code Quality
- **Status:** RESOLVED
- **File(s):** `src/index.ts`
- **Description:** The `FidelityMode` type (`"full" | "truncate" | "compact" | "summary:low" | "summary:medium" | "summary:high"`) is defined in `src/model/fidelity.ts` but not re-exported from `src/index.ts`. External consumers who want type-safe fidelity mode values — for example, when implementing a custom handler that reads `resolveFidelity()` output — must import from `src/model/fidelity.js` directly (an internal module path) or use untyped string literals.

  The related `resolveFidelity` and `resolveThreadId` functions are also not exported, but those are implementation details. The type itself has clear external utility.

- **Recommendation:** Add `export type { FidelityMode } from "./model/fidelity.js";` to `src/index.ts`.

---

## Statistics

| Severity | Count |
|----------|-------|
| HIGH     | 0     |
| MEDIUM   | 0     |
| LOW      | 2     |
| TRIVIAL  | 1     |
| **Total**| **3** |

| Category        | Count |
|-----------------|-------|
| Spec Compliance | 1     |
| Code Quality    | 2     |

FINDING-001 (LOW) and FINDING-002 (LOW) are minor quality improvements. FINDING-001 addresses a spec compliance gap that could cause user confusion when stylesheet properties are misspelled. FINDING-002 closes an API inconsistency between two related exported functions. FINDING-003 (TRIVIAL) is a minor public API ergonomics improvement.
