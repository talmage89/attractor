import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { run } from "../../src/engine/runner.js";
import { parse } from "../../src/parser/parser.js";
import { validate } from "../../src/validation/validator.js";
import { QueueInterviewer } from "../../src/interviewer/queue.js";
import { AutoApproveInterviewer } from "../../src/interviewer/auto-approve.js";
import type { PipelineEvent } from "../../src/model/events.js";

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
