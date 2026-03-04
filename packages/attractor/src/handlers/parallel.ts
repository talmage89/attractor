import type { GraphNode, Graph, Edge } from "../model/graph.js";
import { outgoingEdges, isTerminal } from "../model/graph.js";
import type { Context } from "../model/context.js";
import type { Outcome } from "../model/outcome.js";
import type { Handler, RunConfig } from "../handlers/registry.js";
import { HandlerRegistry } from "../handlers/registry.js";
import { selectEdge } from "../engine/edge-selection.js";
import { buildRetryPolicy, executeWithRetry } from "../engine/retry.js";

function isFanInNode(node: GraphNode): boolean {
  return node.shape === "tripleoctagon" || node.type === "parallel.fan_in";
}

/**
 * BFS from the fanout node's direct children to find the first fan-in node.
 * Returns the fan-in node ID, or null if none is found.
 */
function findFanInNodeId(graph: Graph, fanoutNodeId: string): string | null {
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const edge of outgoingEdges(graph, fanoutNodeId)) {
    if (!visited.has(edge.to)) {
      visited.add(edge.to);
      queue.push(edge.to);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const node = graph.nodes.get(current);
    if (!node) continue;
    if (isFanInNode(node)) {
      return current;
    }
    for (const edge of outgoingEdges(graph, current)) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return null;
}

/**
 * Walks forward from startId collecting node IDs until hitting a fan-in or
 * terminal node (exclusive). Stops early if a node has != 1 outgoing edge.
 */
function collectTemplateChain(graph: Graph, startId: string): string[] {
  const chain: string[] = [];
  let current = startId;
  while (true) {
    const node = graph.nodes.get(current);
    if (!node) break;
    if (isFanInNode(node) || isTerminal(node)) break;
    chain.push(current);
    const edges = outgoingEdges(graph, current);
    if (edges.length !== 1) break;
    current = edges[0].to;
  }
  return chain;
}

export async function executeBranch(
  startNodeId: string,
  context: Context,
  graph: Graph,
  config: RunConfig,
  registry: HandlerRegistry
): Promise<Outcome> {
  const startNode = graph.nodes.get(startNodeId);
  if (!startNode) {
    return { status: "fail", failureReason: `Branch start node "${startNodeId}" not found` };
  }

  let currentNode = startNode;
  let lastOutcome: Outcome = { status: "success" };

  while (true) {
    // Stop at terminal or fan-in nodes (do NOT execute them)
    if (isTerminal(currentNode) || isFanInNode(currentNode)) {
      return lastOutcome;
    }

    const policy = buildRetryPolicy(currentNode, graph);
    const outcome = await executeWithRetry(
      registry.resolve(currentNode),
      currentNode,
      context,
      graph,
      config,
      policy
    );

    lastOutcome = outcome;

    // Apply context updates to the cloned branch context
    if (outcome.contextUpdates) {
      context.applyUpdates(outcome.contextUpdates);
    }
    context.set("outcome", outcome.status);

    // Select next edge
    const edge = selectEdge(graph, currentNode, outcome, context);
    if (edge === null) {
      return lastOutcome;
    }

    const nextNode = graph.nodes.get(edge.to);
    if (!nextNode) {
      return { status: "fail", failureReason: `Node "${edge.to}" not found` };
    }

    currentNode = nextNode;
  }
}

export class ParallelHandler implements Handler {
  constructor(
    private registry: HandlerRegistry,
  ) {}

  private async executeDynamic(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome> {
    const foreachKey = node.raw.get("foreach_key")!;
    const itemKey = node.raw.get("item_key") ?? "item";

    // Require exactly one outgoing edge (the template branch)
    const templateEdges = outgoingEdges(graph, node.id);
    if (templateEdges.length !== 1) {
      return {
        status: "fail",
        failureReason: `Dynamic parallel node "${node.id}" must have exactly 1 outgoing edge (template branch), got ${templateEdges.length}`,
      };
    }

    // Parse the array from context
    const rawValue = context.getString(foreachKey);
    let items: unknown[];
    try {
      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) {
        return { status: "fail", failureReason: `Context key "${foreachKey}" is not a JSON array` };
      }
      items = parsed;
    } catch {
      return { status: "fail", failureReason: `Context key "${foreachKey}" is not valid JSON` };
    }

    // Collect template sub-chain (before adding any synthetics)
    const templateStart = templateEdges[0].to;
    const templateChain = collectTemplateChain(graph, templateStart);
    if (templateChain.length === 0) {
      return { status: "fail", failureReason: `Dynamic parallel node "${node.id}" template chain is empty` };
    }

    // Find fan-in before mutating the graph
    const fanInId = findFanInNodeId(graph, node.id);

    if (items.length === 0) {
      config.onEvent?.({ kind: "parallel_started", nodeId: node.id, branchCount: 0, timestamp: Date.now() });
      config.onEvent?.({ kind: "parallel_completed", nodeId: node.id, successCount: 0, failCount: 0, timestamp: Date.now() });
      return {
        status: "success",
        contextUpdates: { "parallel.results": "[]", "parallel.success_count": "0", "parallel.fail_count": "0" },
        ...(fanInId ? { suggestedNextIds: [fanInId] } : {}),
      };
    }

    config.onEvent?.({ kind: "parallel_started", nodeId: node.id, branchCount: items.length, timestamp: Date.now() });

    // Clone template nodes and edges for each item
    const syntheticNodeIds: string[] = [];
    const syntheticEdgeCount: number[] = []; // edges added per item (for cleanup)
    const branchStartIds: string[] = [];
    const templateSet = new Set(templateChain);

    for (let i = 0; i < items.length; i++) {
      const idMap = new Map<string, string>();
      for (const templateId of templateChain) {
        const clonedId = `${templateId}__dyn_${i}`;
        idMap.set(templateId, clonedId);
        const templateNode = graph.nodes.get(templateId)!;
        graph.nodes.set(clonedId, { ...templateNode, id: clonedId });
        syntheticNodeIds.push(clonedId);
      }

      let addedEdges = 0;

      // Clone internal edges (both endpoints in template chain)
      for (const edge of graph.edges) {
        if (templateSet.has(edge.from) && templateSet.has(edge.to)) {
          graph.edges.push({ ...edge, from: idMap.get(edge.from)!, to: idMap.get(edge.to)! });
          addedEdges++;
        }
      }

      // Edge from parallel fanout to cloned chain start
      const clonedStartId = idMap.get(templateChain[0])!;
      branchStartIds.push(clonedStartId);
      const startEdge: Edge = { from: node.id, to: clonedStartId, label: "", condition: "", weight: 0, fidelity: "", threadId: "", loopRestart: false };
      graph.edges.push(startEdge);
      addedEdges++;

      // Edge from cloned chain end to fan-in
      if (fanInId) {
        const clonedEndId = idMap.get(templateChain[templateChain.length - 1])!;
        graph.edges.push({ from: clonedEndId, to: fanInId, label: "", condition: "", weight: 0, fidelity: "", threadId: "", loopRestart: false });
        addedEdges++;
      }

      syntheticEdgeCount.push(addedEdges);
    }

    // Execute branches with bounded concurrency
    const maxParallelStr = node.raw.get("max_parallel") ?? "4";
    const maxParallel = parseInt(maxParallelStr, 10) || 4;
    const registry = this.registry;
    const results: Outcome[] = new Array(items.length);
    let nextIdx = 0;

    async function worker(): Promise<void> {
      while (nextIdx < items.length) {
        const currentIdx = nextIdx++;
        const branchCtx = context.clone();
        const item = items[currentIdx];
        branchCtx.set(itemKey, typeof item === "string" ? item : JSON.stringify(item));
        try {
          results[currentIdx] = await executeBranch(branchStartIds[currentIdx], branchCtx, graph, config, registry);
        } catch (err) {
          results[currentIdx] = { status: "fail", failureReason: String(err) };
        }
        config.onEvent?.({
          kind: "parallel_branch_completed",
          nodeId: branchStartIds[currentIdx],
          branchIndex: currentIdx,
          totalBranches: items.length,
          outcome: results[currentIdx],
          timestamp: Date.now(),
        });
      }
    }

    const workerCount = Math.min(maxParallel, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // Clean up synthetic nodes and edges (remove from highest index to preserve order)
    for (const nodeId of syntheticNodeIds) {
      graph.nodes.delete(nodeId);
    }
    const totalSyntheticEdges = syntheticEdgeCount.reduce((a, b) => a + b, 0);
    graph.edges.splice(graph.edges.length - totalSyntheticEdges, totalSyntheticEdges);

    // Aggregate results
    const failCount = results.filter(r => r.status === "fail" || r.status === "retry").length;
    const successCount = results.length - failCount;

    config.onEvent?.({ kind: "parallel_completed", nodeId: node.id, successCount, failCount, timestamp: Date.now() });

    const joinPolicy = node.raw.get("join_policy") ?? "wait_all";
    let status: "success" | "partial_success" | "fail";
    if (joinPolicy === "first_success") {
      status = results.some(r => r.status === "success" || r.status === "partial_success") ? "success" : "fail";
    } else {
      status = failCount === 0 ? "success" : "partial_success";
    }

    const totalCostUsd = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    return {
      status,
      contextUpdates: {
        "parallel.results": JSON.stringify(results),
        "parallel.success_count": String(successCount),
        "parallel.fail_count": String(failCount),
      },
      ...(totalCostUsd > 0 ? { costUsd: totalCostUsd } : {}),
      ...(fanInId ? { suggestedNextIds: [fanInId] } : {}),
    };
  }

  async execute(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome> {
    if (node.raw.has("foreach_key")) {
      return this.executeDynamic(node, context, graph, config);
    }

    const edges = outgoingEdges(graph, node.id);
    if (edges.length === 0) {
      return { status: "fail", failureReason: "No outgoing edges from parallel node" };
    }

    const joinPolicy = node.raw.get("join_policy") ?? "wait_all";
    const maxParallelStr = node.raw.get("max_parallel") ?? "4";
    const maxParallel = parseInt(maxParallelStr, 10) || 4;

    const isKnownPolicy = joinPolicy === "wait_all" || joinPolicy === "first_success";
    if (!isKnownPolicy) {
      config.onEvent?.({
        kind: "warning",
        nodeId: node.id,
        message: `node "${node.id}" has unrecognized join_policy "${joinPolicy}"; defaulting to "wait_all"`,
        timestamp: Date.now(),
      });
    }
    const effectivePolicy: "wait_all" | "first_success" = isKnownPolicy ? joinPolicy : "wait_all";

    config.onEvent?.({
      kind: "parallel_started",
      nodeId: node.id,
      branchCount: edges.length,
      timestamp: Date.now(),
    });

    // Execute branches with bounded concurrency (pool-of-workers pattern)
    const results: Outcome[] = new Array(edges.length);
    const registry = this.registry;
    let nextIdx = 0;

    async function worker(): Promise<void> {
      while (nextIdx < edges.length) {
        const currentIdx = nextIdx++;
        const edge = edges[currentIdx];
        const branchCtx = context.clone();
        try {
          const outcome = await executeBranch(
            edge.to, branchCtx, graph, config, registry
          );
          results[currentIdx] = outcome;
        } catch (err) {
          results[currentIdx] = { status: "fail", failureReason: String(err) };
        }
        config.onEvent?.({
          kind: "parallel_branch_completed",
          nodeId: edge.to,
          branchIndex: currentIdx,
          totalBranches: edges.length,
          outcome: results[currentIdx],
          timestamp: Date.now(),
        });
      }
    }

    const workerCount = Math.min(maxParallel, edges.length);
    const workerPromises: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workerPromises.push(worker());
    }
    await Promise.all(workerPromises);

    const failCount = results.filter(
      (r) => r.status === "fail" || r.status === "retry"
    ).length;
    const successCount = results.length - failCount;

    config.onEvent?.({
      kind: "parallel_completed",
      nodeId: node.id,
      successCount,
      failCount,
      timestamp: Date.now(),
    });

    const contextUpdates: Record<string, string> = {
      "parallel.results": JSON.stringify(results),
      "parallel.success_count": String(successCount),
      "parallel.fail_count": String(failCount),
    };

    let status: "success" | "partial_success" | "fail";
    if (effectivePolicy === "wait_all") {
      status = failCount === 0 ? "success" : "partial_success";
    } else {
      // first_success
      const anySuccess = results.some(
        (r) => r.status === "success" || r.status === "partial_success"
      );
      status = anySuccess ? "success" : "fail";
    }

    const totalBranchCostUsd = results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
    const fanInId = findFanInNodeId(graph, node.id);
    return {
      status,
      contextUpdates,
      ...(totalBranchCostUsd > 0 ? { costUsd: totalBranchCostUsd } : {}),
      ...(fanInId ? { suggestedNextIds: [fanInId] } : {}),
    };
  }
}
