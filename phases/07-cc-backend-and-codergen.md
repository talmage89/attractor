# Phase 7: CC Backend + Codergen Handler

## Scope

The Claude Code SDK wrapper and the codergen handler — the only components
that touch the external world (CC SDK). After this phase, you can execute
real AI-driven pipeline stages. This is the first phase that requires the
`@anthropic-ai/claude-agent-sdk` dependency.

### Files to Create

```
src/
  backend/
    cc-backend.ts           # runCC(), CCBackendOptions, CCResult

  handlers/
    codergen.ts             # CodergenHandler, buildStatusInstruction(), parseStatusFile()

test/
  backend/
    cc-backend.test.ts      # Unit tests (mocked SDK)

  handlers/
    codergen.test.ts        # Unit tests (mocked CC backend)
```

### Dependencies

Phase 1: `Graph`, `GraphNode`, `Edge`, `Outcome`, `outgoingEdges()`.
Phase 4: `Context`, `SessionManager`, `generatePreamble()`, `resolveFidelity()`, `resolveThreadId()`.
Phase 5: `Handler` interface, `RunConfig`.
External: `@anthropic-ai/claude-agent-sdk`.

---

## Implementation Notes

### backend/cc-backend.ts

```typescript
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

interface CCBackendOptions {
  cwd: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  maxTurns?: number;
  sessionId?: string;
  resume?: string;
  systemPromptAppend?: string;
  timeout?: number;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

interface CCResult {
  text: string;
  sessionId: string;
  success: boolean;
  costUsd: number;
  numTurns: number;
  durationMs: number;
  errorSubtype?: string;
  errors?: string[];
}

async function runCC(
  prompt: string,
  options: CCBackendOptions,
  onEvent?: (event: SDKMessage) => void
): Promise<CCResult>
```

**Implementation steps:**

1. Build the `query()` options:
   - Create an `AbortController`. If `options.timeout` is set, start a timer
     that calls `abortController.abort()` after the timeout.
   - Map `options.permissionMode` to `permissionMode` and
     `allowDangerouslySkipPermissions` flags.
   - Build `systemPrompt` as `{ type: "preset", preset: "claude_code", append: systemPromptAppend }`
     when `systemPromptAppend` is provided.

2. Call `query({ prompt, options: { ... } })` to get an async generator.

3. Consume the generator to completion:
   - Track `startTime = Date.now()`.
   - On `SDKSystemMessage` with `subtype: "init"`, capture `session_id`.
   - On each message, call `onEvent?.(message)` and increment `numTurns`.
   - On the final `SDKResultMessage`, capture result fields.

4. Clear the timeout handle.

5. Construct and return `CCResult`:
   - `success` = `resultMessage.subtype === "success"`
   - `text` = `resultMessage.result` (the full text output)
   - `costUsd` = `resultMessage.cost_usd`
   - `durationMs` = `Date.now() - startTime`
   - `errorSubtype` = `resultMessage.subtype` when not "success"
   - `errors` = error messages from the result if present

**Error handling:**
- If the generator throws (CC crashes, abort signal), catch and return a
  CCResult with `success: false`, `errorSubtype: "error_during_execution"`,
  and the error message in `errors`.
- Always clear the timeout handle in a `finally` block.

### handlers/codergen.ts

