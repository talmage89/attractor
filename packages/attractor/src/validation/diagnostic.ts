import type { Span } from "../model/graph.js";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  rule: string;
  severity: Severity;
  message: string;
  nodeId?: string;
  edge?: { from: string; to: string };
  fix?: string;
  span?: Span;
}
