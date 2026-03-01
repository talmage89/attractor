# Code Review Report

**Date:** 2026-03-01
**Reviewer:** AI Agent (seventh-pass)
**Test Status:** All passing (260/260)

## Summary

The codebase is in excellent shape after six prior review cycles. This seventh-pass review found no critical, high, or medium severity issues. Two low-severity findings were identified: a spec-compliance regression introduced by review cycle 6's FINDING-001 (the `resolveThreadId` priority order now contradicts SPEC.md), and a test-quality gap that allowed the regression to go undetected.

---

## Findings

### FINDING-001: `resolveThreadId` priority order contradicts SPEC.md (regression from review cycle 6)

- **Severity:** LOW
- **Category:** Spec Compliance / Correctness
- **Status:** OPEN
- **File(s):** `src/model/fidelity.ts:28-29`
- **Description:** SPEC.md (lines 1506–1507) and the Phase 4 completion criteria both specify that `resolveThreadId` should resolve node-level `threadId` **before** edge-level `threadId` — i.e., the priority chain is `node > edge > className > previousNodeId > nodeId`. The SPEC.md pseudocode is unambiguous:
  ```typescript
  if (node.threadId) return node.threadId;            // node first (spec)
  if (incomingEdge?.threadId) return incomingEdge.threadId;  // edge second (spec)
  ```
  Review cycle 6 FINDING-001 deliberately inverted this to `edge > node` to "align `resolveThreadId` with `resolveFidelity`". However, `resolveFidelity` and `resolveThreadId` are intentionally specified with **different** priority orders: fidelity is `edge > node` while threadId is `node > edge`. The alignment rationale was incorrect. The current implementation:
  ```typescript
  if (incomingEdge?.threadId) return incomingEdge.threadId;  // edge first (wrong)
  if (node.threadId) return node.threadId;  // node second (wrong)
  ```
  **Impact:** A node with an explicit `thread_id="isolated"` attribute will be overridden by any incoming edge that also sets `thread_id`, contrary to spec intent. This affects CC session grouping: nodes that declare a fixed thread identity can have that identity silently hijacked by an upstream edge attribute.
- **Recommendation:** Restore the spec-correct order in `resolveThreadId`: check `node.threadId` before `incomingEdge?.threadId`. Update or add a test to verify node > edge priority explicitly (see FINDING-002).

---

### FINDING-002: `resolveThreadId` tests do not cover the case where both node and edge have `threadId` set

- **Severity:** LOW
- **Category:** Test Quality
- **Status:** OPEN
- **File(s):** `test/backend/fidelity.test.ts:311-345`
- **Description:** The two existing `resolveThreadId` tests exercise disjoint cases: (a) node has `threadId`, edge is absent — returns node's value; and (b) node has no `threadId`, edge has `threadId` — returns edge's value. Neither test sets **both** `node.threadId` and `incomingEdge.threadId` simultaneously, so the priority order between them is never verified. This gap allowed review cycle 6's priority inversion (FINDING-001 above) to pass all tests without detection.
- **Recommendation:** Add a conflict-resolution test to `fidelity.test.ts`:
  ```typescript
  it("returns node threadId over edge threadId (node > edge priority)", () => {
    const node = makeNode({ threadId: "node-thread" });
    const edge: Edge = {
      from: "a", to: "test", label: "", condition: "",
      weight: 0, fidelity: "", threadId: "edge-thread", loopRestart: false,
    };
    expect(resolveThreadId(node, graph, edge)).toBe("node-thread");
  });
  ```
  This test should be added alongside the FINDING-001 fix so both the implementation and the test are corrected together.

---

## Statistics

- Total findings: 2
- Critical: 0
- High: 0
- Medium: 0
- Low: 2
- Trivial: 0
