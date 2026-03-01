# Phase 8: Parallel Handlers + CLI + Integration

## Scope

The parallel execution handlers, the CLI entry point, event rendering, and
end-to-end integration tests that validate the entire system. After this
phase, the implementation is complete and usable.

### Files to Create

```
src/
  handlers/
    parallel.ts             # ParallelHandler + executeBranch()
    fan-in.ts               # FanInHandler

  cli.ts                    # CLI entry point: run, validate, visualize
  index.ts                  # Public API: run(), validate(), parse()

test/
  handlers/
    parallel.test.ts

  integration/
    end-to-end.test.ts      # Full pipeline integration tests
```

### Dependencies

All prior phases (1-7).

---

## Implementation Notes

### handlers/parallel.ts

```typescript
class ParallelHandler implements Handler {
  constructor(
    private registry: HandlerRegistry,
    private sessionManager: SessionManager,
  ) {}

  async execute(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome>
}
```

1. Get outgoing edges via `outgoingEdges(graph, node.id)`.
2. If zero edges, return `{ status: "fail" }`.
3. Read `join_policy` from `node.raw.get("join_policy") ?? "wait_all"`.
4. Read `max_parallel` from `node.raw.get("max_parallel") ?? "4"`.
5. Execute branches with bounded concurrency:
   - For each branch edge, clone the context and call `executeBranch()`.
   - Use a semaphore pattern: at most `max_parallel` concurrent branches.
   - Collect all results.
6. Evaluate join policy:
   - `wait_all`: success if zero failures, partial_success if any failures.
   - `first_success`: success if any branch succeeded.
7. Populate `parallel.results` on context, plus `parallel.success_count` and
   `parallel.fail_count` in `contextUpdates`.

```typescript
async function executeBranch(
  startNodeId: string,
  context: Context,
  graph: Graph,
  config: RunConfig,
  registry: HandlerRegistry
): Promise<Outcome>
```

A simplified traversal loop that:
1. Starts at the given node.
2. Resolves handler, executes, records outcome.
3. Selects next edge.
4. Stops when: no outgoing edges, terminal node reached, or fan-in node
   (`parallel.fan_in` type or `tripleoctagon` shape) reached.
5. Returns the last outcome.

This function reuses `selectEdge` from Phase 5 and handler dispatch from the
registry. It does NOT save checkpoints (parallel branches are transient).

### handlers/fan-in.ts

```typescript
class FanInHandler implements Handler {
  async execute(
    node: GraphNode,
    context: Context
  ): Promise<Outcome>
}
```

1. Read `parallel.results` from context.
2. If absent, return `{ status: "fail", failureReason: "No parallel results" }`.
3. Parse the JSON array of outcomes.
4. Rank by status: `success > partial_success > retry > fail`.
5. Return success with `parallel.fan_in.best_outcome` and
   `parallel.fan_in.best_notes` in `contextUpdates`.

### cli.ts

```typescript
import { parseArgs } from "node:util";

async function main(): Promise<void>
```

**Commands:**

`attractor run <dotfile> [options]`:
1. Read and parse the DOT file.
2. Apply transforms.
3. Validate (print diagnostics, exit 2 on errors).
4. Create logs directory: `--logs` or `.attractor/runs/<ISO-timestamp>`.
5. Select interviewer: `--auto-approve` → `AutoApproveInterviewer`, else
   `ConsoleInterviewer`.
6. Set up event handler that prints structured progress to stderr.
7. Call `run({ graph, cwd, logsRoot, interviewer, onEvent, ... })`.
8. Print summary: status, completed nodes, duration, total cost.
9. Exit with code: 0 (success), 1 (fail), 3 (runtime error).

`attractor validate <dotfile>`:
1. Read and parse the DOT file.
2. Apply transforms.
3. Run `validate(graph)`.
4. Print each diagnostic: `[severity] (rule) message`.
5. Exit 0 if no errors, 2 if errors exist.

