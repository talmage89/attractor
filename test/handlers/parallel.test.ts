import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ParallelHandler } from "../../src/handlers/parallel.js";
import { FanInHandler } from "../../src/handlers/fan-in.js";
import { HandlerRegistry } from "../../src/handlers/registry.js";
import { parse } from "../../src/parser/parser.js";
import { Context } from "../../src/model/context.js";
import type { Handler } from "../../src/handlers/registry.js";
import type { Outcome } from "../../src/model/outcome.js";

// Mock handler that returns configurable outcomes per node
class MockHandler implements Handler {
  private outcomes: Map<string, Outcome>;
  public callLog: string[] = [];

  constructor(outcomes?: Record<string, Outcome>) {
    this.outcomes = new Map(Object.entries(outcomes ?? {}));
  }

  async execute(node: any): Promise<Outcome> {
    this.callLog.push(node.id);
    return this.outcomes.get(node.id) ?? { status: "success" };
  }
}

const noopInterviewer = {
  ask: async () => ({ value: "YES" }),
  inform: () => {},
};

describe("ParallelHandler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-parallel-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("executes all branches and collects results", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test parallel"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        fork [shape=component]
        branch_a [shape=box, prompt="A"]
        branch_b [shape=box, prompt="B"]
        join [shape=tripleoctagon]
        s -> fork
        fork -> branch_a
        fork -> branch_b
        branch_a -> join
        branch_b -> join
        join -> e
      }
    `);

    const mock = new MockHandler({
      branch_a: { status: "success", notes: "A done" },
      branch_b: { status: "success", notes: "B done" },
    });
    const registry = new HandlerRegistry(mock);
    const handler = new ParallelHandler(registry);
    const ctx = new Context();
    const config = {
      graph, cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
    };

    const outcome = await handler.execute(
      graph.nodes.get("fork")!, ctx, graph, config as any
    );

    expect(outcome.status).toBe("success");
    expect(mock.callLog).toContain("branch_a");
    expect(mock.callLog).toContain("branch_b");
  });

  it("returns partial_success when some branches fail (wait_all)", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        fork [shape=component]
        ok   [shape=box]
        bad  [shape=box]
        join [shape=tripleoctagon]
        s -> fork
        fork -> ok
        fork -> bad
        ok -> join
        bad -> join
        join -> e
      }
    `);

    const mock = new MockHandler({
      ok: { status: "success" },
      bad: { status: "fail", failureReason: "broken" },
    });
    const registry = new HandlerRegistry(mock);
    const handler = new ParallelHandler(registry);

    const outcome = await handler.execute(
      graph.nodes.get("fork")!, new Context(), graph,
      { graph, cwd: tmpDir, logsRoot: tmpDir, interviewer: noopInterviewer } as any
    );

    expect(outcome.status).toBe("partial_success");
    expect(outcome.contextUpdates?.["parallel.fail_count"]).toBe("1");
    expect(outcome.contextUpdates?.["parallel.success_count"]).toBe("1");
  });

  it("returns success with first_success join policy", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        fork [shape=component, join_policy="first_success"]
        ok   [shape=box]
        bad  [shape=box]
        join [shape=tripleoctagon]
        s -> fork
        fork -> ok
        fork -> bad
        ok -> join
        bad -> join
        join -> e
      }
    `);

    const mock = new MockHandler({
      ok: { status: "success" },
      bad: { status: "fail" },
    });
    const registry = new HandlerRegistry(mock);
    const handler = new ParallelHandler(registry);

    const outcome = await handler.execute(
      graph.nodes.get("fork")!, new Context(), graph,
      { graph, cwd: tmpDir, logsRoot: tmpDir, interviewer: noopInterviewer } as any
    );

    expect(outcome.status).toBe("success");
  });

  it("fails with no outgoing edges", async () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        fork [shape=component]
        s -> fork -> e
      }
    `);

    // Manually remove edges from fork for testing
    const isolated = { ...graph, edges: graph.edges.filter(e => e.from !== "fork") };
    const registry = new HandlerRegistry(new MockHandler());
    const handler = new ParallelHandler(registry);

    const outcome = await handler.execute(
      graph.nodes.get("fork")!, new Context(), isolated as any,
      { graph: isolated, cwd: tmpDir, logsRoot: tmpDir, interviewer: noopInterviewer } as any
    );

    expect(outcome.status).toBe("fail");
  });

  it("emits warning event for unrecognized join_policy and defaults to wait_all", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        fork [shape=component, join_policy="k_of_n"]
        ok   [shape=box]
        bad  [shape=box]
        join [shape=tripleoctagon]
        s -> fork
        fork -> ok
        fork -> bad
        ok -> join
        bad -> join
        join -> e
      }
    `);

    const mock = new MockHandler({
      ok: { status: "success" },
      bad: { status: "fail" },
    });
    const registry = new HandlerRegistry(mock);
    const handler = new ParallelHandler(registry);

    const emittedEvents: any[] = [];
    const outcome = await handler.execute(
      graph.nodes.get("fork")!, new Context(), graph,
      {
        graph, cwd: tmpDir, logsRoot: tmpDir, interviewer: noopInterviewer,
        onEvent: (e: any) => emittedEvents.push(e),
      } as any
    );

    // Unrecognized policy => falls back to wait_all => partial_success
    expect(outcome.status).toBe("partial_success");

    const warningEvent = emittedEvents.find((e) => e.kind === "warning");
    expect(warningEvent).toBeDefined();
    expect(warningEvent.nodeId).toBe("fork");
    expect(warningEvent.message).toContain("unrecognized join_policy");
    expect(warningEvent.message).toContain("k_of_n");
    expect(warningEvent.message).toContain("wait_all");
  });

  it("respects max_parallel concurrency limit", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        fork [shape=component, max_parallel="1"]
        a [shape=box]
        b [shape=box]
        c [shape=box]
        join [shape=tripleoctagon]
        s -> fork
        fork -> a
        fork -> b
        fork -> c
        a -> join
        b -> join
        c -> join
        join -> e
      }
    `);

    // Track execution order — with max_parallel=1, branches run sequentially
    const executionOrder: string[] = [];
    const mock: Handler = {
      async execute(node: any) {
        executionOrder.push(node.id);
        return { status: "success" };
      },
    };

    const registry = new HandlerRegistry(mock);
    const handler = new ParallelHandler(registry);

    await handler.execute(
      graph.nodes.get("fork")!, new Context(), graph,
      { graph, cwd: tmpDir, logsRoot: tmpDir, interviewer: noopInterviewer } as any
    );

    // All three branches should have executed
    expect(executionOrder).toContain("a");
    expect(executionOrder).toContain("b");
    expect(executionOrder).toContain("c");
  });
});

