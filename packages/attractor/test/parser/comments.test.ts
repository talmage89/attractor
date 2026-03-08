import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser.js";

describe("comment handling", () => {
  it("strips line comments between node declarations", () => {
    const src = `
      digraph Pipeline {
        // This is the start node
        start [shape=Mdiamond]
        // This is the exit node
        exit [shape=Msquare]
        start -> exit
      }
    `;
    const graph = parse(src);
    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.has("start")).toBe(true);
    expect(graph.nodes.has("exit")).toBe(true);
  });

  it("strips line comments inline after attribute values", () => {
    const src = `
      digraph Pipeline {
        graph [goal = "Build the thing"] // sets the goal
        start [shape=Mdiamond]
        exit [shape=Msquare, label="Done"] // terminal node
        start -> exit
      }
    `;
    const graph = parse(src);
    expect(graph.attributes.goal).toBe("Build the thing");
    expect(graph.nodes.get("exit")?.label).toBe("Done");
  });

  it("strips line comments inside attribute blocks", () => {
    const src = `
      digraph Pipeline {
        start [
          shape = Mdiamond // diamond = start
        ]
        exit [
          shape = Msquare  // square = exit
        ]
        start -> exit
      }
    `;
    const graph = parse(src);
    expect(graph.nodes.get("start")?.shape).toBe("Mdiamond");
    expect(graph.nodes.get("exit")?.shape).toBe("Msquare");
  });

  it("strips block comments spanning multiple lines", () => {
    const src = `
      digraph Pipeline {
        /* This is the pipeline.
           It runs tests and exits. */
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit /* go straight to exit */
      }
    `;
    const graph = parse(src);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({ from: "start", to: "exit" });
  });

  it("strips block comments between edge declarations", () => {
    const src = `
      digraph Pipeline {
        graph [goal = "test"]
        start [shape=Mdiamond]
        plan [shape=box]
        exit [shape=Msquare]
        /* first hop */ start -> plan
        /* second hop */ plan -> exit
      }
    `;
    const graph = parse(src);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0]).toMatchObject({ from: "start", to: "plan" });
    expect(graph.edges[1]).toMatchObject({ from: "plan", to: "exit" });
  });

  it("handles block comments inside attribute blocks", () => {
    const src = `
      digraph Pipeline {
        start [
          shape = Mdiamond,
          /* label = "ignored", */
          label = "Start"
        ]
        exit [shape=Msquare]
        start -> exit
      }
    `;
    const graph = parse(src);
    // The commented-out attribute is stripped; only label = "Start" remains
    expect(graph.nodes.get("start")?.label).toBe("Start");
  });

  it("handles adjacent line comments with no blank lines", () => {
    const src = `
      digraph Pipeline {
        // comment 1
        // comment 2
        // comment 3
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit
      }
    `;
    const graph = parse(src);
    expect(graph.nodes.size).toBe(2);
  });

  it("handles line comment at end of edge declaration", () => {
    const src = `
      digraph Pipeline {
        start [shape=Mdiamond]
        exit [shape=Msquare]
        start -> exit // default edge
      }
    `;
    const graph = parse(src);
    expect(graph.edges).toHaveLength(1);
  });
});
