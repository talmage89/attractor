import { describe, it, expect } from "vitest";
import { formatEvent } from "../../src/cli.js";
import type { PipelineEvent } from "../../src/model/events.js";

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
