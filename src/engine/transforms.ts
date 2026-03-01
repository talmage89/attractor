import type { Graph } from "../model/graph.js";
import { parseStylesheet } from "../stylesheet/parser.js";
import { applyStylesheet } from "../stylesheet/applicator.js";

export function applyTransforms(graph: Graph): void {
  // 1. Variable expansion: replace $goal in node prompts and tool_command values.
  //    This is the canonical (and only) expansion point for $goal — handlers
  //    must not repeat this substitution.
  const goal = graph.attributes.goal ?? "";
  for (const node of graph.nodes.values()) {
    if (node.prompt.includes("$goal")) {
      node.prompt = node.prompt.replaceAll("$goal", goal);
    }
    const toolCommand = node.raw.get("tool_command");
    if (toolCommand && toolCommand.includes("$goal")) {
      node.raw.set("tool_command", toolCommand.replaceAll("$goal", goal));
    }
  }

  // 2. Stylesheet application
  const stylesheet = graph.attributes.modelStylesheet;
  if (stylesheet) {
    const rules = parseStylesheet(stylesheet);
    applyStylesheet(graph, rules);
  }
}
