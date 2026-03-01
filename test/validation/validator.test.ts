import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser.js";
import { validate, validateOrThrow } from "../../src/validation/validator.js";
import type { Graph, GraphNode, Edge } from "../../src/model/graph.js";

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: id,
    shape: "box",
    type: "",
    prompt: "Do work",
    maxRetries: 0,
    goalGate: false,
    retryTarget: "",
    fallbackRetryTarget: "",
    fidelity: "",
    threadId: "",
    className: "",
    timeout: null,
    llmModel: "",
    llmProvider: "",
    reasoningEffort: "",
    autoStatus: false,
    allowPartial: false,
    raw: new Map(),
    ...overrides,
  };
}

function makeGraph(nodeList: GraphNode[], edgeList: Edge[] = []): Graph {
  return {
    name: "G",
    attributes: {
      goal: "Test",
      label: "",
      modelStylesheet: "",
      defaultMaxRetry: 0,
      retryTarget: "",
      fallbackRetryTarget: "",
      defaultFidelity: "",
      raw: new Map(),
    },
    nodes: new Map(nodeList.map((n) => [n.id, n])),
    edges: edgeList,
  };
}

describe("validation", () => {
  describe("startNodeRule", () => {
    it("passes with exactly one start node", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e
        }
      `);
      const diags = validate(graph);
      expect(diags.filter(d => d.rule === "start_node")).toHaveLength(0);
    });

    it("errors when no start node", () => {
      const graph = parse(`
        digraph G {
          a [shape=box]
          e [shape=Msquare]
          a -> e
        }
      `);
      const diags = validate(graph);
      const startErrors = diags.filter(d => d.rule === "start_node" && d.severity === "error");
      expect(startErrors.length).toBeGreaterThan(0);
    });

    it("accepts id=start as fallback start node", () => {
      const graph = parse(`
        digraph G {
          start [shape=box]
          exit  [shape=Msquare]
          start -> exit
        }
      `);
      // This should NOT error — "start" id is accepted
      const diags = validate(graph);
      const startErrors = diags.filter(d => d.rule === "start_node" && d.severity === "error");
      expect(startErrors).toHaveLength(0);
    });
  });

  describe("terminalNodeRule", () => {
    it("errors when no exit node", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          a [shape=box]
          s -> a
        }
      `);
      const diags = validate(graph);
      const exitErrors = diags.filter(d => d.rule === "terminal_node" && d.severity === "error");
      expect(exitErrors.length).toBeGreaterThan(0);
    });

    it("recognizes a node with type=exit as a terminal node", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("my_exit", { type: "exit" }),
      ], [
        { from: "s", to: "my_exit", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const terminalErrors = diags.filter(d => d.rule === "terminal_node" && d.severity === "error");
      expect(terminalErrors).toHaveLength(0);
    });
  });

  describe("startNoIncomingRule", () => {
    it("errors when start node has incoming edges", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          s -> a -> e
          a -> s
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "start_no_incoming" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
    });
  });

  describe("exitNoOutgoingRule", () => {
    it("errors when exit node has outgoing edges", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          s -> a -> e
          e -> a
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "exit_no_outgoing" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
    });

    it("errors when a second terminal node has outgoing edges", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("a", { prompt: "Do A" }),
        makeNode("e1", { shape: "Msquare" }),
        makeNode("end"),  // recognized as terminal by id
      ], [
        { from: "s", to: "a", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "a", to: "e1", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        // "end" has an outgoing edge — should be caught even though e1 is valid
        { from: "end", to: "a", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "exit_no_outgoing" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
      expect(rule.some(d => d.nodeId === "end")).toBe(true);
    });

    it("errors when a type=exit node has outgoing edges", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("a", { prompt: "Do A" }),
        makeNode("my_exit", { type: "exit" }),
      ], [
        { from: "s", to: "a", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "a", to: "my_exit", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "my_exit", to: "a", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "exit_no_outgoing" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
      expect(rule[0].nodeId).toBe("my_exit");
    });
  });

  describe("reachabilityRule", () => {
    it("errors on unreachable nodes", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          orphan [shape=box, label="Orphan"]
          s -> e
        }
      `);
      const diags = validate(graph);
      const reach = diags.filter(d => d.rule === "reachability" && d.severity === "error");
      expect(reach.length).toBeGreaterThan(0);
      expect(reach[0].nodeId).toBe("orphan");
    });

    it("passes when all nodes reachable", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          a [shape=box]
          e [shape=Msquare]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const reach = diags.filter(d => d.rule === "reachability");
      expect(reach).toHaveLength(0);
    });
  });

  describe("edgeTargetExistsRule", () => {
    // Hard to trigger with the parser since it creates implicit nodes.
    // This rule protects against programmatic graph construction.
    it("catches edges to nonexistent nodes in manually constructed graphs", () => {
      // Construct a graph manually with a bad edge
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e
        }
      `);
      // Add a bad edge manually
      graph.edges.push({ from: "s", to: "nonexistent", label: "", condition: "", weight: 0, fidelity: "", threadId: "", loopRestart: false });
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "edge_target_exists");
      expect(rule.length).toBeGreaterThan(0);
    });
  });

  describe("typeKnownRule", () => {
    it("warns on unknown type", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [type="unknown_type"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "type_known" && d.severity === "warning");
      expect(rule.length).toBeGreaterThan(0);
    });

    it("does not warn on known types", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [type="wait.human"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "type_known");
      expect(rule).toHaveLength(0);
    });

    it("does not warn on parallel types with dots/underscores", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [type="parallel"]
          b [type="parallel.fan_in"]
          s -> a -> b -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "type_known");
      expect(rule).toHaveLength(0);
    });

    it("does not warn on stack.manager_loop (registered as stub handler)", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [type="stack.manager_loop"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "type_known" && d.nodeId === "a");
      expect(rule).toHaveLength(0);
    });
  });

  describe("fidelityValidRule", () => {
    it("warns on invalid fidelity mode", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [fidelity="invalid"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "fidelity_valid");
      expect(rule.length).toBeGreaterThan(0);
    });

    it("warns on invalid edge fidelity mode", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e [fidelity="typo"]
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "fidelity_valid");
      expect(rule.length).toBeGreaterThan(0);
      expect(rule[0].edge).toEqual({ from: "s", to: "e" });
    });

    it("does not warn on valid edge fidelity mode", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e [fidelity="compact"]
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "fidelity_valid");
      expect(rule).toHaveLength(0);
    });

    it("warns on invalid graph default_fidelity", () => {
      const graph = parse(`
        digraph G {
          graph [default_fidelity="bad_mode"]
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "fidelity_valid");
      expect(rule.length).toBeGreaterThan(0);
      expect(rule[0].message).toContain("default_fidelity");
    });

    it("does not warn on valid graph default_fidelity", () => {
      const graph = parse(`
        digraph G {
          graph [default_fidelity="full"]
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "fidelity_valid");
      expect(rule).toHaveLength(0);
    });
  });

  describe("goalGateHasRetryRule", () => {
    it("warns when goal gate node has no retry target", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [goal_gate=true]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "goal_gate_has_retry" && d.severity === "warning");
      expect(rule.length).toBeGreaterThan(0);
    });

    it("does not warn when graph has retry_target", () => {
      const graph = parse(`
        digraph G {
          graph [retry_target="a"]
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [goal_gate=true]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "goal_gate_has_retry");
      expect(rule).toHaveLength(0);
    });
  });

  describe("promptOnLlmNodesRule", () => {
    it("warns when a box node has no explicit prompt or label", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "prompt_on_llm_nodes");
      // "a" has no explicit prompt and no explicit label — warning should fire.
      expect(rule).toHaveLength(1);
      expect(rule[0].nodeId).toBe("a");
    });

    it("does not warn when a box node has an explicit label", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box, label="Do the thing"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "prompt_on_llm_nodes");
      expect(rule).toHaveLength(0);
    });

    it("does not warn when a box node has an explicit prompt", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box, prompt="Do the thing"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "prompt_on_llm_nodes");
      expect(rule).toHaveLength(0);
    });
  });

  describe("nodeIdSafeRule", () => {
    it("errors on node id containing path traversal with '..'", () => {
      // Build graph directly — parser doesn't accept quoted strings in edge positions
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("../../evil", { prompt: "Escape" }),
        makeNode("e", { shape: "Msquare" }),
      ], [
        { from: "s", to: "../../evil", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "../../evil", to: "e", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "node_id_safe" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
      expect(rule[0].message).toContain("../../evil");
    });

    it("errors on node id containing a forward slash", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("a/b", { prompt: "Slash" }),
        makeNode("e", { shape: "Msquare" }),
      ], [
        { from: "s", to: "a/b", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "a/b", to: "e", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "node_id_safe" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
    });

    it("errors on node id that is '..'", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("..", { prompt: "Parent dir" }),
        makeNode("e", { shape: "Msquare" }),
      ], [
        { from: "s", to: "..", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "..", to: "e", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "node_id_safe" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
    });

    it("does not error on normal node ids", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          my_node_1 [shape=box, prompt="Normal"]
          s -> my_node_1 -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "node_id_safe");
      expect(rule).toHaveLength(0);
    });
  });

  describe("conditionSyntaxRule", () => {
    it("does not flag edges with no condition", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("a", { prompt: "Do A" }),
        makeNode("e", { shape: "Msquare" }),
      ], [
        { from: "s", to: "a", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "a", to: "e", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "condition_syntax");
      expect(rule).toHaveLength(0);
    });

    it("does not flag a valid condition string", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("a", { prompt: "Do A" }),
        makeNode("e", { shape: "Msquare" }),
      ], [
        { from: "s", to: "a", label: "", condition: "outcome=success", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "a", to: "e", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "condition_syntax");
      expect(rule).toHaveLength(0);
    });

    it("produces an error diagnostic for a syntactically invalid condition", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("a", { prompt: "Do A" }),
        makeNode("e", { shape: "Msquare" }),
      ], [
        { from: "s", to: "a", label: "", condition: "=success", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "a", to: "e", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "condition_syntax");
      expect(rule).toHaveLength(1);
      expect(rule[0].severity).toBe("error");
      expect(rule[0].edge).toEqual({ from: "s", to: "a" });
    });
  });

  describe("stylesheetSyntaxRule", () => {
    it("does not flag a valid stylesheet", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("e", { shape: "Msquare" }),
      ]);
      graph.attributes.modelStylesheet = "* { llm_model: claude-3 }";
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "stylesheet_syntax");
      expect(rule).toHaveLength(0);
    });

    it("produces an error diagnostic for a syntactically invalid stylesheet", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("e", { shape: "Msquare" }),
      ]);
      graph.attributes.modelStylesheet = "invalid syntax";
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "stylesheet_syntax");
      expect(rule).toHaveLength(1);
      expect(rule[0].severity).toBe("error");
    });
  });

  describe("retryTargetExistsRule", () => {
    it("does not flag a node whose retry_target references an existing node", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("a", { prompt: "Do A", retryTarget: "s" }),
        makeNode("e", { shape: "Msquare" }),
      ], [
        { from: "s", to: "a", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "a", to: "e", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "retry_target_exists");
      expect(rule).toHaveLength(0);
    });

    it("produces a warning diagnostic for a retry_target that references a nonexistent node", () => {
      const graph = makeGraph([
        makeNode("s", { shape: "Mdiamond" }),
        makeNode("a", { prompt: "Do A", retryTarget: "nonexistent" }),
        makeNode("e", { shape: "Msquare" }),
      ], [
        { from: "s", to: "a", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
        { from: "a", to: "e", label: "", condition: "", weight: 1, fidelity: "", threadId: "", loopRestart: false },
      ]);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "retry_target_exists");
      expect(rule).toHaveLength(1);
      expect(rule[0].severity).toBe("warning");
      expect(rule[0].nodeId).toBe("a");
    });
  });

  describe("validateOrThrow", () => {
    it("throws on error-severity diagnostics", () => {
      const graph = parse(`
        digraph G {
          a [shape=box]
          b [shape=box]
          a -> b
        }
      `);
      // No start or exit node
      expect(() => validateOrThrow(graph)).toThrow(/Validation failed/);
    });

    it("returns warnings without throwing", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [type="weird"]
          s -> a -> e
        }
      `);
      const warnings = validateOrThrow(graph);
      expect(warnings.some(d => d.severity === "warning")).toBe(true);
    });
  });

  describe("valid pipelines pass cleanly", () => {
    it("three-node linear pipeline has no errors", () => {
      const graph = parse(`
        digraph G {
          graph [goal="Test"]
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box, prompt="Do something"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const errors = diags.filter(d => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("branching pipeline with conditions has no errors", () => {
      const graph = parse(`
        digraph G {
          graph [goal="Test"]
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box, prompt="Do A"]
          b [shape=box, prompt="Do B"]
          gate [shape=diamond]
          s -> a -> gate
          gate -> b [condition="outcome=success"]
          gate -> a [condition="outcome=fail"]
          b -> e
        }
      `);
      const diags = validate(graph);
      const errors = diags.filter(d => d.severity === "error");
      expect(errors).toHaveLength(0);
    });
  });
});
