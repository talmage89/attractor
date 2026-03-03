import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser.js";
import { findExitNode, findStartNode, isTerminal } from "../../src/model/graph.js";

describe("findExitNode", () => {
  it("finds node with shape=Msquare", () => {
    const graph = parse(`digraph G { e [shape=Msquare] }`);
    const node = findExitNode(graph);
    expect(node?.id).toBe("e");
  });

  it("finds node with id=exit when no Msquare", () => {
    const graph = parse(`digraph G { exit [shape=box] }`);
    const node = findExitNode(graph);
    expect(node?.id).toBe("exit");
  });

  it("finds node with id=end when no Msquare or id=exit", () => {
    const graph = parse(`digraph G { end [shape=box] }`);
    const node = findExitNode(graph);
    expect(node?.id).toBe("end");
  });

  it("finds node with type=exit when no Msquare and non-standard id", () => {
    const graph = parse(`digraph G { done [type="exit"] }`);
    const node = findExitNode(graph);
    expect(node?.id).toBe("done");
  });

  it("returns null when no terminal node", () => {
    const graph = parse(`digraph G { a [shape=box] }`);
    const node = findExitNode(graph);
    expect(node).toBeNull();
  });
});

describe("findStartNode", () => {
  it("finds node with shape=Mdiamond", () => {
    const graph = parse(`digraph G { s [shape=Mdiamond] }`);
    const node = findStartNode(graph);
    expect(node?.id).toBe("s");
  });

  it("finds node with id=start when no Mdiamond", () => {
    const graph = parse(`digraph G { start [shape=box] }`);
    const node = findStartNode(graph);
    expect(node?.id).toBe("start");
  });

  it("returns null when no start node", () => {
    const graph = parse(`digraph G { a [shape=box] }`);
    const node = findStartNode(graph);
    expect(node).toBeNull();
  });
});

describe("isTerminal", () => {
  it("returns true for shape=Msquare", () => {
    const graph = parse(`digraph G { e [shape=Msquare] }`);
    const node = graph.nodes.get("e")!;
    expect(isTerminal(node)).toBe(true);
  });

  it("returns true for type=exit", () => {
    const graph = parse(`digraph G { done [type="exit"] }`);
    const node = graph.nodes.get("done")!;
    expect(isTerminal(node)).toBe(true);
  });

  it("returns true for id=exit", () => {
    const graph = parse(`digraph G { exit [shape=box] }`);
    const node = graph.nodes.get("exit")!;
    expect(isTerminal(node)).toBe(true);
  });

  it("returns true for id=end", () => {
    const graph = parse(`digraph G { end [shape=box] }`);
    const node = graph.nodes.get("end")!;
    expect(isTerminal(node)).toBe(true);
  });

  it("returns false for regular node", () => {
    const graph = parse(`digraph G { a [shape=box] }`);
    const node = graph.nodes.get("a")!;
    expect(isTerminal(node)).toBe(false);
  });

  it("findExitNode and isTerminal agree on type=exit node", () => {
    const graph = parse(`digraph G { done [type="exit"] }`);
    const node = graph.nodes.get("done")!;
    expect(isTerminal(node)).toBe(true);
    expect(findExitNode(graph)?.id).toBe("done");
  });
});
