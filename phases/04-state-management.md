# Phase 4: State Management

## Scope

Context, checkpoints, session management, and fidelity resolution. After this
phase, all runtime state primitives exist and can be tested independently of
the execution engine.

### Files to Create

```
src/
  model/
    context.ts          # Context class
    checkpoint.ts       # Checkpoint save/load

  backend/
    session-manager.ts  # SessionManager class
    preamble.ts         # generatePreamble()

  model/
    fidelity.ts         # (extend) resolveFidelity(), resolveThreadId()

test/
  model/
    context.test.ts
    checkpoint.test.ts

  backend/
    fidelity.test.ts    # fidelity resolution + preamble generation
```

### Dependencies

Phase 1: `Graph`, `GraphNode`, `Edge`, `Outcome`, `FidelityMode`.

---

## Implementation Notes

### model/context.ts

```typescript
class Context {
  private values = new Map<string, unknown>();

  set(key: string, value: unknown): void
  get(key: string): unknown | undefined
  getString(key: string, defaultValue?: string): string
  has(key: string): boolean
  keys(): string[]
  snapshot(): Record<string, unknown>
  clone(): Context
  applyUpdates(updates: Record<string, unknown>): void
}
```

No locking needed. Single-threaded execution. The `clone()` method creates
a deep-enough copy for parallel branch isolation (shallow copy of the Map;
values are strings/numbers/booleans so shallow is sufficient).

### model/checkpoint.ts

```typescript
interface Checkpoint {
  timestamp: number;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  contextValues: Record<string, unknown>;
  sessionMap: Record<string, string>;
}

async function saveCheckpoint(
  checkpoint: Checkpoint,
  logsRoot: string
): Promise<void>

async function loadCheckpoint(
  filePath: string
): Promise<Checkpoint>
```

`saveCheckpoint`: write JSON to `{logsRoot}/checkpoint.json`. Use
`JSON.stringify(checkpoint, null, 2)`. Create the directory if it doesn't exist.

`loadCheckpoint`: read and parse JSON. Validate that required fields exist.
Throw descriptive error on missing/malformed fields.

### backend/session-manager.ts

```typescript
class SessionManager {
  private sessions = new Map<string, string>();

  getSessionId(threadId: string): string | undefined
  setSessionId(threadId: string, sessionId: string): void
  snapshot(): Record<string, string>
  restore(data: Record<string, string>): void
  clear(): void
}
```

`snapshot()` returns a plain object for checkpoint serialization.
`restore()` loads from a checkpoint's `sessionMap`.

### model/fidelity.ts (extend from Phase 1)

Add resolution functions:

```typescript
function resolveFidelity(
  node: GraphNode,
  graph: Graph,
  incomingEdge?: Edge
): FidelityMode

function resolveThreadId(
  node: GraphNode,
  graph: Graph,
  incomingEdge?: Edge,
  previousNodeId?: string
): string
```

See SPEC.md Sections 11.2 and 11.3 for precedence rules.

### backend/preamble.ts

```typescript
function generatePreamble(
  mode: FidelityMode,
  context: Context,
  graph: Graph,
  completedNodes: string[],
  nodeOutcomes: Map<string, Outcome>
): string
```

Returns a markdown string. See SPEC.md Section 7.4 for content by mode.

The preamble format:

```markdown
## Pipeline Context

**Goal:** {goal}
**Progress:** {completed}/{total} stages complete

### Completed Stages
- {nodeId}: {status} — {notes}

### Current Context
- {key}: {value}
```

For `truncate`: only the Goal line and a run ID.
For `compact`: the full template above.
For `summary:low/medium/high`: narrative text at varying detail levels.

---

## Test Fixtures

### test/model/context.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { Context } from "../../src/model/context";