```typescript
class CodergenHandler implements Handler {
  constructor(
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

The 10-step process from SPEC.md Section 9.5:

1. **Build prompt**: Use `node.prompt || node.label`. Expand `$goal` with
   `graph.attributes.goal`.

2. **Resolve fidelity and session**: Call `resolveFidelity(node, graph)` and
   `resolveThreadId(node, graph)`.
   - If `full` fidelity and an existing session exists: set `resume` option.
   - If `full` fidelity and no existing session: fresh session, will track ID.
   - Otherwise: generate preamble, prepend to prompt, fresh session.

3. **Build status instruction**: Call `buildStatusInstruction()`. Set as
   `systemPromptAppend`.

4. **Create stage directory**: `{logsRoot}/{nodeId}/`. Write `prompt.md`.

5. **Call CC**: `runCC(prompt, ccOptions, eventForwarder)`.

6. **Track session**: If `full` fidelity, store the returned `sessionId` in
   the `SessionManager`.

7. **Write response**: `{logsRoot}/{nodeId}/response.md`.

8. **Read status file**: Try to read and parse `{logsRoot}/{nodeId}/status.json`.
   If it exists, use `parseStatusFile()`. If not, fall back to CC result.

9. **Auto status**: If `node.autoStatus` is true and outcome status is
   undefined, default to success.

10. **Write final status**: Write the outcome as `status.json`.

```typescript
function buildStatusInstruction(
  statusFilePath: string,
  node: GraphNode,
  graph: Graph
): string
```

Returns the status file instruction template from SPEC.md Section 9.5.
Include the list of outgoing edge labels if available.

```typescript
function parseStatusFile(data: unknown, nodeId: string): Outcome
```

Validates the shape of the parsed JSON and maps fields:
- `outcome` → `status` (coerce to StageStatus)
- `preferred_next_label` → `preferredLabel`
- `suggested_next_ids` → `suggestedNextIds`
- `context_updates` → `contextUpdates`
- `notes` → `notes`
- If `outcome === "fail"`, set `failureReason` from `notes`.

```typescript
function parseEffort(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "high";
}
```

---

## Test Fixtures

### test/backend/cc-backend.test.ts

These tests mock the CC SDK's `query()` function to avoid real CC invocations.

```typescript
import { describe, it, expect, vi } from "vitest";
import { runCC } from "../../src/backend/cc-backend";

// We need to mock the SDK module.
// The exact mocking approach depends on the module system.
// vi.mock will intercept the import.

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
const mockQuery = vi.mocked(query);

// Helper to create a mock async generator
function mockGenerator(messages: any[]) {
  return (async function* () {
    for (const msg of messages) {
      yield msg;
    }
  })();
}

