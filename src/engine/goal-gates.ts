import type { Graph, GraphNode } from "../model/graph.js";
import type { Outcome } from "../model/outcome.js";

export interface GoalGateResult {
  satisfied: boolean;
  failedNode?: GraphNode;
}

export function checkGoalGates(
  graph: Graph,
  nodeOutcomes: Map<string, Outcome>
): GoalGateResult {
  for (const [nodeId, outcome] of nodeOutcomes) {
    const node = graph.nodes.get(nodeId);
    if (!node || !node.goalGate) continue;
    if (outcome.status !== "success" && outcome.status !== "partial_success") {
      return { satisfied: false, failedNode: node };
    }
  }
  return { satisfied: true };
}

export function resolveRetryTarget(
  failedNode: GraphNode,
  graph: Graph
): string | null {
  const candidates = [
    failedNode.retryTarget,
    failedNode.fallbackRetryTarget,
    graph.attributes.retryTarget,
    graph.attributes.fallbackRetryTarget,
  ];
  for (const target of candidates) {
    if (target && graph.nodes.has(target)) {
      return target;
    }
  }
  return null;
}
