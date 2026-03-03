import type { Handler } from "./registry.js";
import type { GraphNode } from "../model/graph.js";
import type { Outcome } from "../model/outcome.js";

export class ConditionalHandler implements Handler {
  async execute(node: GraphNode): Promise<Outcome> {
    return {
      status: "success",
      notes: `Conditional node evaluated: ${node.id}`,
    };
  }
}
