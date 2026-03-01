import { describe, it, expect } from "vitest";
import { WaitForHumanHandler, parseAcceleratorKey } from "../../src/handlers/wait-human.js";
import { QueueInterviewer } from "../../src/interviewer/queue.js";
import { parse } from "../../src/parser/parser.js";
import { Context } from "../../src/model/context.js";

describe("parseAcceleratorKey", () => {
  it("extracts bracket key: [A] Approve", () => {
    expect(parseAcceleratorKey("[A] Approve")).toBe("A");
  });

  it("extracts paren key: Y) Yes", () => {
    expect(parseAcceleratorKey("Y) Yes")).toBe("Y");
  });

  it("extracts dash key: N - No", () => {
    expect(parseAcceleratorKey("N - No")).toBe("N");
  });

  it("falls back to first character uppercased", () => {
    expect(parseAcceleratorKey("approve")).toBe("A");
  });

  it("handles single character", () => {
    expect(parseAcceleratorKey("x")).toBe("X");
  });
});

describe("WaitForHumanHandler", () => {
  function makeGraph(dotSource: string) {
    return parse(dotSource);
  }

  it("routes based on human selection by key", async () => {
    const graph = makeGraph(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        gate [shape=hexagon, label="Choose direction"]
        left  [shape=box, prompt="Go left"]
        right [shape=box, prompt="Go right"]
        s -> gate
        gate -> left  [label="[L] Left"]
        gate -> right [label="[R] Right"]
        left -> e
        right -> e
      }
    `);

    const interviewer = new QueueInterviewer([{ value: "R" }]);
    const handler = new WaitForHumanHandler(interviewer);
    const gate = graph.nodes.get("gate")!;

    const outcome = await handler.execute(gate, new Context(), graph, {} as any);
    expect(outcome.status).toBe("success");
    expect(outcome.suggestedNextIds).toContain("right");
  });

  it("routes based on human selection by label", async () => {
    const graph = makeGraph(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        gate [shape=hexagon]
        approve [shape=box]
        reject  [shape=box]
        s -> gate
        gate -> approve [label="Approve"]
        gate -> reject  [label="Reject"]
        approve -> e
        reject -> e
      }
    `);

    const interviewer = new QueueInterviewer([{ value: "Reject" }]);
    const handler = new WaitForHumanHandler(interviewer);
    const gate = graph.nodes.get("gate")!;

    const outcome = await handler.execute(gate, new Context(), graph, {} as any);
    expect(outcome.status).toBe("success");
    expect(outcome.suggestedNextIds).toContain("reject");
  });

  it("case-insensitive matching", async () => {
    const graph = makeGraph(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        gate [shape=hexagon]
        yes [shape=box]
        no  [shape=box]
        s -> gate
        gate -> yes [label="[Y] Yes"]
        gate -> no  [label="[N] No"]
        yes -> e
        no -> e
      }
    `);

    const interviewer = new QueueInterviewer([{ value: "y" }]);
    const handler = new WaitForHumanHandler(interviewer);
    const outcome = await handler.execute(graph.nodes.get("gate")!, new Context(), graph, {} as any);
    expect(outcome.suggestedNextIds).toContain("yes");
  });

  it("fails with no outgoing edges", async () => {
    const graph = makeGraph(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        gate [shape=hexagon]
        s -> gate -> e
      }
    `);
    // Remove edges from gate manually for this test
    const gateNode = { ...graph.nodes.get("gate")!, id: "isolated" } as any;
    const emptyGraph = { ...graph, edges: [] };

    const interviewer = new QueueInterviewer([]);
    const handler = new WaitForHumanHandler(interviewer);
    const outcome = await handler.execute(gateNode, new Context(), emptyGraph, {} as any);
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("No outgoing edges");
  });

  it("uses default choice on SKIPPED answer", async () => {
    const graph = makeGraph(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        gate [shape=hexagon, "human.default_choice"="fallback"]
        fallback [shape=box]
        other    [shape=box]
        s -> gate
        gate -> fallback [label="Fallback"]
        gate -> other    [label="Other"]
        fallback -> e
        other -> e
      }
    `);

    // Queue is empty, so interviewer returns SKIPPED
    const interviewer = new QueueInterviewer([]);
    const handler = new WaitForHumanHandler(interviewer);
    const gate = graph.nodes.get("gate")!;
    const outcome = await handler.execute(gate, new Context(), graph, {} as any);
    expect(outcome.status).toBe("success");
    expect(outcome.suggestedNextIds).toContain("fallback");
  });

  it("populates context updates with selection", async () => {
    const graph = makeGraph(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        gate [shape=hexagon]
        a [shape=box]
        s -> gate
        gate -> a [label="[A] Accept"]
        a -> e
      }
    `);

    const interviewer = new QueueInterviewer([{ value: "A" }]);
    const handler = new WaitForHumanHandler(interviewer);
    const outcome = await handler.execute(graph.nodes.get("gate")!, new Context(), graph, {} as any);
    expect(outcome.contextUpdates?.["human.gate.selected"]).toBe("A");
    expect(outcome.contextUpdates?.["human.gate.label"]).toContain("Accept");
  });
});
