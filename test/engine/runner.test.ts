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
import { SessionManager } from "../../src/backend/session-manager.js";
import { saveCheckpoint } from "../../src/model/checkpoint.js";

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

  it("emits stage_retrying events with correct attempt and delayMs fields", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test retry events"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, max_retries=1]
        s -> a -> e
      }
    `);

    let callCount = 0;
    const retryOnceHandler: Handler = {
      async execute(): Promise<Outcome> {
        callCount++;
        return callCount === 1 ? { status: "retry" } : { status: "success" };
      },
    };
    const registry = new HandlerRegistry(retryOnceHandler);
    const events: PipelineEvent[] = [];

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      registry,
      onEvent: (e) => events.push(e),
    });

    expect(result.status).toBe("success");

    const retryingEvents = events.filter(e => e.kind === "stage_retrying");
    expect(retryingEvents).toHaveLength(1);
    const evt = retryingEvents[0] as Extract<PipelineEvent, { kind: "stage_retrying" }>;
    expect(evt.nodeId).toBe("a");
    expect(evt.attempt).toBe(1);
    expect(typeof evt.delayMs).toBe("number");
    expect(evt.delayMs).toBeGreaterThan(0);
    expect(typeof evt.timestamp).toBe("number");
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
      nodeOutcomes: { a: { status: "success" }, b: { status: "success" } },
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

  it("excludes start node named 'start' (no Mdiamond shape) from completedNodes", async () => {
    // A node with id="start" is a valid start node per findStartNode, but has
    // no shape=Mdiamond and no type=start attribute. The old isStartNode check
    // missed this case and would include it in completedNodes.
    const graph = parse(`
      digraph G {
        graph [goal="Named start test"]
        start
        end [shape=Msquare]
        a [shape=box]
        start -> a -> end
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
    });

    expect(result.status).toBe("success");
    expect(result.completedNodes).not.toContain("start");
    expect(result.completedNodes).toContain("a");
  });

  it("saves sessionMap from SessionManager into checkpoint", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Session test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a -> e
      }
    `);

    // Pre-populate a session manager with a known session
    const sessionManager = new SessionManager();
    sessionManager.setSessionId("main-thread", "session-xyz-123");

    const logsRoot = path.join(tmpDir, "logs");
    await run({
      graph,
      cwd: tmpDir,
      logsRoot,
      interviewer: noopInterviewer,
      sessionManager,
    });

    const checkpoint = JSON.parse(
      await fs.readFile(path.join(logsRoot, "checkpoint.json"), "utf-8")
    );
    expect(checkpoint.sessionMap).toEqual({ "main-thread": "session-xyz-123" });
  });

  it("sets firstNodeAfterResume=true for the first node after resume, false for subsequent", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test resume fidelity flag"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, fidelity="full"]
        b [shape=box, fidelity="full"]
        s -> a -> b -> e
      }
    `);

    const logsRoot = path.join(tmpDir, "logs");

    // Save checkpoint pointing to node a (as if a hasn't run yet)
    await fs.mkdir(logsRoot, { recursive: true });
    await saveCheckpoint({
      timestamp: Date.now(),
      currentNode: "a",
      completedNodes: [],
      nodeOutcomes: {},
      nodeRetries: {},
      contextValues: { "graph.goal": "Test resume fidelity flag" },
      sessionMap: {},
    }, logsRoot);

    // Track firstNodeAfterResume value for each executed node
    const flagsByNode: Record<string, boolean | undefined> = {};
    const trackingHandler: Handler = {
      async execute(node: any, _ctx: any, _graph: any, config: any): Promise<Outcome> {
        flagsByNode[node.id] = config.firstNodeAfterResume;
        return { status: "success" };
      },
    };
    const registry = new HandlerRegistry(trackingHandler);

    await run({
      graph,
      cwd: tmpDir,
      logsRoot,
      interviewer: noopInterviewer,
      resumeFromCheckpoint: path.join(logsRoot, "checkpoint.json"),
      registry,
    });

    // First node after resume should have flag set, subsequent nodes should not
    expect(flagsByNode["a"]).toBe(true);
    expect(flagsByNode["b"]).toBeFalsy();
  });

  it("emits error event when handler throws and retries are exhausted", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test error event", default_max_retry=0]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a -> e
      }
    `);

    const throwingHandler: Handler = {
      async execute(): Promise<Outcome> {
        throw new Error("handler exploded");
      },
    };
    const registry = new HandlerRegistry(throwingHandler);
    const events: PipelineEvent[] = [];

    await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      registry,
      onEvent: (e) => events.push(e),
    });

    const errorEvents = events.filter(e => e.kind === "error");
    expect(errorEvents).toHaveLength(1);
    const evt = errorEvents[0] as Extract<PipelineEvent, { kind: "error" }>;
    expect(evt.nodeId).toBe("a");
    expect(evt.message).toBe("handler exploded");
    expect(typeof evt.timestamp).toBe("number");
  });

  it("restores sessionMap from checkpoint to SessionManager on resume", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Session restore test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        b [shape=box]
        s -> a -> b -> e
      }
    `);

    const logsRoot = path.join(tmpDir, "logs");

    // Save a checkpoint with a non-empty sessionMap
    await fs.mkdir(logsRoot, { recursive: true });
    await saveCheckpoint({
      timestamp: Date.now(),
      currentNode: "b",
      completedNodes: ["a"],
      nodeOutcomes: { a: { status: "success" } },
      nodeRetries: {},
      contextValues: { "graph.goal": "Session restore test", outcome: "success" },
      sessionMap: { "main-thread": "restored-session-456" },
    }, logsRoot);

    // Resume: the session manager should be populated from the checkpoint
    const sessionManager = new SessionManager();
    const registry = new HandlerRegistry({
      async execute(): Promise<Outcome> { return { status: "success" }; },
    });

    await run({
      graph,
      cwd: tmpDir,
      logsRoot,
      interviewer: noopInterviewer,
      resumeFromCheckpoint: path.join(logsRoot, "checkpoint.json"),
      registry,
      sessionManager,
    });

    // After resume, the session manager should contain the restored session
    expect(sessionManager.getSessionId("main-thread")).toBe("restored-session-456");
  });

  it("checkpoint includes non-empty nodeRetries after a retried node", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test nodeRetries tracking"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, max_retries=2]
        s -> a -> e
      }
    `);

    let callCount = 0;
    const retryOnceThenSucceed: Handler = {
      async execute(): Promise<Outcome> {
        callCount++;
        return callCount === 1 ? { status: "retry" } : { status: "success" };
      },
    };
    const registry = new HandlerRegistry(retryOnceThenSucceed);
    const logsRoot = path.join(tmpDir, "logs");

    await run({ graph, cwd: tmpDir, logsRoot, interviewer: noopInterviewer, registry });

    const checkpoint = JSON.parse(
      await fs.readFile(path.join(logsRoot, "checkpoint.json"), "utf-8")
    );
    // Node "a" retried once: nodeRetries["a"] should be 1
    expect(checkpoint.nodeRetries).toMatchObject({ a: 1 });
  });

  it("resume with saved nodeRetries uses initialAttempt, consuming fewer total attempts", async () => {
    // Use a conditional edge so a "fail" outcome from "a" terminates the pipeline
    // (no fallback edge → selectEdge returns null → finalStatus = fail).
    const graph = parse(`
      digraph G {
        graph [goal="Test nodeRetries resume"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, max_retries=1]
        s -> a -> e [condition="outcome=success"]
      }
    `);

    const logsRoot = path.join(tmpDir, "logs");

    // Save a checkpoint indicating node "a" has already consumed 1 retry attempt.
    // With max_retries=1 (maxAttempts=2), only 1 attempt remains: initialAttempt=2.
    // Without the fix, initialAttempt=1 and 2 calls would be made.
    await fs.mkdir(logsRoot, { recursive: true });
    await saveCheckpoint({
      timestamp: Date.now(),
      currentNode: "a",
      completedNodes: [],
      nodeOutcomes: {},
      nodeRetries: { a: 1 },  // attempt 1 already failed
      contextValues: { "graph.goal": "Test nodeRetries resume" },
      sessionMap: {},
    }, logsRoot);

    let callCount = 0;
    const alwaysRetryHandler: Handler = {
      async execute(node: any): Promise<Outcome> {
        if (node.id === "a") callCount++;
        return { status: "retry" };
      },
    };
    const registry = new HandlerRegistry(alwaysRetryHandler);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot,
      interviewer: noopInterviewer,
      resumeFromCheckpoint: path.join(logsRoot, "checkpoint.json"),
      registry,
    });

    // With fix: initialAttempt=2, only 1 call made (attempt 2 of 2).
    // Without fix: initialAttempt=1, 2 calls would be made.
    expect(callCount).toBe(1);
    // No success edge was taken (a always retried then failed) → pipeline fails
    expect(result.status).toBe("fail");
  });

  it("does not overwrite caller-registered start/exit handlers", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test custom handlers"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        s -> e
      }
    `);

    const callLog: string[] = [];
    const customStartHandler: Handler = {
      async execute(): Promise<Outcome> {
        callLog.push("custom-start");
        return { status: "success" };
      },
    };
    const customExitHandler: Handler = {
      async execute(): Promise<Outcome> {
        callLog.push("custom-exit");
        return { status: "success" };
      },
    };

    const registry = new HandlerRegistry({ async execute(): Promise<Outcome> { return { status: "success" }; } });
    registry.register("start", customStartHandler);
    registry.register("exit", customExitHandler);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      registry,
    });

    expect(result.status).toBe("success");
    // Both custom handlers should have been called (not overwritten by run())
    expect(callLog).toContain("custom-start");
    expect(callLog).toContain("custom-exit");
  });

  it("exit handler failure propagates to RunResult.status when goal gates pass", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test exit fail"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a -> e
      }
    `);

    const exitFailHandler: Handler = {
      async execute(node: any): Promise<Outcome> {
        // Custom exit handler that signals failure
        if (node.shape === "Msquare") return { status: "fail", failureReason: "exit failed" };
        return { status: "success" };
      },
    };
    const registry = new HandlerRegistry({ async execute(): Promise<Outcome> { return { status: "success" }; } });
    registry.register("exit", exitFailHandler);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      registry,
    });

    // Exit handler returned fail — pipeline should reflect that failure
    expect(result.status).toBe("fail");
  });

  it("goal-gate retry loop is bounded by default_max_retry", async () => {
    // Pipeline: start -> work -> exit; work has goal_gate=true and always fails;
    // exit has retry_target pointing back to work. With default_max_retry=2 the
    // loop should terminate with status "fail" after 2 goal-gate retries.
    const graph = parse(`
      digraph G {
        graph [goal="Test goal gate limit", default_max_retry=2, retry_target="work"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, goal_gate=true]
        s -> work -> e
      }
    `);

    let callCount = 0;
    const alwaysFailHandler: Handler = {
      async execute(): Promise<Outcome> {
        callCount++;
        return { status: "fail" };
      },
    };
    const registry = new HandlerRegistry(alwaysFailHandler);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: noopInterviewer,
      registry,
    });

    // Pipeline must terminate (not loop forever) with fail status
    expect(result.status).toBe("fail");
    // work was executed on the initial pass plus up to maxGoalGateRetries (2) retries = 3 total
    expect(callCount).toBe(3);
  });
});
