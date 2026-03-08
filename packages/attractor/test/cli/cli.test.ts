import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { formatEvent, cmdRun, cmdValidate, cmdVisualize } from "../../src/cli.js";
import type { PipelineEvent } from "../../src/model/events.js";

// Helper: thrown instead of calling process.exit() during tests
class ExitError extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
  }
}

// formatEvent is a pure function: given an event and a startTime, it produces
// a formatted string. All timestamp handling is relative to startTime so we
// use a fixed base and delta to produce predictable output.

const BASE = 1_000_000; // arbitrary fixed start time

function ts(deltaMs: number): number {
  return BASE + deltaMs;
}

describe("formatEvent", () => {
  it("formats pipeline_started", () => {
    const event: PipelineEvent = {
      kind: "pipeline_started",
      name: "my-pipeline",
      goal: "Build the feature",
      timestamp: ts(0),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:00]");
    expect(result).toContain("Pipeline started");
    expect(result).toContain('"Build the feature"');
  });

  it("formats stage_started", () => {
    const event: PipelineEvent = {
      kind: "stage_started",
      nodeId: "plan",
      label: "Plan",
      handlerType: "codergen",
      timestamp: ts(5_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:05]");
    expect(result).toContain("plan");
    expect(result).toContain("running...");
  });

  it("formats stage_completed with success and duration", () => {
    const event: PipelineEvent = {
      kind: "stage_completed",
      nodeId: "implement",
      outcome: { status: "success" },
      durationMs: 12_300,
      timestamp: ts(20_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:20]");
    expect(result).toContain("implement");
    expect(result).toContain("success");
    expect(result).toContain("12.3s");
  });

  it("formats stage_completed includes cost when provided", () => {
    const event: PipelineEvent = {
      kind: "stage_completed",
      nodeId: "review",
      outcome: { status: "fail" },
      durationMs: 3_000,
      costUsd: 0.05,
      timestamp: ts(30_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("$0.05");
    expect(result).toContain("fail");
    expect(result).toContain("3.0s");
  });

  it("formats stage_completed omits cost when absent", () => {
    const event: PipelineEvent = {
      kind: "stage_completed",
      nodeId: "step",
      outcome: { status: "success" },
      durationMs: 1_000,
      timestamp: ts(0),
    };
    const result = formatEvent(event, BASE);
    expect(result).not.toContain("$");
  });

  it("formats edge_selected", () => {
    const event: PipelineEvent = {
      kind: "edge_selected",
      from: "gate",
      to: "path_a",
      label: "yes",
      reason: "condition matched",
      timestamp: ts(10_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:10]");
    expect(result).toContain('"yes"');
    expect(result).toContain("path_a");
  });

  it("formats human_question", () => {
    const event: PipelineEvent = {
      kind: "human_question",
      question: {
        text: "Should we proceed?",
        type: "yes_no",
        stage: "review",
      },
      timestamp: ts(45_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:45]");
    expect(result).toContain("[?]");
    expect(result).toContain("Should we proceed?");
  });

  it("formats pipeline_completed with success", () => {
    const event: PipelineEvent = {
      kind: "pipeline_completed",
      status: "success",
      durationMs: 125_000,
      timestamp: ts(125_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("Pipeline completed");
    expect(result).toContain("success");
    // 125s = 2m 5s
    expect(result).toContain("2m 5s");
  });

  it("formats pipeline_completed with fail", () => {
    const event: PipelineEvent = {
      kind: "pipeline_completed",
      status: "fail",
      durationMs: 61_000,
      timestamp: ts(61_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("fail");
    expect(result).toContain("1m 1s");
  });

  it("formats timestamp correctly at 1 hour mark (edge: minute padding)", () => {
    const event: PipelineEvent = {
      kind: "pipeline_started",
      name: "p",
      goal: "g",
      timestamp: ts(3_600_000), // 60 minutes
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[60:00]");
  });

  it("formats error event with message", () => {
    const event: PipelineEvent = {
      kind: "error",
      message: "handler crashed unexpectedly",
      nodeId: "build",
      timestamp: ts(15_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:15]");
    expect(result).toContain("✗");
    expect(result).toContain("handler crashed unexpectedly");
  });

  it("formats parallel_started", () => {
    const event: PipelineEvent = {
      kind: "parallel_started",
      nodeId: "fanout",
      branchCount: 3,
      timestamp: ts(5_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:05]");
    expect(result).toContain("⊞");
    expect(result).toContain("fanout");
    expect(result).toContain("parallel");
    expect(result).toContain("3 branches");
  });

  it("formats parallel_branch_completed", () => {
    const event: PipelineEvent = {
      kind: "parallel_branch_completed",
      nodeId: "branch_a",
      branchIndex: 1,
      totalBranches: 4,
      outcome: { status: "success" },
      timestamp: ts(10_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:10]");
    expect(result).toContain("├");
    expect(result).toContain("branch_a");
    expect(result).toContain("success");
    expect(result).toContain("branch 2/4");
  });

  it("formats parallel_completed", () => {
    const event: PipelineEvent = {
      kind: "parallel_completed",
      nodeId: "fanout",
      successCount: 2,
      failCount: 1,
      timestamp: ts(15_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:15]");
    expect(result).toContain("⊞");
    expect(result).toContain("fanout");
    expect(result).toContain("done");
    expect(result).toContain("2 succeeded");
    expect(result).toContain("1 failed");
  });

  it("formats cc_event with assistant message", () => {
    const event: PipelineEvent = {
      kind: "cc_event",
      nodeId: "build",
      event: {
        type: "assistant",
        message: { model: "claude-sonnet-4-6", usage: { output_tokens: 150 } },
      } as never,
      timestamp: ts(8_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:08]");
    expect(result).toContain("[cc_event]");
    expect(result).toContain("assistant");
    expect(result).toContain("claude-sonnet-4-6");
    expect(result).toContain("150 tokens");
  });

  it("formats cc_event with result message", () => {
    const event: PipelineEvent = {
      kind: "cc_event",
      nodeId: "build",
      event: {
        type: "result",
        subtype: "success",
        duration_ms: 1200,
        total_cost_usd: 0.0035,
      } as never,
      timestamp: ts(12_000),
    };
    const result = formatEvent(event, BASE);
    expect(result).toContain("[cc_event]");
    expect(result).toContain("result");
    expect(result).toContain("success");
    expect(result).toContain("1200ms");
    expect(result).toContain("$0.0035");
  });

  it("handles unknown event kind via default branch", () => {
    // Simulate a future event kind that the switch doesn't cover
    const event = {
      kind: "new_future_event",
      timestamp: ts(0),
    } as unknown as PipelineEvent;
    const result = formatEvent(event, BASE);
    expect(result).toContain("[00:00]");
    expect(result).toContain("new_future_event");
  });

  it("includes timestamp prefix on every event", () => {
    const events: PipelineEvent[] = [
      { kind: "pipeline_started", name: "p", goal: "g", timestamp: ts(0) },
      { kind: "stage_started", nodeId: "n", label: "N", handlerType: "t", timestamp: ts(0) },
      { kind: "stage_completed", nodeId: "n", outcome: { status: "success" }, durationMs: 0, timestamp: ts(0) },
      { kind: "edge_selected", from: "a", to: "b", label: "e", reason: "r", timestamp: ts(0) },
      { kind: "human_question", question: { text: "q?", type: "yes_no", stage: "s" }, timestamp: ts(0) },
      { kind: "pipeline_completed", status: "success", durationMs: 0, timestamp: ts(0) },
    ];
    for (const event of events) {
      const result = formatEvent(event, BASE);
      expect(result).toMatch(/^\[0\d:\d\d\]/);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures used by cmdRun / cmdValidate tests
// ---------------------------------------------------------------------------

const VALID_PIPELINE = `
digraph G {
  s [shape=Mdiamond]
  e [shape=Msquare]
  s -> e
}
`;

const INVALID_PIPELINE = `
digraph G {
  a [shape=box]
  e [shape=Msquare]
  a -> e
}
`;

// Pipeline that uses $goal — transforms expand it before validation.
const GOAL_PIPELINE = `
digraph G {
  graph [goal="Test goal"]
  s [shape=Mdiamond]
  e [shape=Msquare]
  step [shape=box, prompt="Do the work for: $goal"]
  s -> step -> e
}
`;

// ---------------------------------------------------------------------------
// cmdValidate tests
// ---------------------------------------------------------------------------

describe("cmdValidate", () => {
  let tmpDir: string;
  let stderrOutput: string;
  let stdoutOutput: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-cli-validate-"));
    stderrOutput = "";
    stdoutOutput = "";
    vi.spyOn(process, "exit").mockImplementation((code?: number): never => {
      throw new ExitError(code ?? 0);
    });
    vi.spyOn(process.stderr, "write").mockImplementation((data: unknown) => {
      stderrOutput += String(data);
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data: unknown) => {
      stdoutOutput += String(data);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 0 for a valid pipeline and prints no errors", async () => {
    const dotfile = path.join(tmpDir, "valid.dot");
    await fs.writeFile(dotfile, VALID_PIPELINE);

    let exitCode: number | undefined;
    try {
      await cmdValidate([dotfile]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(0);
    expect(stdoutOutput).not.toContain("[error]");
  });

  it("exits 2 for an invalid pipeline (missing start node) and prints error diagnostics", async () => {
    const dotfile = path.join(tmpDir, "invalid.dot");
    await fs.writeFile(dotfile, INVALID_PIPELINE);

    let exitCode: number | undefined;
    try {
      await cmdValidate([dotfile]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(2);
    expect(stdoutOutput).toContain("[error]");
  });

  it("exits 3 when dotfile argument is missing", async () => {
    let exitCode: number | undefined;
    try {
      await cmdValidate([]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(3);
    expect(stderrOutput).toContain("Usage:");
  });

  it("exits 3 when the dotfile cannot be read", async () => {
    const missing = path.join(tmpDir, "does-not-exist.dot");
    let exitCode: number | undefined;
    try {
      await cmdValidate([missing]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(3);
    expect(stderrOutput).toContain("Error:");
  });

  it("applies transforms before validating (no false errors from unexpanded $goal)", async () => {
    const dotfile = path.join(tmpDir, "goal.dot");
    await fs.writeFile(dotfile, GOAL_PIPELINE);

    let exitCode: number | undefined;
    try {
      await cmdValidate([dotfile]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(0);
  });

  it("no false-positive prompt_file_not_found when dotfile is inside .attractor/", async () => {
    // Conventional layout: DAG at .attractor/pipeline.dag, prompt at .attractor/prompts/step.md
    const dotDir = path.join(tmpDir, ".attractor");
    const promptDir = path.join(dotDir, "prompts");
    await fs.mkdir(promptDir, { recursive: true });
    await fs.writeFile(path.join(promptDir, "step.md"), "# step prompt");

    const dag = `
digraph G {
  s [shape=Mdiamond]
  step [shape=box, prompt_file="prompts/step.md"]
  e [shape=Msquare]
  s -> step -> e
}
`;
    const dotfile = path.join(dotDir, "pipeline.dag");
    await fs.writeFile(dotfile, dag);

    let exitCode: number | undefined;
    try {
      await cmdValidate([dotfile]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(0);
    expect(stdoutOutput).not.toContain("prompt_file_not_found");
  });
});

// ---------------------------------------------------------------------------
// cmdRun tests
// ---------------------------------------------------------------------------

describe("cmdRun", () => {
  let tmpDir: string;
  let stderrOutput: string;
  let stdoutOutput: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-cli-run-"));
    stderrOutput = "";
    stdoutOutput = "";
    vi.spyOn(process, "exit").mockImplementation((code?: number): never => {
      throw new ExitError(code ?? 0);
    });
    vi.spyOn(process.stderr, "write").mockImplementation((data: unknown) => {
      stderrOutput += String(data);
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data: unknown) => {
      stdoutOutput += String(data);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 3 when dotfile argument is missing", async () => {
    let exitCode: number | undefined;
    try {
      await cmdRun([]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(3);
    expect(stderrOutput).toContain("Usage:");
  });

  it("exits 3 when the dotfile cannot be read", async () => {
    const missing = path.join(tmpDir, "does-not-exist.dot");
    let exitCode: number | undefined;
    try {
      await cmdRun([missing]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(3);
    expect(stderrOutput).toContain("Error:");
  });

  it("exits 2 for an invalid pipeline and prints error diagnostics to stderr", async () => {
    const dotfile = path.join(tmpDir, "invalid.dot");
    await fs.writeFile(dotfile, INVALID_PIPELINE);

    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(2);
    expect(stderrOutput).toContain("[error]");
  });

  it("runs a valid minimal pipeline and exits 0", async () => {
    const dotfile = path.join(tmpDir, "valid.dot");
    await fs.writeFile(dotfile, VALID_PIPELINE);
    const logsRoot = path.join(tmpDir, "logs");

    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", tmpDir, "--logs", logsRoot]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(0);
    expect(stdoutOutput).toContain("success");
  });

  it("applies transforms before validating — regression for FINDING-001", async () => {
    // A pipeline using $goal: transforms expand it before validate() is called.
    // Both cmdValidate and cmdRun must produce the same zero-error result.
    const dotfile = path.join(tmpDir, "goal.dot");
    await fs.writeFile(dotfile, GOAL_PIPELINE);
    const logsRoot = path.join(tmpDir, "logs");

    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", tmpDir, "--logs", logsRoot]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    // Valid pipeline must never hit exit(2) — that would mean validation failed
    expect(exitCode).not.toBe(2);
    // Should succeed
    expect(exitCode).toBe(0);
  });

  it("--resume-last with --cwd finds checkpoint in the specified project directory", async () => {
    // Create a project directory with a run checkpoint — simulates a prior run.
    const projectDir = path.join(tmpDir, "myproject");
    const runsDir = path.join(projectDir, ".attractor", "runs", "2026-01-15T00-00-00-000Z");
    await fs.mkdir(runsDir, { recursive: true });

    const checkpoint = {
      timestamp: 1704067200000,
      currentNode: "work",
      completedNodes: ["start"],
      nodeOutcomes: [],
      nodeRetries: {},
      contextValues: {},
      sessionMap: {},
      goalGateRetries: 0,
    };
    await fs.writeFile(
      path.join(runsDir, "checkpoint.json"),
      JSON.stringify(checkpoint)
    );

    // Write a minimal pipeline dag into the project directory
    const dotfile = path.join(projectDir, "test.dag");
    await fs.writeFile(dotfile, VALID_PIPELINE);
    const logsRoot = path.join(tmpDir, "logs");

    // Run from a different directory (tmpDir) with --cwd pointing to the project.
    // Before the fix, findLastCheckpoint() used process.cwd() and would not find
    // the checkpoint in projectDir.
    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", projectDir, "--logs", logsRoot, "--resume-last"]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }

    // Should NOT exit 3 with "No previous runs found" — the checkpoint should be found.
    // The "work" node is not an exit node, so resume proceeds and exits 0 (simple pipeline).
    expect(stderrOutput).not.toContain("No previous runs found");
    expect(exitCode).not.toBe(3);
  });

  it("default logsRoot is written under --cwd directory, not process.cwd()", async () => {
    // Create a project dir separate from process.cwd().
    const projectDir = path.join(tmpDir, "myproject");
    await fs.mkdir(projectDir, { recursive: true });

    const dotfile = path.join(projectDir, "test.dag");
    await fs.writeFile(dotfile, VALID_PIPELINE);

    // Run WITHOUT --logs so that the default logsRoot is used.
    // The pipeline exits 0 (start→exit), so a checkpoint will be written.
    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", projectDir]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(0);

    // Checkpoint must be under projectDir/.attractor/runs/, NOT under tmpDir/.attractor/runs/.
    const projectRuns = path.join(projectDir, ".attractor", "runs");
    const callerRuns = path.join(tmpDir, ".attractor", "runs");

    const projectEntries = await fs.readdir(projectRuns).catch(() => []);
    const callerEntries = await fs.readdir(callerRuns).catch(() => []);

    expect(projectEntries.length).toBeGreaterThan(0); // checkpoint in project dir
    expect(callerEntries.length).toBe(0);             // nothing in caller dir
  });
});

// ---------------------------------------------------------------------------
// --resume-last tests
// ---------------------------------------------------------------------------

describe("cmdRun --resume-last", () => {
  let tmpDir: string;
  let stderrOutput: string;
  let stdoutOutput: string;
  let origCwd: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-cli-resume-last-"));
    origCwd = process.cwd();
    stderrOutput = "";
    stdoutOutput = "";
    vi.spyOn(process, "exit").mockImplementation((code?: number): never => {
      throw new ExitError(code ?? 0);
    });
    vi.spyOn(process.stderr, "write").mockImplementation((data: unknown) => {
      stderrOutput += String(data);
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation((data: unknown) => {
      stdoutOutput += String(data);
      return true;
    });
  });

  afterEach(async () => {
    process.chdir(origCwd);
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 3 when both --resume and --resume-last are provided", async () => {
    const dotfile = path.join(tmpDir, "valid.dot");
    await fs.writeFile(dotfile, VALID_PIPELINE);
    const logsRoot = path.join(tmpDir, "logs");

    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", tmpDir, "--logs", logsRoot, "--resume", "some.json", "--resume-last"]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(3);
    expect(stderrOutput).toContain("mutually exclusive");
  });

  it("exits 3 with clear message when no prior runs exist", async () => {
    const dotfile = path.join(tmpDir, "valid.dot");
    await fs.writeFile(dotfile, VALID_PIPELINE);
    const logsRoot = path.join(tmpDir, "logs");

    // No .attractor/runs/ directory — ensure cwd is tmpDir
    process.chdir(tmpDir);

    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", tmpDir, "--logs", logsRoot, "--resume-last"]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(3);
    expect(stderrOutput).toContain("No previous runs found");
  });

  it("exits 0 with 'nothing to resume' when last checkpoint is at an exit node", async () => {
    const dotfile = path.join(tmpDir, "valid.dot");
    await fs.writeFile(dotfile, VALID_PIPELINE);
    const logsRoot = path.join(tmpDir, "logs");

    // VALID_PIPELINE: s [shape=Mdiamond], e [shape=Msquare], s -> e
    // currentNode=e is Msquare (exit node) → pipeline completed
    const runDir = path.join(tmpDir, ".attractor", "runs", "2025-01-01T00-00-00-000Z");
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, "checkpoint.json"),
      JSON.stringify({
        timestamp: Date.now(),
        currentNode: "e",
        completedNodes: ["s", "e"],
        nodeOutcomes: {},
        nodeRetries: {},
        contextValues: {},
        sessionMap: {},
      })
    );

    process.chdir(tmpDir);
    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", tmpDir, "--logs", logsRoot, "--resume-last"]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(0);
    expect(stdoutOutput).toContain("nothing to resume");
  });

  it("does NOT say 'nothing to resume' when exit node reached but goal gate failed", async () => {
    // Pipeline with a goal_gate=true node. If that node failed, the pipeline
    // failed even though currentNode points to the exit node.
    const dagWithGate = `
digraph G {
  s [shape=Mdiamond]
  step1 [goal_gate=true]
  e [shape=Msquare]
  s -> step1
  step1 -> e
}
`;
    const dotfile = path.join(tmpDir, "gate.dot");
    await fs.writeFile(dotfile, dagWithGate);
    const logsRoot = path.join(tmpDir, "logs");

    // Checkpoint: at exit node "e", but step1 (goal_gate=true) failed
    const runDir = path.join(tmpDir, ".attractor", "runs", "2025-01-01T00-00-00-000Z");
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, "checkpoint.json"),
      JSON.stringify({
        timestamp: Date.now(),
        currentNode: "e",
        completedNodes: ["step1"],
        nodeOutcomes: { step1: { status: "fail" } },
        nodeRetries: {},
        contextValues: {},
        sessionMap: {},
      })
    );

    process.chdir(tmpDir);
    // Should NOT exit 0 with "nothing to resume" — pipeline actually failed
    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", tmpDir, "--logs", logsRoot, "--resume-last", "--auto-approve"]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    // Must not report "nothing to resume"
    expect(stdoutOutput).not.toContain("nothing to resume");
  });

  it("picks the most recent run directory (lexicographic descending)", async () => {
    const dotfile = path.join(tmpDir, "valid.dot");
    await fs.writeFile(dotfile, VALID_PIPELINE);
    const logsRoot = path.join(tmpDir, "logs");

    // Create two run dirs; the later timestamp should be preferred
    const olderDir = path.join(tmpDir, ".attractor", "runs", "2025-01-01T00-00-00-000Z");
    const newerDir = path.join(tmpDir, ".attractor", "runs", "2025-06-01T00-00-00-000Z");
    await fs.mkdir(olderDir, { recursive: true });
    await fs.mkdir(newerDir, { recursive: true });

    // Older run: mid-way at node "s" (start, not exit)
    await fs.writeFile(
      path.join(olderDir, "checkpoint.json"),
      JSON.stringify({
        timestamp: 1000,
        currentNode: "s",
        completedNodes: [],
        nodeOutcomes: {},
        nodeRetries: {},
        contextValues: {},
        sessionMap: {},
      })
    );

    // Newer run: completed at exit node "e"
    await fs.writeFile(
      path.join(newerDir, "checkpoint.json"),
      JSON.stringify({
        timestamp: 2000,
        currentNode: "e",
        completedNodes: ["s", "e"],
        nodeOutcomes: {},
        nodeRetries: {},
        contextValues: {},
        sessionMap: {},
      })
    );

    process.chdir(tmpDir);
    let exitCode: number | undefined;
    try {
      await cmdRun([dotfile, "--cwd", tmpDir, "--logs", logsRoot, "--resume-last"]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    // Newer run is at exit node → "nothing to resume"
    expect(exitCode).toBe(0);
    expect(stdoutOutput).toContain("nothing to resume");
  });
});

// ---------------------------------------------------------------------------
// cmdVisualize tests
// ---------------------------------------------------------------------------

describe("cmdVisualize", () => {
  let tmpDir: string;
  let stderrOutput: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "attractor-cli-visualize-"));
    stderrOutput = "";
    vi.spyOn(process, "exit").mockImplementation((code?: number): never => {
      throw new ExitError(code ?? 0);
    });
    vi.spyOn(process.stderr, "write").mockImplementation((data: unknown) => {
      stderrOutput += String(data);
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exits 3 when dotfile argument is missing", async () => {
    let exitCode: number | undefined;
    try {
      await cmdVisualize([]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(3);
    expect(stderrOutput).toContain("Usage:");
  });

  it("exits 3 when dotfile cannot be read", async () => {
    const missing = path.join(tmpDir, "does-not-exist.dot");
    let exitCode: number | undefined;
    try {
      await cmdVisualize([missing]);
    } catch (e) {
      exitCode = (e as ExitError).code;
    }
    expect(exitCode).toBe(3);
    expect(stderrOutput).toContain("Error:");
  });
});
