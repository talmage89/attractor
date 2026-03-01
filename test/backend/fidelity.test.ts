import { describe, it, expect } from "vitest";
import { resolveFidelity, resolveThreadId } from "../../src/model/fidelity.js";
import { generatePreamble } from "../../src/backend/preamble.js";
import { Context } from "../../src/model/context.js";
import type { Graph, GraphNode, Edge, Outcome } from "../../src/model/graph.js";

// Helper to create minimal node/graph for testing
function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "test", label: "Test", shape: "box", type: "", prompt: "",
    maxRetries: 0, goalGate: false, retryTarget: "", fallbackRetryTarget: "",
    fidelity: "", threadId: "", className: "", timeout: null,
    llmModel: "", llmProvider: "", reasoningEffort: "high",
    autoStatus: false, allowPartial: false, raw: new Map(),
    ...overrides,
  };
}

function makeGraph(overrides: Partial<Graph["attributes"]> = {}): Graph {
  return {
    name: "Test",
    attributes: {
      goal: "Test goal", label: "", modelStylesheet: "",
      defaultMaxRetry: 50, retryTarget: "", fallbackRetryTarget: "",
      defaultFidelity: "", raw: new Map(),
      ...overrides,
    },
    nodes: new Map(),
    edges: [],
  };
}

describe("resolveFidelity", () => {
  it("returns edge fidelity when set", () => {
    const node = makeNode();
    const graph = makeGraph();
    const edge: Edge = {
      from: "a", to: "test", label: "", condition: "",
      weight: 0, fidelity: "full", threadId: "", loopRestart: false,
    };
    expect(resolveFidelity(node, graph, edge)).toBe("full");
  });

  it("returns node fidelity when edge has none", () => {
    const node = makeNode({ fidelity: "truncate" });
    const graph = makeGraph();
    expect(resolveFidelity(node, graph)).toBe("truncate");
  });

  it("returns graph default when node has none", () => {
    const node = makeNode();
    const graph = makeGraph({ defaultFidelity: "summary:high" });
    expect(resolveFidelity(node, graph)).toBe("summary:high");
  });

  it("defaults to compact", () => {
    const node = makeNode();
    const graph = makeGraph();
    expect(resolveFidelity(node, graph)).toBe("compact");
  });
});

describe("resolveThreadId", () => {
  it("returns node threadId when set", () => {
    const node = makeNode({ threadId: "my-thread" });
    const graph = makeGraph();
    expect(resolveThreadId(node, graph)).toBe("my-thread");
  });

  it("returns edge threadId when node has none", () => {
    const node = makeNode();
    const graph = makeGraph();
    const edge: Edge = {
      from: "a", to: "test", label: "", condition: "",
      weight: 0, fidelity: "", threadId: "edge-thread", loopRestart: false,
    };
    expect(resolveThreadId(node, graph, edge)).toBe("edge-thread");
  });

  it("edge threadId takes priority over node threadId", () => {
    const node = makeNode({ threadId: "node-thread" });
    const graph = makeGraph();
    const edge: Edge = {
      from: "a", to: "test", label: "", condition: "",
      weight: 0, fidelity: "", threadId: "edge-thread", loopRestart: false,
    };
    expect(resolveThreadId(node, graph, edge)).toBe("edge-thread");
  });

  it("derives from className when no explicit thread", () => {
    const node = makeNode({ className: "main-loop,other" });
    const graph = makeGraph();
    expect(resolveThreadId(node, graph)).toBe("main-loop");
  });

  it("falls back to previous node ID", () => {
    const node = makeNode({ id: "current" });
    const graph = makeGraph();
    expect(resolveThreadId(node, graph, undefined, "previous")).toBe("previous");
  });

  it("falls back to own ID as last resort", () => {
    const node = makeNode({ id: "self" });
    const graph = makeGraph();
    expect(resolveThreadId(node, graph)).toBe("self");
  });
});

describe("generatePreamble", () => {
  it("truncate mode produces minimal output", () => {
    const ctx = new Context();
    const graph = makeGraph({ goal: "Build feature" });
    const preamble = generatePreamble("truncate", ctx, graph, [], new Map());
    expect(preamble).toContain("Build feature");
    expect(preamble.length).toBeLessThan(200);
  });

  it("compact mode includes completed stages", () => {
    const ctx = new Context();
    ctx.set("graph.goal", "Build feature");
    const graph = makeGraph({ goal: "Build feature" });
    graph.nodes.set("plan", makeNode({ id: "plan" }));
    graph.nodes.set("implement", makeNode({ id: "implement" }));
    const outcomes = new Map<string, Outcome>([
      ["plan", { status: "success", notes: "Plan created" }],
    ]);
    const preamble = generatePreamble("compact", ctx, graph, ["plan"], outcomes);
    expect(preamble).toContain("Build feature");
    expect(preamble).toContain("plan");
    expect(preamble).toContain("success");
  });

  it("summary:low produces brief output", () => {
    const ctx = new Context();
    const graph = makeGraph({ goal: "Test" });
    const preamble = generatePreamble("summary:low", ctx, graph, ["a", "b"], new Map());
    expect(preamble.length).toBeLessThan(800);
  });

  it("filters __ prefixed keys from context sections", () => {
    const ctx = new Context();
    ctx.set("visible.key", "shown");
    ctx.set("__completedNodes", '["plan"]');
    ctx.set("__nodeOutcomes", '[["plan",{"status":"success"}]]');
    const graph = makeGraph({ goal: "Test" });
    for (const mode of ["compact", "summary:medium", "summary:high"] as const) {
      const preamble = generatePreamble(mode, ctx, graph, [], new Map());
      expect(preamble).toContain("visible.key");
      expect(preamble).not.toContain("__completedNodes");
      expect(preamble).not.toContain("__nodeOutcomes");
    }
  });

  it("summary:high produces detailed output", () => {
    const ctx = new Context();
    ctx.set("key1", "value1");
    ctx.set("key2", "value2");
    const graph = makeGraph({ goal: "Test" });
    const outcomes = new Map<string, Outcome>([
      ["a", { status: "success", notes: "Did A" }],
      ["b", { status: "fail", notes: "B failed", failureReason: "timeout" }],
    ]);
    const preamble = generatePreamble("summary:high", ctx, graph, ["a", "b"], outcomes);
    expect(preamble).toContain("value1");
    expect(preamble).toContain("B failed");
    expect(preamble.length).toBeGreaterThan(200);
  });
});