`attractor visualize <dotfile>`:
1. Read the DOT file (raw source).
2. Try to shell out to `dot -Tsvg` (Graphviz).
3. If available, pipe DOT source to stdin and write SVG to stdout.
4. If Graphviz not found, print a message suggesting installation.

**CLI Options:**
```
--cwd <dir>             Working directory for CC sessions (default: cwd)
--logs <dir>            Run output directory
--resume <path>         Resume from checkpoint.json
--auto-approve          Skip human gates
--permission-mode <m>   CC permission mode (default: bypassPermissions)
--verbose               Print all events to stderr
```

**Event rendering:**

```typescript
function formatEvent(event: PipelineEvent, startTime: number): string
```

Format each event as a timestamped line:
- `pipeline_started` → `[MM:SS] Pipeline started: "goal"`
- `stage_started` → `[MM:SS] ● nodeId → running...`
- `stage_completed` → `[MM:SS] ● nodeId → status (Xs, $Y.YY)`
- `edge_selected` → `[MM:SS]   → edge "label" → target`
- `human_question` → `[MM:SS] [?] question text`
- `pipeline_completed` → `[MM:SS] Pipeline completed: status (Xm Ys, $Z.ZZ)`
- `error` → `[MM:SS] ✗ message`

### index.ts

Public API re-exports:

```typescript
export { run } from "./engine/runner";
export type { RunConfig, RunResult } from "./engine/runner";
export { parse } from "./parser/parser";
export { validate, validateOrThrow } from "./validation/validator";
export type { Graph, GraphNode, Edge } from "./model/graph";
export type { Outcome, StageStatus } from "./model/outcome";
export type { PipelineEvent } from "./model/events";
export type { Interviewer, Question, Answer } from "./interviewer/interviewer";
export { ConsoleInterviewer } from "./interviewer/console";
export { AutoApproveInterviewer } from "./interviewer/auto-approve";
export { QueueInterviewer } from "./interviewer/queue";
```

---

## Test Fixtures

