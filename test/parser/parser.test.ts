import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser";
import * as fixtures from "./fixtures";

describe("parser", () => {
  describe("minimal graphs", () => {
    it("parses a minimal linear pipeline", () => {
      const graph = parse(fixtures.MINIMAL_LINEAR);
      expect(graph.name).toBe("Simple");
      expect(graph.nodes.size).toBe(2);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ from: "start", to: "exit" });
    });

    it("resolves start and exit nodes", () => {
      const graph = parse(fixtures.MINIMAL_LINEAR);
      const start = graph.nodes.get("start");
      const exit = graph.nodes.get("exit");
      expect(start?.shape).toBe("Mdiamond");
      expect(exit?.shape).toBe("Msquare");
    });
  });

  describe("three-node linear", () => {
    it("parses graph-level attributes", () => {
      const graph = parse(fixtures.THREE_NODE_LINEAR);
      expect(graph.attributes.goal).toBe("Run tests");
    });

    it("expands chained edges", () => {
      const graph = parse(fixtures.THREE_NODE_LINEAR);
      // start -> run_tests -> exit becomes two edges
      expect(graph.edges).toHaveLength(2);
      expect(graph.edges[0]).toMatchObject({ from: "start", to: "run_tests" });
      expect(graph.edges[1]).toMatchObject({ from: "run_tests", to: "exit" });
    });

    it("parses node labels and prompts", () => {
      const graph = parse(fixtures.THREE_NODE_LINEAR);
      const runTests = graph.nodes.get("run_tests");
      expect(runTests?.label).toBe("Run Tests");
      expect(runTests?.prompt).toBe("Run the test suite");
    });

    it("handles top-level key=value graph attributes", () => {
      const graph = parse(fixtures.THREE_NODE_LINEAR);
      // rankdir=LR is a graph attribute
      expect(graph.attributes.raw.get("rankdir")).toBe("LR");
    });
  });

  describe("branching", () => {
    it("parses node defaults", () => {
      const graph = parse(fixtures.BRANCHING);
      // node [shape=box, timeout="900s"] applies to plan, implement
      const plan = graph.nodes.get("plan");
      expect(plan?.shape).toBe("box");
      expect(plan?.timeout).toBe(900000); // 900s in ms
    });

    it("parses edge conditions", () => {
      const graph = parse(fixtures.BRANCHING);
      const yesEdge = graph.edges.find(e => e.label === "Yes");
      expect(yesEdge?.condition).toBe("outcome=success");
    });

    it("parses conditional node shape", () => {
      const graph = parse(fixtures.BRANCHING);
      const gate = graph.nodes.get("gate");
      expect(gate?.shape).toBe("diamond");
    });
  });

  describe("human gate", () => {
    it("creates implicit nodes from edges", () => {
      const graph = parse(fixtures.WITH_HUMAN_GATE);
      // ship_it and fixes are referenced in edges but not explicitly declared
      expect(graph.nodes.has("ship_it")).toBe(true);
      expect(graph.nodes.has("fixes")).toBe(true);
    });

    it("parses hexagon shape", () => {
      const graph = parse(fixtures.WITH_HUMAN_GATE);
      expect(graph.nodes.get("review_gate")?.shape).toBe("hexagon");
    });
  });

  describe("full attributes", () => {
    it("parses multi-line attribute blocks", () => {
      const graph = parse(fixtures.WITH_ATTRIBUTES);
      const plan = graph.nodes.get("plan");
      expect(plan?.maxRetries).toBe(2);
      expect(plan?.goalGate).toBe(true);
      expect(plan?.timeout).toBe(900000); // 15m in ms
      expect(plan?.reasoningEffort).toBe("high");
      expect(plan?.className).toBe("planning,critical");
    });

    it("parses graph-level model stylesheet", () => {
      const graph = parse(fixtures.WITH_ATTRIBUTES);
      expect(graph.attributes.modelStylesheet).toBe(
        "* { llm_model: claude-sonnet-4-5; }"
      );
    });

    it("parses default_max_retry as number", () => {
      const graph = parse(fixtures.WITH_ATTRIBUTES);
      expect(graph.attributes.defaultMaxRetry).toBe(3);
    });
  });

  describe("subgraphs", () => {
    it("applies subgraph node defaults", () => {
      const graph = parse(fixtures.WITH_SUBGRAPH);
      const plan = graph.nodes.get("plan");
      expect(plan?.threadId).toBe("main-loop");
      expect(plan?.timeout).toBe(900000);
    });

    it("allows explicit node attrs to override subgraph defaults", () => {
      const graph = parse(fixtures.WITH_SUBGRAPH);
      const implement = graph.nodes.get("implement");
      expect(implement?.threadId).toBe("main-loop");   // inherited
      expect(implement?.timeout).toBe(1800000);         // overridden (1800s)
    });

    it("derives class names from subgraph labels", () => {
      const graph = parse(fixtures.WITH_SUBGRAPH);
      const plan = graph.nodes.get("plan");
      // label "Main Loop" → class "main-loop"
      expect(plan?.className).toContain("main-loop");
    });
  });

  describe("comments", () => {
    it("strips all comment types", () => {
      const graph = parse(fixtures.WITH_COMMENTS);
      expect(graph.name).toBe("Commented");
      expect(graph.nodes.size).toBe(2);
      expect(graph.edges).toHaveLength(1);
    });
  });

  describe("parallel", () => {
    it("parses component and tripleoctagon shapes", () => {
      const graph = parse(fixtures.PARALLEL);
      expect(graph.nodes.get("fan_out")?.shape).toBe("component");
      expect(graph.nodes.get("fan_in")?.shape).toBe("tripleoctagon");
    });

    it("produces correct edge structure for fan-out", () => {
      const graph = parse(fixtures.PARALLEL);
      const fanOutEdges = graph.edges.filter(e => e.from === "fan_out");
      expect(fanOutEdges).toHaveLength(2);
      expect(fanOutEdges.map(e => e.to).sort()).toEqual(["branch_a", "branch_b"]);
    });
  });

  describe("edge weights", () => {
    it("parses weight as number", () => {
      const graph = parse(fixtures.EDGE_WEIGHTS);
      const toB = graph.edges.find(e => e.from === "node_a" && e.to === "node_b");
      const toC = graph.edges.find(e => e.from === "node_a" && e.to === "node_c");
      expect(toB?.weight).toBe(10);
      expect(toC?.weight).toBe(5);
    });
  });

  describe("graph query helpers", () => {
    it("outgoingEdges returns correct edges", async () => {
      const { outgoingEdges } = await import("../../src/model/graph");
      const graph = parse(fixtures.BRANCHING);
      const gateEdges = outgoingEdges(graph, "gate");
      expect(gateEdges).toHaveLength(2);
    });

    it("findStartNode finds Mdiamond", async () => {
      const { findStartNode } = await import("../../src/model/graph");
      const graph = parse(fixtures.MINIMAL_LINEAR);
      expect(findStartNode(graph)?.id).toBe("start");
    });

    it("findExitNode finds Msquare", async () => {
      const { findExitNode } = await import("../../src/model/graph");
      const graph = parse(fixtures.MINIMAL_LINEAR);
      expect(findExitNode(graph)?.id).toBe("exit");
    });

    it("isTerminal identifies exit nodes", async () => {
      const { isTerminal } = await import("../../src/model/graph");
      const graph = parse(fixtures.MINIMAL_LINEAR);
      expect(isTerminal(graph.nodes.get("exit")!)).toBe(true);
      expect(isTerminal(graph.nodes.get("start")!)).toBe(false);
    });

    it("reachableFrom returns all reachable nodes", async () => {
      const { reachableFrom } = await import("../../src/model/graph");
      const graph = parse(fixtures.BRANCHING);
      const reachable = reachableFrom(graph, "start");
      expect(reachable.has("plan")).toBe(true);
      expect(reachable.has("implement")).toBe(true);
      expect(reachable.has("gate")).toBe(true);
      expect(reachable.has("exit")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("rejects undirected graphs", () => {
      expect(() => parse(fixtures.INVALID_UNDIRECTED)).toThrow(/digraph/i);
    });

    it("rejects missing digraph keyword", () => {
      expect(() => parse(fixtures.INVALID_NO_DIGRAPH)).toThrow();
    });

    it("rejects unclosed strings", () => {
      expect(() => parse(fixtures.INVALID_UNCLOSED_STRING)).toThrow(/string/i);
    });
  });

  describe("duration parsing", () => {
    it("converts duration strings to milliseconds for timeout", () => {
      const graph = parse(`
        digraph D {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          a [timeout="250ms"]
          b [timeout="10s"]
          c [timeout="5m"]
          d [timeout="2h"]
          e [timeout="1d"]
          start -> a -> b -> c -> d -> e -> exit
        }
      `);
      expect(graph.nodes.get("a")?.timeout).toBe(250);
      expect(graph.nodes.get("b")?.timeout).toBe(10000);
      expect(graph.nodes.get("c")?.timeout).toBe(300000);
      expect(graph.nodes.get("d")?.timeout).toBe(7200000);
      expect(graph.nodes.get("e")?.timeout).toBe(86400000);
    });

    it("returns null for invalid timeout strings instead of NaN", () => {
      const graph = parse(`
        digraph D {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          a [timeout="notaduration"]
          b [timeout="abc123"]
          start -> a -> b -> exit
        }
      `);
      expect(graph.nodes.get("a")?.timeout).toBeNull();
      expect(graph.nodes.get("b")?.timeout).toBeNull();
    });
  });
});