describe("runCC", () => {
  it("returns a successful CCResult", async () => {
    mockQuery.mockReturnValueOnce(mockGenerator([
      {
        type: "system",
        subtype: "init",
        session_id: "test-session-123",
      },
      {
        type: "assistant",
        message: { content: [{ type: "text", text: "Working on it..." }] },
      },
      {
        type: "result",
        subtype: "success",
        result: "Task completed successfully",
        session_id: "test-session-123",
        cost_usd: 0.05,
        num_turns: 3,
      },
    ]));

    const result = await runCC("Do something", { cwd: "/tmp" });

    expect(result.success).toBe(true);
    expect(result.text).toBe("Task completed successfully");
    expect(result.sessionId).toBe("test-session-123");
    expect(result.costUsd).toBe(0.05);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a failed CCResult on error subtype", async () => {
    mockQuery.mockReturnValueOnce(mockGenerator([
      {
        type: "system",
        subtype: "init",
        session_id: "test-session-456",
      },
      {
        type: "result",
        subtype: "error_max_turns",
        result: "Max turns reached",
        session_id: "test-session-456",
        cost_usd: 0.12,
        num_turns: 200,
      },
    ]));

    const result = await runCC("Do something complex", { cwd: "/tmp" });

    expect(result.success).toBe(false);
    expect(result.errorSubtype).toBe("error_max_turns");
    expect(result.sessionId).toBe("test-session-456");
  });

  it("forwards events via onEvent callback", async () => {
    const messages = [
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "assistant", message: { content: [] } },
      { type: "result", subtype: "success", result: "done", session_id: "s1", cost_usd: 0, num_turns: 1 },
    ];
    mockQuery.mockReturnValueOnce(mockGenerator(messages));

    const events: any[] = [];
    await runCC("test", { cwd: "/tmp" }, (event) => events.push(event));

    expect(events.length).toBe(messages.length);
  });

  it("handles generator errors gracefully", async () => {
    mockQuery.mockReturnValueOnce((async function* () {
      yield { type: "system", subtype: "init", session_id: "s-err" };
      throw new Error("CC crashed");
    })());

    const result = await runCC("test", { cwd: "/tmp" });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("CC crashed");
    expect(result.sessionId).toBe("s-err");
  });

  it("passes model and effort options to query", async () => {
    mockQuery.mockReturnValueOnce(mockGenerator([
      { type: "system", subtype: "init", session_id: "s2" },
      { type: "result", subtype: "success", result: "", session_id: "s2", cost_usd: 0, num_turns: 0 },
    ]));

    await runCC("test", {
      cwd: "/tmp",
      model: "claude-opus-4-6",
      reasoningEffort: "medium",
      maxTurns: 50,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "test",
        options: expect.objectContaining({
          model: "claude-opus-4-6",
          effort: "medium",
          maxTurns: 50,
        }),
      })
    );
  });

  it("passes resume option for session continuity", async () => {
    mockQuery.mockReturnValueOnce(mockGenerator([
      { type: "system", subtype: "init", session_id: "resumed-session" },
      { type: "result", subtype: "success", result: "resumed", session_id: "resumed-session", cost_usd: 0, num_turns: 1 },
    ]));

    await runCC("continue work", {
      cwd: "/tmp",
      resume: "previous-session-id",
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          resume: "previous-session-id",
        }),
      })
    );
  });

  it("passes system prompt append", async () => {
    mockQuery.mockReturnValueOnce(mockGenerator([
      { type: "system", subtype: "init", session_id: "s3" },
      { type: "result", subtype: "success", result: "", session_id: "s3", cost_usd: 0, num_turns: 0 },
    ]));

    await runCC("test", {
      cwd: "/tmp",
      systemPromptAppend: "Write status.json when done.",
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: expect.objectContaining({
            append: "Write status.json when done.",
          }),
        }),
      })
    );
  });
});
```

### test/handlers/codergen.test.ts

These tests mock the `runCC` function to test the handler's orchestration
logic without invoking real CC.

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Mock the CC backend
vi.mock("../../src/backend/cc-backend", () => ({
  runCC: vi.fn(),
}));

import { runCC } from "../../src/backend/cc-backend";
import { CodergenHandler } from "../../src/handlers/codergen";
import { SessionManager } from "../../src/backend/session-manager";
import { Context } from "../../src/model/context";
import { parse } from "../../src/parser/parser";
import type { CCResult } from "../../src/backend/cc-backend";

const mockRunCC = vi.mocked(runCC);

function makeCCResult(overrides: Partial<CCResult> = {}): CCResult {
  return {
    text: "Completed the task",
    sessionId: "session-abc",
    success: true,
    costUsd: 0.05,
    numTurns: 5,
    durationMs: 2000,
    ...overrides,
  };
}

describe("CodergenHandler", () => {
  let tmpDir: string;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-codergen-"));
    sessionManager = new SessionManager();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(logsRoot?: string) {
    return {
      graph: {} as any,
      cwd: tmpDir,
      logsRoot: logsRoot ?? path.join(tmpDir, "logs"),
      interviewer: { ask: async () => ({ value: "" }), inform: () => {} },
      ccPermissionMode: "bypassPermissions" as const,
    };
  }

  it("calls runCC with the node prompt", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Build feature"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        impl [shape=box, prompt="Implement the feature"]
        s -> impl -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult());

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    await handler.execute(graph.nodes.get("impl")!, new Context(), graph, config as any);

    expect(mockRunCC).toHaveBeenCalledOnce();
    const [prompt] = mockRunCC.mock.calls[0];
    expect(prompt).toContain("Implement the feature");
  });

  it("reads status.json when CC writes it", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do work"]
        s -> work -> e
      }
    `);

    const config = makeConfig();

    // Mock runCC to also write a status file
    mockRunCC.mockImplementationOnce(async (prompt, options) => {
      const stageDir = path.join(config.logsRoot, "work");
      await fs.mkdir(stageDir, { recursive: true });
      await fs.writeFile(
        path.join(stageDir, "status.json"),
        JSON.stringify({
          outcome: "success",
          notes: "All tests pass",
          context_updates: { "tests_passed": "true" },
          preferred_next_label: "Continue",
        })
      );
      return makeCCResult();
    });

    const handler = new CodergenHandler(sessionManager);
    const outcome = await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    expect(outcome.status).toBe("success");
    expect(outcome.notes).toBe("All tests pass");
    expect(outcome.contextUpdates?.["tests_passed"]).toBe("true");
    expect(outcome.preferredLabel).toBe("Continue");
  });

  it("falls back to CC result when no status.json", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do work"]
        s -> work -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult({ success: true, text: "Done!" }));

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    const outcome = await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    expect(outcome.status).toBe("success");
  });

  it("returns fail on CC failure with no status.json", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do work"]
        s -> work -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult({
      success: false,
      errorSubtype: "error_during_execution",
      errors: ["Something went wrong"],
    }));

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    const outcome = await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    expect(outcome.status).toBe("fail");
    expect(outcome.failureReason).toContain("Something went wrong");
  });

  it("writes prompt.md and response.md to stage directory", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do the work"]
        s -> work -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult({ text: "I did the work." }));

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    const promptContent = await fs.readFile(path.join(config.logsRoot, "work", "prompt.md"), "utf-8");
    expect(promptContent).toContain("Do the work");

    const responseContent = await fs.readFile(path.join(config.logsRoot, "work", "response.md"), "utf-8");
    expect(responseContent).toBe("I did the work.");
  });

  it("stores session ID for full fidelity nodes", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Work", fidelity="full", thread_id="main"]
        s -> work -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult({ sessionId: "new-session-xyz" }));

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    expect(sessionManager.getSessionId("main")).toBe("new-session-xyz");
  });

  it("resumes session for full fidelity with existing session", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Continue", fidelity="full", thread_id="main"]
        s -> work -> e
      }
    `);

    sessionManager.setSessionId("main", "existing-session-id");
    mockRunCC.mockResolvedValueOnce(makeCCResult({ sessionId: "existing-session-id" }));

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    // Verify that resume was passed to runCC
    const [, options] = mockRunCC.mock.calls[0];
    expect(options.resume).toBe("existing-session-id");
  });

  it("generates preamble for non-full fidelity", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Build feature"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do next step", fidelity="compact"]
        s -> work -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult());

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    // The prompt should include preamble content
    const [prompt] = mockRunCC.mock.calls[0];
    expect(prompt).toContain("Pipeline Context");
    expect(prompt).toContain("Build feature");
    expect(prompt).toContain("Do next step");
  });

  it("expands $goal in prompts", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Build auth"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Implement: $goal"]
        s -> work -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult());

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    const [prompt] = mockRunCC.mock.calls[0];
    expect(prompt).toContain("Implement: Build auth");
  });

  it("appends status instruction to system prompt", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do work"]
        s -> work -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult());

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    const [, options] = mockRunCC.mock.calls[0];
    expect(options.systemPromptAppend).toContain("PIPELINE INTEGRATION");
    expect(options.systemPromptAppend).toContain("status.json");
    expect(options.systemPromptAppend).toContain("outcome");
  });

  it("includes outgoing edge labels in status instruction", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do work"]
        fix  [shape=box, prompt="Fix"]
        s -> work
        work -> e [label="Done"]
        work -> fix [label="Fix issues"]
        fix -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult());

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    const [, options] = mockRunCC.mock.calls[0];
    expect(options.systemPromptAppend).toContain("Done");
    expect(options.systemPromptAppend).toContain("Fix issues");
  });
});

describe("buildStatusInstruction", () => {
  // Import the function directly for focused tests
  // (Assuming it's exported from codergen.ts)

  it("includes the status file path", async () => {
    // This is implicitly tested above via systemPromptAppend
    // but can be tested directly if buildStatusInstruction is exported
  });
});

describe("parseStatusFile", () => {
  // Import the function directly for focused tests
  // (Assuming it's exported from codergen.ts)

  it("parses a valid status file", () => {
    // Tested implicitly via the "reads status.json" test above
    // Direct tests can be added if parseStatusFile is exported
  });
});
```

