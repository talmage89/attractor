import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ToolHandler, runShellCommand } from "../../src/handlers/tool.js";
import { Context } from "../../src/model/context.js";
import type { GraphNode } from "../../src/model/graph.js";

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

  it("captures stderr in context updates on success", async () => {
    const handler = new ToolHandler();
    // Command writes to stderr and stdout, exits 0
    const node = makeToolNode({ tool_command: "echo 'err output' >&2 && echo 'stdout output'" });
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    expect(outcome.status).toBe("success");
    expect(outcome.contextUpdates?.["tool.stderr"]).toContain("err output");
    expect(outcome.contextUpdates?.["tool.output"]).toContain("stdout output");
  });

  it("captures stderr in context updates on failure", async () => {
    const handler = new ToolHandler();
    // Command writes to stderr and exits nonzero
    const node = makeToolNode({ tool_command: "echo 'failure details' >&2; exit 2" });
    const outcome = await handler.execute(node, new Context(), {} as any, config(tmpDir) as any);
    expect(outcome.status).toBe("fail");
    expect(outcome.contextUpdates?.["tool.stderr"]).toContain("failure details");
  });

  it("resolves with fail (not rejects) when cwd is a file path (ENOTDIR)", async () => {
    // spawn() throws synchronously with ENOTDIR when cwd is a file, not a directory.
    // Without the try/catch fix, this would reject the Promise, causing executeWithRetry
    // to treat it as a transient error and retry 50 times.
    const file = path.join(tmpDir, "not-a-dir.txt");
    await fs.writeFile(file, "hello");
    // Should resolve (not reject) with a fail result
    const result = await runShellCommand("echo hello", { cwd: file, timeoutMs: 5000 });
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toMatch(/ENOTDIR|not a directory/i);
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
