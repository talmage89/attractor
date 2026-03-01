import type { Outcome } from "./outcome.js";

export interface Question {
  text: string;
  type: "yes_no" | "multiple_choice" | "freeform" | "confirmation";
  options?: { key: string; label: string }[];
  stage: string;
  timeoutSeconds?: number;
}

export interface Answer {
  value: string;
  selectedOption?: { key: string; label: string };
  text?: string;
}

export type PipelineEvent =
  | { kind: "pipeline_started"; name: string; goal: string; timestamp: number }
  | { kind: "pipeline_completed"; status: "success" | "fail"; durationMs: number; timestamp: number }
  | { kind: "stage_started"; nodeId: string; label: string; handlerType: string; timestamp: number }
  | { kind: "stage_completed"; nodeId: string; outcome: Outcome; durationMs: number; costUsd?: number; timestamp: number }
  | { kind: "stage_retrying"; nodeId: string; attempt: number; delayMs: number; timestamp: number }
  | { kind: "edge_selected"; from: string; to: string; label: string; reason: string; timestamp: number }
  | { kind: "goal_gate_check"; satisfied: boolean; failedNodeId?: string; timestamp: number }
  | { kind: "human_question"; question: Question; timestamp: number }
  | { kind: "human_answer"; answer: Answer; timestamp: number }
  | { kind: "checkpoint_saved"; nodeId: string; timestamp: number }
  | { kind: "parallel_started"; nodeId: string; branchCount: number; timestamp: number }
  | { kind: "parallel_branch_completed"; nodeId: string; branchIndex: number; outcome: Outcome; timestamp: number }
  | { kind: "parallel_completed"; nodeId: string; successCount: number; failCount: number; timestamp: number };
