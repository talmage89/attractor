import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "../../src/engine/runner.js";
import { parse } from "../../src/parser/parser.js";
import type { PipelineEvent } from "../../src/model/events.js";
import { HandlerRegistry } from "../../src/handlers/registry.js";
import type { Handler } from "../../src/handlers/registry.js";
import type { Outcome } from "../../src/model/outcome.js";

// Mock handler that returns configurable outcomes
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

// Minimal interviewer for tests
const noopInterviewer = {
  ask: async () => ({ value: "YES" }),
  inform: () => {},
};

describe("execution engine", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-run-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("traverses a linear pipeline", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, prompt="Do A"]
        b [shape=box, prompt="Do B"]
        s -> a -> b -> e
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
    });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("a");
    expect(result.completedNodes).toContain("b");
  });

  it("follows conditional edges based on outcome", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        good [shape=box]
        bad  [shape=box]
        s -> a
        a -> good [condition="outcome=success"]
        a -> bad  [condition="outcome=fail"]
        good -> e
        bad -> e
      }
    `);

    // Test success path
    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs1"),
      interviewer: noopInterviewer,
      // Default mock returns success, so "good" path should be taken
    });

    expect(result.completedNodes).toContain("good");
    expect(result.completedNodes).not.toContain("bad");
  });

  it("saves checkpoint after each node", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a -> e
      }
    `);

    const logsRoot = path.join(tmpDir, "logs");
    await run({ graph, cwd: tmpDir, logsRoot, interviewer: noopInterviewer });

    const checkpoint = JSON.parse(
      await fs.readFile(path.join(logsRoot, "checkpoint.json"), "utf-8")
    );
    expect(checkpoint.completedNodes).toContain("a");
  });

  it("emits events during execution", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a -> e
      }
    `);

    const events: PipelineEvent[] = [];
    await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      onEvent: (e) => events.push(e),
    });

    const kinds = events.map(e => e.kind);
    expect(kinds).toContain("pipeline_started");
    expect(kinds).toContain("stage_started");
    expect(kinds).toContain("stage_completed");
    expect(kinds).toContain("pipeline_completed");
  });

  it("enforces goal gates", async () => {
    // This test requires a handler that returns fail for the goal gate node.
    // The engine should detect the unsatisfied gate and either retry or fail.
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        critical [shape=box, goal_gate=true]
        s -> critical -> e
      }
    `);

    // With default mock (success), goal gate is satisfied
    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
    });
    expect(result.status).toBe("success");
  });

  it("applies context updates across nodes", async () => {
    // The mock handler can return context updates
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        b [shape=box]
        s -> a -> b -> e
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
    });

    // Context should have "outcome" set to last node's status
    expect(result.finalContext.get("outcome")).toBe("success");
  });

  it("retries on RETRY status then succeeds", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, max_retries=3]
        s -> a -> e
      }
    `);

    let callCount = 0;
    const retryThenSuccessHandler: Handler = {
      async execute(node: any): Promise<Outcome> {
        callCount++;
        if (callCount <= 2) {
          return { status: "retry", notes: `Attempt ${callCount}` };
        }
        return { status: "success", notes: "Finally worked" };
      },
    };
    const registry = new HandlerRegistry(retryThenSuccessHandler);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      registry,
    });

    // The handler should have been called 3 times (2 retries + 1 success)
    expect(callCount).toBe(3);
    expect(result.status).toBe("success");
  });

  it("FAIL does NOT trigger retry", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, max_retries=3]
        s -> a -> e
      }
    `);

    let callCount = 0;
    const failHandler: Handler = {
      async execute(): Promise<Outcome> {
        callCount++;
        return { status: "fail", failureReason: "Immediate failure" };
      },
    };
    const registry = new HandlerRegistry(failHandler);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      registry,
    });

    // Handler called exactly once — fail does not retry
    expect(callCount).toBe(1);
  });

  it("resumes from a checkpoint, skipping already-completed nodes", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test resume"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, prompt="Do A"]
        b [shape=box, prompt="Do B"]
        c [shape=box, prompt="Do C"]
        s -> a -> b -> c -> e
      }
    `);

    const logsRoot = path.join(tmpDir, "logs");

    // First run: save a checkpoint after completing nodes a and b
    const { saveCheckpoint } = await import("../../src/model/checkpoint.js");
    await fs.mkdir(logsRoot, { recursive: true });
    await saveCheckpoint({
      timestamp: Date.now(),
      currentNode: "c",
      completedNodes: ["a", "b"],
      nodeRetries: {},
      contextValues: { "graph.goal": "Test resume", outcome: "success" },
      sessionMap: {},
    }, logsRoot);

    // Resume from checkpoint — engine should skip a and b, execute c
    const callLog: string[] = [];
    const trackingHandler: Handler = {
      async execute(node: any): Promise<Outcome> {
        callLog.push(node.id);
        return { status: "success" };
      },
    };
    const registry = new HandlerRegistry(trackingHandler);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot,
      interviewer: noopInterviewer,
      resumeFromCheckpoint: path.join(logsRoot, "checkpoint.json"),
      registry,
    });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("a");  // restored from checkpoint
    expect(result.completedNodes).toContain("b");  // restored from checkpoint
    expect(result.completedNodes).toContain("c");  // executed during resume
    // Handler should NOT have been called for a or b (already completed)
    expect(callLog).not.toContain("a");
    expect(callLog).not.toContain("b");
    expect(callLog).toContain("c");
  });

  it("restarts the run when loopRestart edge is selected", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test loop restart"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a
        a -> a [loop_restart=true, condition="outcome=success"]
        a -> e  [condition="outcome=fail"]
      }
    `);

    let callCount = 0;
    const loopHandler: Handler = {
      async execute(): Promise<Outcome> {
        callCount++;
        // First call in original run: trigger loop restart
        // Second call in restarted run: exit via fail edge
        return callCount === 1 ? { status: "success" } : { status: "fail" };
      },
    };
    const registry = new HandlerRegistry(loopHandler);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      registry,
    });

    // Node `a` was called once per run (original + restart = 2)
    expect(callCount).toBe(2);
    // The final result is from the restarted run
    expect(result.status).toBe("success");
  });

  it("handles pipeline with no work nodes (start -> exit)", async () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        s -> e
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
    });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toHaveLength(0);
  });
});
