import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { saveCheckpoint, loadCheckpoint } from "../../src/model/checkpoint.js";
import { Context } from "../../src/model/context.js";

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

  it("can be used to resume a run from a saved checkpoint", async () => {
    // Save a checkpoint representing a partially completed run
    const checkpoint = {
      timestamp: Date.now(),
      currentNode: "step2",
      completedNodes: ["step1"],
      nodeRetries: {},
      contextValues: { "graph.goal": "Test resume", outcome: "success" },
      sessionMap: {},
    };
    await saveCheckpoint(checkpoint, tmpDir);

    // Load and verify it can restore state
    const loaded = await loadCheckpoint(path.join(tmpDir, "checkpoint.json"));
    expect(loaded.currentNode).toBe("step2");
    expect(loaded.completedNodes).toEqual(["step1"]);
    expect(loaded.contextValues["outcome"]).toBe("success");

    // Restore into a Context
    const ctx = new Context();
    for (const [k, v] of Object.entries(loaded.contextValues)) {
      ctx.set(k, v);
    }
    expect(ctx.getString("outcome")).toBe("success");
    expect(ctx.getString("graph.goal")).toBe("Test resume");
  });
});
