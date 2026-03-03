export type StageStatus =
  | "success"
  | "partial_success"
  | "retry"
  | "fail"
  | "skipped";

export interface Outcome {
  status: StageStatus;
  preferredLabel?: string;
  suggestedNextIds?: string[];
  contextUpdates?: Record<string, unknown>;
  notes?: string;
  failureReason?: string;
  costUsd?: number;
}
