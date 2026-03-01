import type { Graph, GraphNode, Edge } from "../model/graph.js";
import type { Outcome } from "../model/outcome.js";
import type { Context } from "../model/context.js";
import { outgoingEdges } from "../model/graph.js";
import { evaluateCondition } from "../conditions/evaluator.js";

/**
 * Normalize a label for preferred-label matching.
 * Lowercase, trim, then strip accelerator prefixes:
 *   [X] Label  →  strip "[X] " prefix
 *   X) Label   →  strip "X) " prefix
 *   X - Label  →  strip "X - " prefix
 */
export function normalizeLabel(label: string): string {
  let s = label.trim().toLowerCase();
  // [X] Label
  s = s.replace(/^\[\w\]\s+/, "");
  // X) Label
  s = s.replace(/^\w\)\s+/, "");
  // X - Label
  s = s.replace(/^\w\s+-\s+/, "");
  return s.trim();
}

/**
 * Select the next edge from the given node based on the 5-step priority algorithm.
 * Returns null if no outgoing edges exist.
 */
export function selectEdge(
  graph: Graph,
  node: GraphNode,
  outcome: Outcome,
  context: Context
): Edge | null {
  const edges = outgoingEdges(graph, node.id);
  if (edges.length === 0) return null;

  // Step 1: Condition matching
  const conditionMatched = edges.filter(
    (e) => e.condition.trim() !== "" && evaluateCondition(e.condition, outcome, context)
  );
  if (conditionMatched.length > 0) {
    return bestByWeightThenLexical(conditionMatched);
  }

  // Step 2: Preferred label matching
  if (outcome.preferredLabel && outcome.preferredLabel.trim() !== "") {
    const normalizedTarget = normalizeLabel(outcome.preferredLabel);
    for (const e of edges) {
      if (normalizeLabel(e.label) === normalizedTarget) {
        return e;
      }
    }
  }

  // Step 3: Suggested next IDs
  if (outcome.suggestedNextIds && outcome.suggestedNextIds.length > 0) {
    for (const suggestedId of outcome.suggestedNextIds) {
      const match = edges.find((e) => e.to === suggestedId);
      if (match) return match;
    }
  }

  // Steps 4 & 5: Among unconditional edges only (empty condition string)
  const unconditional = edges.filter((e) => e.condition.trim() === "");
  if (unconditional.length === 0) return null;

  return bestByWeightThenLexical(unconditional);
}

/** Return the edge with the highest weight, breaking ties by lexical order of edge.to */
function bestByWeightThenLexical(edges: Edge[]): Edge {
  return edges.reduce((best, e) => {
    if (e.weight > best.weight) return e;
    if (e.weight === best.weight && e.to < best.to) return e;
    return best;
  });
}
