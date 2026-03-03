import type { Graph, GraphNode } from "../model/graph.js";
import type { StyleRule, StyleSelector } from "./parser.js";

function specificity(selector: StyleSelector): number {
  if (selector.type === "universal") return 0;
  if (selector.type === "class") return 1;
  return 2; // id
}

function selectorMatches(selector: StyleSelector, node: GraphNode): boolean {
  if (selector.type === "universal") return true;
  if (selector.type === "id") return node.id === selector.nodeId;
  if (selector.type === "class") {
    // className is comma-separated
    return node.className
      .split(",")
      .map((c) => c.trim())
      .includes(selector.className);
  }
  return false;
}

export function applyStylesheet(graph: Graph, rules: StyleRule[]): void {
  for (const node of graph.nodes.values()) {
    // Collect matching rules in declaration order
    const matching = rules.filter((r) => selectorMatches(r.selector, node));
    // Sort by specificity ascending (stable — filter preserves order within equal specificity)
    matching.sort((a, b) => specificity(a.selector) - specificity(b.selector));

    for (const rule of matching) {
      for (const [property, value] of rule.declarations) {
        if (property === "llm_model" && !node.raw.has("llm_model")) {
          node.llmModel = value;
        } else if (property === "llm_provider" && !node.raw.has("llm_provider")) {
          node.llmProvider = value;
        } else if (property === "reasoning_effort" && !node.raw.has("reasoning_effort")) {
          node.reasoningEffort = value;
        }
      }
    }
  }
}