---

## Completion Criteria

- [ ] `runCC()` calls the CC SDK's `query()` and consumes the async generator
- [ ] `runCC()` captures sessionId from SDKSystemMessage init
- [ ] `runCC()` returns CCResult with correct success/fail status
- [ ] `runCC()` forwards events via onEvent callback
- [ ] `runCC()` handles generator errors gracefully
- [ ] `runCC()` passes model, effort, maxTurns, resume, systemPromptAppend to SDK
- [ ] `runCC()` enforces timeout via AbortController
- [ ] CodergenHandler builds prompt from node.prompt or node.label
- [ ] CodergenHandler expands `$goal` in prompts
- [ ] CodergenHandler resolves fidelity and session correctly
- [ ] CodergenHandler resumes existing sessions for `full` fidelity
- [ ] CodergenHandler generates preamble for non-full fidelity
- [ ] CodergenHandler builds and appends status file instruction
- [ ] CodergenHandler reads status.json when present
- [ ] CodergenHandler falls back to CC result when status.json absent
- [ ] CodergenHandler writes prompt.md and response.md to stage directory
- [ ] CodergenHandler tracks session ID in SessionManager
- [ ] `parseStatusFile()` correctly maps status file fields to Outcome
- [ ] `buildStatusInstruction()` includes edge labels when available
- [ ] All Phase 1-6 tests still pass
- [ ] All tests pass: `npx vitest run`