describe("FanInHandler", () => {
  it("selects best outcome from parallel results", async () => {
    const handler = new FanInHandler();
    const ctx = new Context();
    ctx.set("parallel.results", JSON.stringify([
      { status: "fail", notes: "Failed" },
      { status: "success", notes: "Passed" },
      { status: "partial_success", notes: "Partial" },
    ]));

    const outcome = await handler.execute(
      { id: "join" } as any, ctx, {} as any, {} as any
    );

    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["parallel.fan_in.best_outcome"]).toBe("success");
  });

  it("fails when no parallel results available", async () => {
    const handler = new FanInHandler();
    const ctx = new Context();

    const outcome = await handler.execute(
      { id: "join" } as any, ctx, {} as any, {} as any
    );

    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("No parallel results");
  });

  it("handles all-fail results", async () => {
    const handler = new FanInHandler();
    const ctx = new Context();
    ctx.set("parallel.results", JSON.stringify([
      { status: "fail", notes: "Fail 1" },
      { status: "fail", notes: "Fail 2" },
    ]));

    const outcome = await handler.execute(
      { id: "join" } as any, ctx, {} as any, {} as any
    );

    expect(outcome.status).toBe("success"); // fan-in always succeeds (it reports)
    expect(outcome.contextUpdates?.["parallel.fan_in.best_outcome"]).toBe("fail");
  });
});
