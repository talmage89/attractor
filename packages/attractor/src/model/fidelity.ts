import type { Graph, GraphNode, Edge } from "./graph.js";

export type FidelityMode =
  | "full"
  | "truncate"
  | "compact"
  | "summary:low"
  | "summary:medium"
  | "summary:high";

export function resolveFidelity(
  node: GraphNode,
  graph: Graph,
  incomingEdge?: Edge
): FidelityMode {
  if (incomingEdge?.fidelity) return incomingEdge.fidelity as FidelityMode;
  if (node.fidelity) return node.fidelity as FidelityMode;
  if (graph.attributes.defaultFidelity) return graph.attributes.defaultFidelity as FidelityMode;
  return "compact";
}

export function resolveThreadId(
  node: GraphNode,
  graph: Graph,
  incomingEdge?: Edge,
  previousNodeId?: string
): string {
  if (node.threadId) return node.threadId;
  if (incomingEdge?.threadId) return incomingEdge.threadId;
  if (node.className) return node.className.split(",")[0].trim();
  return previousNodeId ?? node.id;
}
