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
    const resolved = resolveKey(clause.key, outcome, context).trim();
    switch (clause.operator) {
      case "=":
        if (resolved !== clause.value) return false;
        break;
      case "!=":
        if (resolved === clause.value) return false;
        break;
      case ">":
      case ">=":
      case "<":
      case "<=": {
        const a = parseFloat(resolved);
        const b = parseFloat(clause.value);
        if (Number.isNaN(a) || Number.isNaN(b)) return false;
        if (clause.operator === ">" && !(a > b)) return false;
        if (clause.operator === ">=" && !(a >= b)) return false;
        if (clause.operator === "<" && !(a < b)) return false;
        if (clause.operator === "<=" && !(a <= b)) return false;
        break;
      }
    }
  }
  return true;
}
