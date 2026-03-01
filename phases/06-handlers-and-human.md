# Phase 6: Handlers (Simple + Human)

## Scope

All non-CC handlers and the human-in-the-loop interviewer system. After this
phase, you can run pipelines with start, exit, conditional, tool, and
wait.human nodes — everything except codergen and parallel.

### Files to Create

```
src/
  handlers/
    start.ts              # StartHandler
    exit.ts               # ExitHandler
    conditional.ts        # ConditionalHandler
    tool.ts               # ToolHandler + runShellCommand()
    wait-human.ts         # WaitForHumanHandler + parseAcceleratorKey()

  interviewer/
    interviewer.ts        # Question, Answer, Interviewer interface
    console.ts            # ConsoleInterviewer
    auto-approve.ts       # AutoApproveInterviewer
    queue.ts              # QueueInterviewer

test/
  handlers/
    simple-handlers.test.ts
    tool-handler.test.ts
    wait-human.test.ts

  interviewer/
    interviewer.test.ts
```

### Dependencies

Phase 1: `Graph`, `GraphNode`, `Edge`, `Outcome`, `outgoingEdges()`.
Phase 4: `Context`.
Phase 5: `Handler` interface, `HandlerRegistry`, `RunConfig`.

---

## Implementation Notes

### handlers/start.ts

```typescript
class StartHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: "success" };
  }
}
```

No-op. The start node is a structural marker.

### handlers/exit.ts

```typescript
class ExitHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: "success" };
  }
}
```

No-op. The exit node is a structural marker. Goal gate checks happen in the
engine before the exit handler runs.

### handlers/conditional.ts

```typescript
class ConditionalHandler implements Handler {
  async execute(node: GraphNode): Promise<Outcome> {
    return {
      status: "success",
      notes: `Conditional node evaluated: ${node.id}`,
    };
  }
}
```

Routing is purely handled by the engine's `selectEdge()`. The handler just
passes through.

### handlers/tool.ts

```typescript
interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

async function runShellCommand(
  command: string,
  options: { cwd: string; timeoutMs: number }
): Promise<ShellResult>
```

Spawn via `child_process.exec` with `shell: true`. Capture stdout and stderr.
Enforce timeout: after `timeoutMs`, send SIGTERM. If the process doesn't exit
within 2 seconds, send SIGKILL. Set `timedOut: true` in that case.

```typescript
class ToolHandler implements Handler {
  async execute(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome>
```

1. Read `tool_command` from `node.raw.get("tool_command")`.
2. If missing, return `{ status: "fail", failureReason: "No tool_command specified" }`.
3. Determine timeout from `node.timeout ?? 30_000`.
4. Run the command via `runShellCommand()`.
5. Return outcome:
   - `exitCode === 0` → `status: "success"`
   - Otherwise → `status: "fail"` with stderr in `failureReason`.
6. Populate `contextUpdates` with `tool.output` (stdout, truncated to 5000 chars)
   and `tool.exit_code`.

### handlers/wait-human.ts

```typescript
function parseAcceleratorKey(label: string): string
```

Three patterns, checked in order:
- `[K] Label` → return `K`
- `K) Label` → return `K`
- `K - Label` → return `K`
- Fallback: first character, uppercased.

```typescript
class WaitForHumanHandler implements Handler {
  constructor(private interviewer: Interviewer) {}

  async execute(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome>
```

1. Get outgoing edges via `outgoingEdges(graph, node.id)`.
2. If zero edges, return `{ status: "fail", failureReason: "No outgoing edges for human gate" }`.
3. Build choices array: `{ key, label, to }` from each edge.
4. Build a `Question` with `type: "multiple_choice"`.
5. Call `this.interviewer.ask(question)`.
6. Handle TIMEOUT/SKIPPED: check `node.raw.get("human.default_choice")` for fallback.
7. Match the answer to a choice by key or label (case-insensitive).
8. Return `suggestedNextIds: [selected.to]` in the outcome.

### interviewer/interviewer.ts

```typescript
interface Question {
  text: string;
  type: "yes_no" | "multiple_choice" | "freeform" | "confirmation";
  options?: { key: string; label: string }[];
  stage: string;
  timeoutSeconds?: number;
}

interface Answer {
  value: string;
  selectedOption?: { key: string; label: string };
  text?: string;
}

interface Interviewer {
  ask(question: Question): Promise<Answer>;
  inform(message: string, stage: string): void;
}
```

### interviewer/console.ts

```typescript
class ConsoleInterviewer implements Interviewer
```

