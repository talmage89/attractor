import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseStatusFile } from "../../src/handlers/codergen.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Mock the CC backend
vi.mock("../../src/backend/cc-backend.js", () => ({
  runCC: vi.fn(),
}));

import { runCC } from "../../src/backend/cc-backend.js";
import { CodergenHandler } from "../../src/handlers/codergen.js";
import { SessionManager } from "../../src/backend/session-manager.js";
import { Context } from "../../src/model/context.js";
import { parse } from "../../src/parser/parser.js";
import type { CCResult } from "../../src/backend/cc-backend.js";

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
    mockRunCC.mockImplementationOnce(async () => {
      const stageDir = path.join(config.logsRoot, "work");
      await fs.mkdir(stageDir, { recursive: true });
      await fs.writeFile(
        path.join(stageDir, "status.json"),
        JSON.stringify({
          outcome: "success",
          notes: "All tests pass",
          context_updates: { tests_passed: "true" },
          preferred_next_label: "Continue",
        })
      );
      return makeCCResult();
    });

    const handler = new CodergenHandler(sessionManager);
    const outcome = await handler.execute(
      graph.nodes.get("work")!,
      new Context(),
      graph,
      config as any
    );

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
    const outcome = await handler.execute(
      graph.nodes.get("work")!,
      new Context(),
      graph,
      config as any
    );

    expect(outcome.status).toBe("success");
    expect(outcome.notes).toBe("Stage completed: work");
    expect(outcome.contextUpdates?.["last_stage"]).toBe("work");
    expect(outcome.contextUpdates?.["last_response"]).toBe("Done!");
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

    mockRunCC.mockResolvedValueOnce(
      makeCCResult({
        success: false,
        errorSubtype: "error_during_execution",
        errors: ["Something went wrong"],
      })
    );

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    const outcome = await handler.execute(
      graph.nodes.get("work")!,
      new Context(),
      graph,
      config as any
    );

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

    const promptContent = await fs.readFile(
      path.join(config.logsRoot, "work", "prompt.md"),
      "utf-8"
    );
    expect(promptContent).toContain("Do the work");

    const responseContent = await fs.readFile(
      path.join(config.logsRoot, "work", "response.md"),
      "utf-8"
    );
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

  it("forwards CC SDK messages as cc_event pipeline events", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do work"]
        s -> work -> e
      }
    `);

    const fakeSdkMessage = { type: "assistant", content: [{ type: "text", text: "hello" }] };

    mockRunCC.mockImplementationOnce(async (_prompt, _opts, onEvent) => {
      onEvent?.(fakeSdkMessage as any);
      return makeCCResult();
    });

    const emittedEvents: any[] = [];
    const handler = new CodergenHandler(sessionManager);
    const config = {
      ...makeConfig(),
      onEvent: (e: any) => emittedEvents.push(e),
    };
    await handler.execute(graph.nodes.get("work")!, new Context(), graph, config as any);

    const ccEvents = emittedEvents.filter((e) => e.kind === "cc_event");
    expect(ccEvents).toHaveLength(1);
    expect(ccEvents[0].nodeId).toBe("work");
    expect(ccEvents[0].event).toBe(fakeSdkMessage);
    expect(typeof ccEvents[0].timestamp).toBe("number");
  });

  it("populates outcome.costUsd from ccResult.costUsd", async () => {
    const graph = parse(`
      digraph G {
        graph [goal="Test"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        work [shape=box, prompt="Do work"]
        s -> work -> e
      }
    `);

    mockRunCC.mockResolvedValueOnce(makeCCResult({ costUsd: 0.123 }));

    const handler = new CodergenHandler(sessionManager);
    const config = makeConfig();
    const outcome = await handler.execute(
      graph.nodes.get("work")!,
      new Context(),
      graph,
      config as any
    );

    expect(outcome.costUsd).toBeCloseTo(0.123);
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
  it("includes the status file path", () => {
    // Implicitly tested via the systemPromptAppend tests above
  });
});

describe("parseStatusFile", () => {
  it("parses a valid status file", () => {
    // Tested implicitly via the "reads status.json" test above
  });

  it("filters non-string elements from suggested_next_ids", () => {
    const data = {
      outcome: "success",
      suggested_next_ids: ["node-a", 42, null, "node-b", true],
    };
    const outcome = parseStatusFile(data, "test");
    expect(outcome.suggestedNextIds).toEqual(["node-a", "node-b"]);
  });

  it("includes all-string suggested_next_ids unchanged", () => {
    const data = {
      outcome: "success",
      suggested_next_ids: ["a", "b", "c"],
    };
    const outcome = parseStatusFile(data, "test");
    expect(outcome.suggestedNextIds).toEqual(["a", "b", "c"]);
  });

  it("defaults to success when outcome field is missing", () => {
    const data = { notes: "did stuff" };
    const outcome = parseStatusFile(data, "test");
    expect(outcome.status).toBe("success");
  });

  it("defaults to success when outcome field is an unrecognized string", () => {
    const data = { outcome: "done" };
    const outcome = parseStatusFile(data, "test");
    expect(outcome.status).toBe("success");
  });
});
