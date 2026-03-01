import { parseCondition } from "./parser.js";
import type { Outcome } from "../model/outcome.js";
import type { Context } from "../model/context.js";

export function resolveKey(
  key: string,
  outcome: Outcome,
  context: Context
): string {
  if (key === "outcome") return outcome.status ?? "";
  if (key === "preferred_label") return outcome.preferredLabel ?? "";
  if (key.startsWith("context.")) {
    if (context.has(key)) return context.getString(key);
    return context.getString(key.slice(8));
  }
  return context.getString(key);
}

export function evaluateCondition(
  condition: string,
  outcome: Outcome,
  context: Context
): boolean {
  if (condition.trim() === "") return true;

  const clauses = parseCondition(condition);
  for (const clause of clauses) {
    const resolved = resolveKey(clause.key, outcome, context);
    if (clause.operator === "=") {
      if (resolved !== clause.value) return false;
    } else {
      // !=
      if (resolved === clause.value) return false;
    }
  }
  return true;
}