Uses `node:readline/promises`. Prints question, reads response from stdin.
For `multiple_choice`, prints each option as `[key] label`. Matches response
to option by key or label (case-insensitive). Creates a new readline interface
per question and closes it in a `finally` block.

### interviewer/auto-approve.ts

```typescript
class AutoApproveInterviewer implements Interviewer
```

- `yes_no` / `confirmation` → `{ value: "YES" }`
- `multiple_choice` → first option
- `freeform` → `{ value: "auto-approved" }`
- `inform` → silent

### interviewer/queue.ts

```typescript
class QueueInterviewer implements Interviewer {
  private answers: Answer[];
  private index = 0;

  constructor(answers: Answer[])
  async ask(): Promise<Answer>  // returns next queued answer, or { value: "SKIPPED" }
  inform(): void  // no-op
}
```

---

## Test Fixtures

### test/handlers/simple-handlers.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { StartHandler } from "../../src/handlers/start";
import { ExitHandler } from "../../src/handlers/exit";
import { ConditionalHandler } from "../../src/handlers/conditional";
import { Context } from "../../src/model/context";
import { parse } from "../../src/parser/parser";

describe("StartHandler", () => {
  it("returns success", async () => {
    const handler = new StartHandler();
    const outcome = await handler.execute(
      { id: "s" } as any,
      new Context(),
      {} as any,
      {} as any
    );
    expect(outcome.status).toBe("success");
  });
});

describe("ExitHandler", () => {
  it("returns success", async () => {
    const handler = new ExitHandler();
    const outcome = await handler.execute(
      { id: "e" } as any,
      new Context(),
      {} as any,
      {} as any
    );
    expect(outcome.status).toBe("success");
  });
});

describe("ConditionalHandler", () => {
  it("returns success with node ID in notes", async () => {
    const handler = new ConditionalHandler();
    const outcome = await handler.execute(
      { id: "gate" } as any,
      new Context(),
      {} as any,
      {} as any
    );
    expect(outcome.status).toBe("success");
    expect(outcome.notes).toContain("gate");
  });
});
```

### test/handlers/tool-handler.test.ts

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ToolHandler } from "../../src/handlers/tool";
import { Context } from "../../src/model/context";
import type { GraphNode } from "../../src/model/graph";

function makeToolNode(overrides: Partial<GraphNode> & { tool_command?: string } = {}): GraphNode {
  const raw = new Map<string, string>();
  if (overrides.tool_command) {
    raw.set("tool_command", overrides.tool_command);
  }
  return {
    id: "tool_node", label: "Tool", shape: "parallelogram", type: "tool",
    prompt: "", maxRetries: 0, goalGate: false, retryTarget: "",
    fallbackRetryTarget: "", fidelity: "", threadId: "", className: "",
    timeout: null, llmModel: "", llmProvider: "", reasoningEffort: "high",
    autoStatus: false, allowPartial: false, raw,
    ...overrides,
  };
}

describe("ToolHandler", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-tool-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const config = (cwd: string) => ({
    graph: {} as any,
    cwd,
    logsRoot: cwd,
    interviewer: { ask: async () => ({ value: "" }), inform: () => {} },
  });

  it("fails when no tool_command specified", async () => {
    const handler = new ToolHandler();
    const node = makeToolNode();
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("tool_command");
  });

  it("executes a successful command", async () => {
    const handler = new ToolHandler();
    const node = makeToolNode({ tool_command: "echo hello" });
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("hello");
    expect(outcome.contextUpdates?.["tool.exit_code"]).toBe("0");
  });

  it("fails on nonzero exit code", async () => {
    const handler = new ToolHandler();
    const node = makeToolNode({ tool_command: "exit 1" });
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    expect(outcome.status).toBe("fail");
    expect(outcome.contextUpdates?.["tool.exit_code"]).toBe("1");
  });

  it("fails on invalid command", async () => {
    const handler = new ToolHandler();
    const node = makeToolNode({ tool_command: "nonexistent_command_xyz_12345" });
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    expect(outcome.status).toBe("fail");
  });

  it("captures stdout in context updates", async () => {
    const handler = new ToolHandler();
    const node = makeToolNode({ tool_command: "echo 'line1' && echo 'line2'" });
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("line1");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("line2");
  });

  it("truncates very long stdout", async () => {
    const handler = new ToolHandler();
    // Generate output longer than the 5000-char limit
    const node = makeToolNode({ tool_command: "python3 -c \"print('x' * 10000)\"" });
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    if (outcome.status === "success") {
      const output = outcome.contextUpdates?.["tool.output"] as string;
      expect(output.length).toBeLessThanOrEqual(5000);
    }
    // If python3 is not available, skip gracefully — the test validates truncation
  });

  it("uses custom timeout from node", async () => {
    const handler = new ToolHandler();
    // A command that would take longer than the timeout
    const node = makeToolNode({
      tool_command: "sleep 10",
      timeout: 500,
    });
    const start = Date.now();
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    const elapsed = Date.now() - start;
    expect(outcome.status).toBe("fail");
    expect(elapsed).toBeLessThan(5000); // Should not have waited the full 10s
  });
});
```

