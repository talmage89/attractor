import type { Graph } from "../model/graph.js";
import type { Diagnostic } from "./diagnostic.js";
import { BUILT_IN_RULES, type LintRule } from "./rules.js";

export function validate(graph: Graph, extraRules?: LintRule[]): Diagnostic[] {
  const rules = [...BUILT_IN_RULES, ...(extraRules ?? [])];
  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule(graph));
  }
  return diagnostics;
}

export function validateOrThrow(graph: Graph, extraRules?: LintRule[]): Diagnostic[] {
  const diagnostics = validate(graph, extraRules);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    const messages = errors.map((d) => `[${d.rule}] ${d.message}`).join("\n");
    throw new Error(`Validation failed:\n${messages}`);
  }
  return diagnostics;
}
