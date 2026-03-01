import { describe, it, expect, vi } from "vitest";
import { runCC } from "../../src/backend/cc-backend.js";

// Mock the SDK module.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
const mockQuery = vi.mocked(query);

// Helper to create a mock async generator
function mockGenerator(messages: unknown[]) {
  return (async function* () {
    for (const msg of messages) {
      yield msg;
    }
  })();
}

describe("runCC", () => {
  it("returns a successful CCResult", async () => {
    mockQuery.mockReturnValueOnce(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockGenerator([
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
          total_cost_usd: 0.05,
          num_turns: 3,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    );

    const result = await runCC("Do something", { cwd: "/tmp" });

    expect(result.success).toBe(true);
    expect(result.text).toBe("Task completed successfully");
    expect(result.sessionId).toBe("test-session-123");
    expect(result.costUsd).toBe(0.05);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a failed CCResult on error subtype", async () => {
    mockQuery.mockReturnValueOnce(
      mockGenerator([
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
          total_cost_usd: 0.12,
          num_turns: 200,
          errors: [],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    );

    const result = await runCC("Do something complex", { cwd: "/tmp" });

    expect(result.success).toBe(false);
    expect(result.errorSubtype).toBe("error_max_turns");
    expect(result.sessionId).toBe("test-session-456");
  });

  it("forwards events via onEvent callback", async () => {
    const messages = [
      { type: "system", subtype: "init", session_id: "s1" },
      { type: "assistant", message: { content: [] } },
      {
        type: "result",
        subtype: "success",
        result: "done",
        session_id: "s1",
        total_cost_usd: 0,
        num_turns: 1,
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockQuery.mockReturnValueOnce(mockGenerator(messages) as any);

    const events: unknown[] = [];
    await runCC("test", { cwd: "/tmp" }, (event) => events.push(event));

    expect(events.length).toBe(messages.length);
  });

  it("handles generator errors gracefully", async () => {
    mockQuery.mockReturnValueOnce(
      (async function* () {
        yield { type: "system", subtype: "init", session_id: "s-err" };
        throw new Error("CC crashed");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      })() as any
    );

    const result = await runCC("test", { cwd: "/tmp" });

    expect(result.success).toBe(false);
    expect(result.errors).toContain("CC crashed");
    expect(result.sessionId).toBe("s-err");
  });

  it("passes model and effort options to query", async () => {
    mockQuery.mockReturnValueOnce(
      mockGenerator([
        { type: "system", subtype: "init", session_id: "s2" },
        {
          type: "result",
          subtype: "success",
          result: "",
          session_id: "s2",
          total_cost_usd: 0,
          num_turns: 0,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    );

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
    mockQuery.mockReturnValueOnce(
      mockGenerator([
        { type: "system", subtype: "init", session_id: "resumed-session" },
        {
          type: "result",
          subtype: "success",
          result: "resumed",
          session_id: "resumed-session",
          total_cost_usd: 0,
          num_turns: 1,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    );

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

  it("applies default model and maxTurns when not specified", async () => {
    mockQuery.mockReturnValueOnce(
      mockGenerator([
        { type: "system", subtype: "init", session_id: "s-def" },
        {
          type: "result",
          subtype: "success",
          result: "",
          session_id: "s-def",
          total_cost_usd: 0,
          num_turns: 1,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    );

    await runCC("test", { cwd: "/tmp" });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          model: "claude-sonnet-4-6",
          maxTurns: 200,
        }),
      })
    );
  });

  it("passes system prompt append", async () => {
    mockQuery.mockReturnValueOnce(
      mockGenerator([
        { type: "system", subtype: "init", session_id: "s3" },
        {
          type: "result",
          subtype: "success",
          result: "",
          session_id: "s3",
          total_cost_usd: 0,
          num_turns: 0,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    );

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