describe("Context", () => {
  it("set and get", () => {
    const ctx = new Context();
    ctx.set("key", "value");
    expect(ctx.get("key")).toBe("value");
  });

  it("get returns undefined for missing key", () => {
    const ctx = new Context();
    expect(ctx.get("missing")).toBeUndefined();
  });

  it("getString returns default for missing key", () => {
    const ctx = new Context();
    expect(ctx.getString("missing", "default")).toBe("default");
  });

  it("getString returns empty string by default", () => {
    const ctx = new Context();
    expect(ctx.getString("missing")).toBe("");
  });

  it("getString coerces non-string values", () => {
    const ctx = new Context();
    ctx.set("num", 42);
    expect(ctx.getString("num")).toBe("42");
  });

  it("has checks existence", () => {
    const ctx = new Context();
    ctx.set("key", "value");
    expect(ctx.has("key")).toBe(true);
    expect(ctx.has("other")).toBe(false);
  });

  it("keys returns all keys", () => {
    const ctx = new Context();
    ctx.set("a", 1);
    ctx.set("b", 2);
    expect(ctx.keys().sort()).toEqual(["a", "b"]);
  });

  it("snapshot returns a plain object copy", () => {
    const ctx = new Context();
    ctx.set("a", 1);
    ctx.set("b", "two");
    const snap = ctx.snapshot();
    expect(snap).toEqual({ a: 1, b: "two" });
    // Mutation of snapshot doesn't affect context
    snap.a = 999;
    expect(ctx.get("a")).toBe(1);
  });

  it("clone produces an independent copy", () => {
    const ctx = new Context();
    ctx.set("x", "original");
    const cloned = ctx.clone();
    cloned.set("x", "modified");
    cloned.set("y", "new");
    expect(ctx.get("x")).toBe("original");
    expect(ctx.has("y")).toBe(false);
  });

  it("applyUpdates merges key-value pairs", () => {
    const ctx = new Context();
    ctx.set("existing", "keep");
    ctx.applyUpdates({ new_key: "added", existing: "overwritten" });
    expect(ctx.get("new_key")).toBe("added");
    expect(ctx.get("existing")).toBe("overwritten");
  });
});
```

### test/model/checkpoint.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { saveCheckpoint, loadCheckpoint } from "../../src/model/checkpoint";

describe("Checkpoint", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const sampleCheckpoint = {
    timestamp: 1709000000000,
    currentNode: "implement",
    completedNodes: ["start", "plan", "implement"],
    nodeRetries: { implement: 1 },
    contextValues: { "graph.goal": "Test", outcome: "success" },
    sessionMap: { "main-loop": "session-uuid-123" },
  };

  it("saves and loads a checkpoint", async () => {
    await saveCheckpoint(sampleCheckpoint, tmpDir);
    const loaded = await loadCheckpoint(path.join(tmpDir, "checkpoint.json"));
    expect(loaded).toEqual(sampleCheckpoint);
  });

  it("overwrites existing checkpoint", async () => {
    await saveCheckpoint(sampleCheckpoint, tmpDir);
    const updated = { ...sampleCheckpoint, currentNode: "review" };
    await saveCheckpoint(updated, tmpDir);
    const loaded = await loadCheckpoint(path.join(tmpDir, "checkpoint.json"));
    expect(loaded.currentNode).toBe("review");
  });

  it("throws on missing file", async () => {
    await expect(
      loadCheckpoint(path.join(tmpDir, "nonexistent.json"))
    ).rejects.toThrow();
  });

  it("throws on malformed JSON", async () => {
    await fs.writeFile(path.join(tmpDir, "checkpoint.json"), "not json");
    await expect(
      loadCheckpoint(path.join(tmpDir, "checkpoint.json"))
    ).rejects.toThrow();
  });

  it("preserves complex context values", async () => {
    const cp = {
      ...sampleCheckpoint,
      contextValues: {
        "graph.goal": "Complex",
        "files_changed": '["a.ts", "b.ts"]',
        "nested.key": "value",
      },
    };
    await saveCheckpoint(cp, tmpDir);
    const loaded = await loadCheckpoint(path.join(tmpDir, "checkpoint.json"));
    expect(loaded.contextValues["files_changed"]).toBe('["a.ts", "b.ts"]');
  });
});
```

### test/backend/fidelity.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { resolveFidelity, resolveThreadId } from "../../src/model/fidelity";
import { generatePreamble } from "../../src/backend/preamble";
import { Context } from "../../src/model/context";
import type { Graph, GraphNode, Edge, Outcome } from "../../src/model/graph";

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
```

---

## Completion Criteria

- [ ] Context: set/get/getString/has/keys/snapshot/clone/applyUpdates all work
- [ ] Context clone is independent (mutations don't propagate)
- [ ] Checkpoint saves to and loads from JSON file
- [ ] Checkpoint round-trips without data loss
- [ ] Checkpoint throws on missing file or malformed JSON
- [ ] SessionManager stores and retrieves session IDs by thread ID
- [ ] SessionManager snapshot/restore round-trips
- [ ] Fidelity resolution follows precedence: edge > node > graph > "compact"
- [ ] Thread resolution follows precedence: node > edge > class > previous > self
- [ ] Preamble generation produces correct content for each fidelity mode
- [ ] All Phase 1-3 tests still pass
- [ ] All tests pass: `npx vitest run`
