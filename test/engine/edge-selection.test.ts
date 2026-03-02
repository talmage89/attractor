import { describe, it, expect } from "vitest";
import { selectEdge } from "../../src/engine/edge-selection.js";
import { parse } from "../../src/parser/parser.js";
import { Context } from "../../src/model/context.js";
import type { Outcome } from "../../src/model/outcome.js";

describe("selectEdge", () => {
  describe("condition matching (step 1)", () => {
    it("selects edge whose condition matches", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          gate [shape=diamond]
          yes [shape=box]
          no [shape=box]
          s -> gate
          gate -> yes [condition="outcome=success"]
          gate -> no  [condition="outcome=fail"]
          yes -> e
          no -> e
        }
      `);
      const gate = graph.nodes.get("gate")!;
      const outcome: Outcome = { status: "success" };
      const ctx = new Context();

      const edge = selectEdge(graph, gate, outcome, ctx);
      expect(edge?.to).toBe("yes");
    });

    it("tiebreaks among multiple condition matches by weight", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          low  [shape=box]
          high [shape=box]
          s -> a
          a -> low  [condition="outcome=success", weight=1]
          a -> high [condition="outcome=success", weight=10]
          low -> e
          high -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, a, outcome, new Context());
      // Both conditions match, so highest weight wins
      expect(edge?.to).toBe("high");
    });

    it("condition match beats weight", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          low  [shape=box]
          high [shape=box]
          s -> a
          a -> low  [condition="outcome=success", weight=1]
          a -> high [weight=100]
          low -> e
          high -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, a, outcome, new Context());
      expect(edge?.to).toBe("low");
    });
  });

  describe("preferred label (step 2)", () => {
    it("matches preferred label from outcome", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          gate [shape=hexagon]
          approve [shape=box]
          reject  [shape=box]
          s -> gate
          gate -> approve [label="[A] Approve"]
          gate -> reject  [label="[R] Reject"]
          approve -> e
          reject -> e
        }
      `);
      const gate = graph.nodes.get("gate")!;
      const outcome: Outcome = { status: "success", preferredLabel: "Approve" };
      const edge = selectEdge(graph, gate, outcome, new Context());
      expect(edge?.to).toBe("approve");
    });

    it("normalizes accelerator prefixes in label matching", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          gate [shape=hexagon]
          fix [shape=box]
          s -> gate
          gate -> fix [label="[F] Fix issues"]
          fix -> e
        }
      `);
      const gate = graph.nodes.get("gate")!;
      const outcome: Outcome = { status: "success", preferredLabel: "fix issues" };
      const edge = selectEdge(graph, gate, outcome, new Context());
      expect(edge?.to).toBe("fix");
    });
  });

  describe("suggested next IDs (step 3)", () => {
    it("matches suggested next ID", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          b [shape=box]
          c [shape=box]
          s -> a
          a -> b
          a -> c
          b -> e
          c -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success", suggestedNextIds: ["c"] };
      const edge = selectEdge(graph, a, outcome, new Context());
      expect(edge?.to).toBe("c");
    });
  });

  describe("weight (step 4)", () => {
    it("selects highest weight among unconditional edges", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          b [shape=box]
          c [shape=box]
          s -> a
          a -> b [weight=5]
          a -> c [weight=10]
          b -> e
          c -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, a, outcome, new Context());
      expect(edge?.to).toBe("c");
    });
  });

  describe("lexical tiebreak (step 5)", () => {
    it("breaks ties alphabetically by target node ID", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          beta [shape=box]
          alpha [shape=box]
          s -> a
          a -> beta  [weight=0]
          a -> alpha [weight=0]
          beta -> e
          alpha -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, a, outcome, new Context());
      expect(edge?.to).toBe("alpha");
    });
  });

  describe("invalid weight (NaN) handling (BUG-020)", () => {
    it("treats NaN weight as 0 — valid weight=1 beats invalid weight string", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          work [type=tool]
          path_a [type=tool]
          path_b [type=tool]
          s -> work
          work -> path_a [weight="not_a_number"]
          work -> path_b [weight=1]
          path_a -> e
          path_b -> e
        }
      `);
      const work = graph.nodes.get("work")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, work, outcome, new Context());
      // weight=1 (path_b) must beat NaN-weight (treated as 0) on path_a
      expect(edge?.to).toBe("path_b");
    });

    it("uses lexical tiebreak when both edges have NaN weight (treated as 0)", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          work [type=tool]
          beta [type=tool]
          alpha [type=tool]
          s -> work
          work -> beta  [weight="bad"]
          work -> alpha [weight="also_bad"]
          beta -> e
          alpha -> e
        }
      `);
      const work = graph.nodes.get("work")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, work, outcome, new Context());
      // Both weights are NaN (treated as 0); lexical tiebreak → alpha wins
      expect(edge?.to).toBe("alpha");
    });
  });

  describe("no outgoing edges", () => {
    it("returns null when no edges exist", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e
        }
      `);
      // exit node has no outgoing edges
      const exit = graph.nodes.get("e")!;
      const edge = selectEdge(graph, exit, { status: "success" }, new Context());
      expect(edge).toBeNull();
    });
  });
});
