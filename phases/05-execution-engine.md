# Phase 5: Execution Engine

## Scope

The core execution loop, edge selection, retry logic, goal gate enforcement,
and handler registry. This is the heart of the system. After this phase, you
can traverse graphs end-to-end using mock handlers.

### Files to Create

```
src/
  engine/
    runner.ts           # run(), RunConfig, RunResult
    edge-selection.ts   # selectEdge()
    retry.ts            # RetryPolicy, buildRetryPolicy(), executeWithRetry()
    goal-gates.ts       # checkGoalGates()

  handlers/
    registry.ts         # HandlerRegistry, Handler interface, SHAPE_TO_TYPE

test/
  engine/
    runner.test.ts
    edge-selection.test.ts
```

### Dependencies

Phase 1: Graph model, Outcome, events.
Phase 2: `validateOrThrow()`.
Phase 3: `evaluateCondition()`, `applyTransforms()`.
Phase 4: `Context`, `saveCheckpoint`, `SessionManager`.

---

## Implementation Notes

### handlers/registry.ts

```typescript
interface Handler {
  execute(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome>;
}

const SHAPE_TO_TYPE: Record<string, string> = {
  Mdiamond: "start",
  Msquare: "exit",
  box: "codergen",
  hexagon: "wait.human",
  diamond: "conditional",
  component: "parallel",
  tripleoctagon: "parallel.fan_in",
  parallelogram: "tool",
};

class HandlerRegistry {
  private handlers = new Map<string, Handler>();
  private defaultHandler: Handler;

  constructor(defaultHandler: Handler)
  register(typeString: string, handler: Handler): void
  resolve(node: GraphNode): Handler
}
```

`resolve` follows the 3-step order from SPEC.md Section 9.2.

### engine/edge-selection.ts

```typescript
function selectEdge(
  graph: Graph,
  node: GraphNode,
  outcome: Outcome,
  context: Context
): Edge | null
```

Implements the 5-step algorithm from SPEC.md Section 8.3.

**Label normalization** for preferred label matching: lowercase, trim,
strip accelerator prefixes. Patterns to strip:
- `[X] ` → strip `[X] ` prefix
- `X) ` → strip `X) ` prefix
- `X - ` → strip `X - ` prefix

```typescript
function normalizeLabel(label: string): string {
  let s = label.trim().toLowerCase();
  // [X] Label
  s = s.replace(/^\[\w\]\s+/, "");
  // X) Label
  s = s.replace(/^\w\)\s+/, "");
  // X - Label
  s = s.replace(/^\w\s+-\s+/, "");
  return s.trim();
}
```

### engine/retry.ts

```typescript
interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitter: boolean;
}

function buildRetryPolicy(node: GraphNode, graph: Graph): RetryPolicy
function delayForAttempt(attempt: number, policy: RetryPolicy): number

async function executeWithRetry(
  handler: Handler,
  node: GraphNode,
  context: Context,
  graph: Graph,
  config: RunConfig,
  policy: RetryPolicy
): Promise<Outcome>
```

See SPEC.md Section 8.5 for the full algorithm.

### engine/goal-gates.ts

```typescript
interface GoalGateResult {
  satisfied: boolean;
  failedNode?: GraphNode;
}

function checkGoalGates(
  graph: Graph,
  nodeOutcomes: Map<string, Outcome>
): GoalGateResult

function resolveRetryTarget(
  failedNode: GraphNode,
  graph: Graph
): string | null
```

`resolveRetryTarget` checks: node.retryTarget → node.fallbackRetryTarget →
graph.attributes.retryTarget → graph.attributes.fallbackRetryTarget. Returns
first non-empty value that exists in `graph.nodes`, or null.

### engine/runner.ts

```typescript
interface RunConfig {
  graph: Graph;
  cwd: string;
  logsRoot: string;
  interviewer: Interviewer;
  onEvent?: (event: PipelineEvent) => void;
  resumeFromCheckpoint?: string;
  ccPermissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

interface RunResult {
  status: "success" | "fail";
  completedNodes: string[];
  nodeOutcomes: Map<string, Outcome>;
  finalContext: Map<string, unknown>;
  durationMs: number;
}

async function run(config: RunConfig): Promise<RunResult>
```

Implements the core loop from SPEC.md Section 8.2.

**For this phase**, the runner uses a `HandlerRegistry` with a single mock
handler registered as the default. The mock handler returns
`{ status: "success" }` for every node. Real handlers are registered in
Phase 6+.

The runner must:
1. Create logsRoot directory.
2. Initialize Context with graph attributes.
3. Apply transforms.
4. Validate (throw on errors).
5. Find start node.
6. Enter traversal loop.
7. On each node: resolve handler, execute with retry, record outcome,
   apply context updates, save checkpoint, select edge, advance.
8. On terminal node: check goal gates.
9. Return RunResult.

**Event emission**: call `config.onEvent` at each significant point
(stage_started, stage_completed, edge_selected, checkpoint_saved, etc.).
If `onEvent` is undefined, skip. If it throws, catch and ignore.

---

## Test Fixtures

### test/engine/edge-selection.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { selectEdge } from "../../src/engine/edge-selection";
import { parse } from "../../src/parser/parser";
import { Context } from "../../src/model/context";
import type { Outcome } from "../../src/model/outcome";