### test/handlers/wait-human.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { WaitForHumanHandler, parseAcceleratorKey } from "../../src/handlers/wait-human";
import { QueueInterviewer } from "../../src/interviewer/queue";
import { parse } from "../../src/parser/parser";
import { Context } from "../../src/model/context";

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
```

### test/interviewer/interviewer.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { AutoApproveInterviewer } from "../../src/interviewer/auto-approve";
import { QueueInterviewer } from "../../src/interviewer/queue";
import type { Question } from "../../src/interviewer/interviewer";

describe("AutoApproveInterviewer", () => {
  const interviewer = new AutoApproveInterviewer();

  it("approves yes_no questions", async () => {
    const q: Question = { text: "Continue?", type: "yes_no", stage: "test" };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("YES");
  });

  it("approves confirmation questions", async () => {
    const q: Question = { text: "Confirm?", type: "confirmation", stage: "test" };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("YES");
  });

  it("selects first option for multiple choice", async () => {
    const q: Question = {
      text: "Pick one",
      type: "multiple_choice",
      options: [
        { key: "A", label: "Alpha" },
        { key: "B", label: "Beta" },
      ],
      stage: "test",
    };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("A");
    expect(answer.selectedOption?.label).toBe("Alpha");
  });

  it("returns auto-approved for freeform", async () => {
    const q: Question = { text: "Describe:", type: "freeform", stage: "test" };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("auto-approved");
  });

  it("inform is a no-op", () => {
    // Should not throw
    interviewer.inform("message", "stage");
  });
});

describe("QueueInterviewer", () => {
  it("returns answers in order", async () => {
    const interviewer = new QueueInterviewer([
      { value: "first" },
      { value: "second" },
    ]);
    const q: Question = { text: "Q?", type: "freeform", stage: "test" };

    const a1 = await interviewer.ask(q);
    expect(a1.value).toBe("first");

    const a2 = await interviewer.ask(q);
    expect(a2.value).toBe("second");
  });

  it("returns SKIPPED when queue is exhausted", async () => {
    const interviewer = new QueueInterviewer([{ value: "only" }]);
    const q: Question = { text: "Q?", type: "freeform", stage: "test" };

    await interviewer.ask(q); // "only"
    const a2 = await interviewer.ask(q);
    expect(a2.value).toBe("SKIPPED");
  });

  it("returns SKIPPED when queue is empty", async () => {
    const interviewer = new QueueInterviewer([]);
    const q: Question = { text: "Q?", type: "freeform", stage: "test" };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("SKIPPED");
  });

  it("inform is a no-op", () => {
    const interviewer = new QueueInterviewer([]);
    interviewer.inform("msg", "stage"); // should not throw
  });
});
```

---

## Completion Criteria

- [ ] StartHandler returns success
- [ ] ExitHandler returns success
- [ ] ConditionalHandler returns success with node ID in notes
- [ ] ToolHandler reads `tool_command` from node.raw
- [ ] ToolHandler returns success on zero exit code, fail otherwise
- [ ] ToolHandler captures stdout/stderr in context updates
- [ ] ToolHandler enforces timeout and reports timed-out commands as fail
- [ ] ToolHandler truncates long stdout to 5000 chars
- [ ] parseAcceleratorKey extracts keys from `[K]`, `K)`, `K -` patterns
- [ ] WaitForHumanHandler presents choices from outgoing edges
- [ ] WaitForHumanHandler routes based on human selection (by key or label)
- [ ] WaitForHumanHandler handles TIMEOUT/SKIPPED with default choice fallback
- [ ] WaitForHumanHandler fails when no outgoing edges exist
- [ ] Question/Answer/Interviewer interfaces match SPEC.md Section 12
- [ ] ConsoleInterviewer reads from stdin (manual verification)
- [ ] AutoApproveInterviewer selects YES / first option
- [ ] QueueInterviewer returns queued answers in order, SKIPPED when exhausted
- [ ] All Phase 1-5 tests still pass
- [ ] All tests pass: `npx vitest run`