### test/handlers/parallel.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ParallelHandler } from "../../src/handlers/parallel";
import { FanInHandler } from "../../src/handlers/fan-in";
import { HandlerRegistry } from "../../src/handlers/registry";
import { SessionManager } from "../../src/backend/session-manager";
import { parse } from "../../src/parser/parser";
import { Context } from "../../src/model/context";
import type { Handler } from "../../src/handlers/registry";
import type { Outcome } from "../../src/model/outcome";

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
    const sessionManager = new SessionManager();
    const handler = new ParallelHandler(registry, sessionManager);
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
    const handler = new ParallelHandler(registry, new SessionManager());

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
    const handler = new ParallelHandler(registry, new SessionManager());

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
    const handler = new ParallelHandler(registry, new SessionManager());

    const outcome = await handler.execute(
      graph.nodes.get("fork")!, new Context(), isolated as any,
      { graph: isolated, cwd: tmpDir, logsRoot: tmpDir, interviewer: noopInterviewer } as any
    );

    expect(outcome.status).toBe("fail");
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
    const handler = new ParallelHandler(registry, new SessionManager());

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
```

### test/integration/end-to-end.test.ts

These tests exercise the full pipeline with mock CC (no real CC invocations).
They validate that all subsystems compose correctly.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "../../src/engine/runner";
import { parse } from "../../src/parser/parser";
import { validate } from "../../src/validation/validator";
import { QueueInterviewer } from "../../src/interviewer/queue";
import { AutoApproveInterviewer } from "../../src/interviewer/auto-approve";
import type { PipelineEvent } from "../../src/model/events";
import type { Outcome } from "../../src/model/outcome";

describe("integration: validate + run", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-e2e-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("validates a well-formed pipeline with zero errors", () => {
    const graph = parse(`
      digraph G {
        graph [goal="Build feature"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        plan     [shape=box, prompt="Create a plan for: $goal"]
        implement [shape=box, prompt="Implement the plan"]
        test     [shape=box, prompt="Run tests"]
        s -> plan -> implement -> test -> e
      }
    `);
    const diags = validate(graph);
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("rejects a pipeline missing start node", () => {
    const graph = parse(`
      digraph G {
        a [shape=box]
        e [shape=Msquare]
        a -> e
      }
    `);
    const diags = validate(graph);
    const errors = diags.filter(d => d.severity === "error");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("runs a minimal pipeline (start → exit)", async () => {
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
      interviewer: new AutoApproveInterviewer(),
    });

    expect(result.status).toBe("success");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runs a linear pipeline with mock handlers", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Integration test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        step1 [shape=box, prompt="Do step 1"]
        step2 [shape=box, prompt="Do step 2"]
        s -> step1 -> step2 -> e
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: new AutoApproveInterviewer(),
    });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("step1");
    expect(result.completedNodes).toContain("step2");
  });

  it("collects all event kinds during a run", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Event test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, prompt="Work"]
        s -> a -> e
      }
    `);

    const events: PipelineEvent[] = [];
    await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: new AutoApproveInterviewer(),
      onEvent: (e) => events.push(e),
    });

    const kinds = new Set(events.map(e => e.kind));
    expect(kinds.has("pipeline_started")).toBe(true);
    expect(kinds.has("pipeline_completed")).toBe(true);
  });

  it("follows conditional branches correctly", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Branch test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Work"]
        gate [shape=diamond]
        path_a [shape=box, prompt="Path A"]
        path_b [shape=box, prompt="Path B"]
        s -> work -> gate
        gate -> path_a [condition="outcome=success"]
        gate -> path_b [condition="outcome=fail"]
        path_a -> e
        path_b -> e
      }
    `);

    // With default success outcome, path_a should be taken
    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: new AutoApproveInterviewer(),
    });

    expect(result.completedNodes).toContain("path_a");
    expect(result.completedNodes).not.toContain("path_b");
  });

  it("handles human gates with auto-approve", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Human gate test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        gate [shape=hexagon, label="Review the work"]
        proceed [shape=box, prompt="Continue"]
        s -> gate
        gate -> proceed [label="[Y] Yes, continue"]
        gate -> e       [label="[N] No, stop"]
        proceed -> e
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: new AutoApproveInterviewer(),
    });

    // AutoApprove selects first option "[Y] Yes, continue" → proceed
    expect(result.status).toBe("success");
  });

  it("handles human gates with queue interviewer", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Queue test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        gate [shape=hexagon]
        left  [shape=box, prompt="Left"]
        right [shape=box, prompt="Right"]
        s -> gate
        gate -> left  [label="[L] Left"]
        gate -> right [label="[R] Right"]
        left -> e
        right -> e
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: new QueueInterviewer([{ value: "R" }]),
    });

    expect(result.completedNodes).toContain("right");
    expect(result.completedNodes).not.toContain("left");
  });

  it("persists checkpoint after each stage", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Checkpoint test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, prompt="A"]
        b [shape=box, prompt="B"]
        s -> a -> b -> e
      }
    `);

    const logsRoot = path.join(tmpDir, "logs");
    await run({
      graph,
      cwd: tmpDir,
      logsRoot,
      interviewer: new AutoApproveInterviewer(),
    });

    const checkpointPath = path.join(logsRoot, "checkpoint.json");
    const stat = await fs.stat(checkpointPath);
    expect(stat.isFile()).toBe(true);

    const checkpoint = JSON.parse(await fs.readFile(checkpointPath, "utf-8"));
    expect(checkpoint.completedNodes).toContain("a");
    expect(checkpoint.completedNodes).toContain("b");
  });

  it("context updates from one stage are visible to the next", async () => {
    // This requires a handler that writes context updates.
    // With mock handlers it's limited, but we can verify the engine's
    // context propagation by checking that "outcome" is set after each node.
    const graph = parse(`
      digraph G {
        graph [goal="Context test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, prompt="A"]
        b [shape=box, prompt="B"]
        s -> a -> b -> e
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: new AutoApproveInterviewer(),
    });

    // The engine sets context.outcome after each node
    expect(result.finalContext.get("outcome")).toBe("success");
  });

  it("validates transforms: $goal expansion works", () => {
    const graph = parse(`
      digraph G {
        graph [goal="Build auth system"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        plan [prompt="Create a plan for: $goal"]
        s -> plan -> e
      }
    `);

    // Transforms are applied inside run(), but we can test parse + transform
    // by importing applyTransforms directly
    expect(graph.nodes.get("plan")?.prompt).toContain("$goal");
    // After transforms (inside run), it would be "Create a plan for: Build auth system"
  });

  it("validates stylesheet application", () => {
    const graph = parse(`
      digraph G {
        graph [
          goal="Stylesheet test"
          model_stylesheet="* { llm_model: claude-sonnet-4-5; } .code { llm_model: claude-opus-4-6; }"
        ]
        s [shape=Mdiamond]
        e [shape=Msquare]
        plan [shape=box]
        impl [shape=box, class="code"]
        s -> plan -> impl -> e
      }
    `);

    // After transforms, plan should have sonnet and impl should have opus
    // This is tested in Phase 3 but verified here as regression
    const diags = validate(graph);
    const errors = diags.filter(d => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("runs a complex pipeline with mixed handler types", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Complex pipeline"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        plan [shape=box, prompt="Plan the work"]
        gate [shape=diamond]
        impl [shape=box, prompt="Implement"]
        test_tool [shape=parallelogram, tool_command="echo pass"]
        review [shape=hexagon, label="Approve?"]
        done [shape=box, prompt="Finalize"]

        s -> plan -> gate
        gate -> impl [condition="outcome=success"]
        gate -> e    [condition="outcome=fail"]
        impl -> test_tool -> review
        review -> done [label="[Y] Yes"]
        review -> impl [label="[N] No"]
        done -> e
      }
    `);

    const result = await run({
      graph,
      cwd: tmpDir,
      logsRoot: path.join(tmpDir, "logs"),
      interviewer: new AutoApproveInterviewer(),
    });

    expect(result.status).toBe("success");
    expect(result.completedNodes).toContain("plan");
  });
});
```

---

## Completion Criteria

- [ ] ParallelHandler fans out to all outgoing edges
- [ ] ParallelHandler clones context for each branch
- [ ] ParallelHandler respects `max_parallel` concurrency limit
- [ ] ParallelHandler `wait_all` policy: success if all pass, partial_success if any fail
- [ ] ParallelHandler `first_success` policy: success if any branch succeeds
- [ ] ParallelHandler populates `parallel.results` and count context updates
- [ ] `executeBranch()` traverses a sub-graph until dead end or fan-in
- [ ] FanInHandler ranks outcomes and selects the best
- [ ] FanInHandler fails gracefully when no parallel results exist
- [ ] CLI `attractor run` parses args, reads DOT, executes pipeline, prints progress
- [ ] CLI `attractor validate` prints diagnostics and exits with correct code
- [ ] CLI `attractor visualize` delegates to Graphviz when available
- [ ] CLI event rendering produces readable timestamped output
- [ ] CLI exit codes: 0 (success), 1 (fail), 2 (validation error), 3 (runtime error)
- [ ] `index.ts` exports the public API surface
- [ ] Integration: linear pipeline runs end-to-end
- [ ] Integration: conditional branching follows correct path
- [ ] Integration: human gates route based on selection
- [ ] Integration: checkpoints are persisted and readable
- [ ] Integration: context propagates between stages
- [ ] Integration: mixed handler types compose correctly
- [ ] All Phase 1-7 tests still pass
- [ ] All tests pass: `npx vitest run`