describe("selectEdge", () => {
  describe("condition matching (step 1)", () => {
    it("selects edge whose condition matches", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          gate [shape=diamond]
          yes [shape=box]
          no [shape=box]
          s -> gate
          gate -> yes [condition="outcome=success"]
          gate -> no  [condition="outcome=fail"]
          yes -> e
          no -> e
        }
      `);
      const gate = graph.nodes.get("gate")!;
      const outcome: Outcome = { status: "success" };
      const ctx = new Context();

      const edge = selectEdge(graph, gate, outcome, ctx);
      expect(edge?.to).toBe("yes");
    });

    it("condition match beats weight", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          low  [shape=box]
          high [shape=box]
          s -> a
          a -> low  [condition="outcome=success", weight=1]
          a -> high [weight=100]
          low -> e
          high -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, a, outcome, new Context());
      expect(edge?.to).toBe("low");
    });
  });

  describe("preferred label (step 2)", () => {
    it("matches preferred label from outcome", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          gate [shape=hexagon]
          approve [shape=box]
          reject  [shape=box]
          s -> gate
          gate -> approve [label="[A] Approve"]
          gate -> reject  [label="[R] Reject"]
          approve -> e
          reject -> e
        }
      `);
      const gate = graph.nodes.get("gate")!;
      const outcome: Outcome = { status: "success", preferredLabel: "Approve" };
      const edge = selectEdge(graph, gate, outcome, new Context());
      expect(edge?.to).toBe("approve");
    });

    it("normalizes accelerator prefixes in label matching", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          gate [shape=hexagon]
          fix [shape=box]
          s -> gate
          gate -> fix [label="[F] Fix issues"]
          fix -> e
        }
      `);
      const gate = graph.nodes.get("gate")!;
      const outcome: Outcome = { status: "success", preferredLabel: "fix issues" };
      const edge = selectEdge(graph, gate, outcome, new Context());
      expect(edge?.to).toBe("fix");
    });
  });

  describe("suggested next IDs (step 3)", () => {
    it("matches suggested next ID", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          b [shape=box]
          c [shape=box]
          s -> a
          a -> b
          a -> c
          b -> e
          c -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success", suggestedNextIds: ["c"] };
      const edge = selectEdge(graph, a, outcome, new Context());
      expect(edge?.to).toBe("c");
    });
  });

  describe("weight (step 4)", () => {
    it("selects highest weight among unconditional edges", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          b [shape=box]
          c [shape=box]
          s -> a
          a -> b [weight=5]
          a -> c [weight=10]
          b -> e
          c -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, a, outcome, new Context());
      expect(edge?.to).toBe("c");
    });
  });

  describe("lexical tiebreak (step 5)", () => {
    it("breaks ties alphabetically by target node ID", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          beta [shape=box]
          alpha [shape=box]
          s -> a
          a -> beta  [weight=0]
          a -> alpha [weight=0]
          beta -> e
          alpha -> e
        }
      `);
      const a = graph.nodes.get("a")!;
      const outcome: Outcome = { status: "success" };
      const edge = selectEdge(graph, a, outcome, new Context());
      expect(edge?.to).toBe("alpha");
    });
  });

  describe("no outgoing edges", () => {
    it("returns null when no edges exist", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e
        }
      `);
      // exit node has no outgoing edges
      const exit = graph.nodes.get("e")!;
      const edge = selectEdge(graph, exit, { status: "success" }, new Context());
      expect(edge).toBeNull();
    });
  });
});
```

### test/engine/runner.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "../../src/engine/runner";
import { parse } from "../../src/parser/parser";
import { Context } from "../../src/model/context";
import type { PipelineEvent } from "../../src/model/events";
import type { Handler } from "../../src/handlers/registry";
import type { Outcome } from "../../src/model/outcome";

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
```

Note: The runner tests in this phase use whatever default handler the
registry provides. In Phase 6, we register real handlers and can test
richer behavior. For Phase 5, the focus is on the traversal mechanics:
does the engine visit the right nodes in the right order?

To enable this, the `run()` function should accept an optional
`handlerOverride` or the tests should be able to inject a custom registry.
The cleanest approach: `RunConfig` accepts an optional `registry: HandlerRegistry`.
If not provided, `run()` creates the default registry with all built-in handlers.

---

## Completion Criteria

- [ ] Edge selection: all 5 steps work in correct priority order
- [ ] Label normalization strips accelerator prefixes
- [ ] Engine traverses linear pipeline (start → A → B → exit)
- [ ] Engine follows conditional edges based on outcome
- [ ] Engine saves checkpoint after each node
- [ ] Engine emits events at each lifecycle point
- [ ] Engine checks goal gates at terminal node
- [ ] Goal gate retry target resolution works (node → graph → null)
- [ ] Retry logic respects maxAttempts and backoff
- [ ] Engine handles start-to-exit with no work nodes
- [ ] Context updates propagate between nodes
- [ ] Transforms (variable expansion, stylesheet) run before traversal
- [ ] Validation runs before traversal and throws on errors
- [ ] All Phase 1-4 tests still pass
- [ ] All tests pass: `npx vitest run`
