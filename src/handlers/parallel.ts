import type { GraphNode, Graph } from "../model/graph.js";
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

  async execute(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome> {
    const edges = outgoingEdges(graph, node.id);
    if (edges.length === 0) {
      return { status: "fail", failureReason: "No outgoing edges from parallel node" };
    }

    const joinPolicy = node.raw.get("join_policy") ?? "wait_all";
    const maxParallelStr = node.raw.get("max_parallel") ?? "4";
    const maxParallel = parseInt(maxParallelStr, 10) || 4;

    const isKnownPolicy = joinPolicy === "wait_all" || joinPolicy === "first_success";
    if (!isKnownPolicy) {
      process.stderr.write(
        `[attractor] Warning: node "${node.id}" has unrecognized join_policy "${joinPolicy}"; defaulting to "wait_all"\n`
      );
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

    return { status, contextUpdates };
  }
}
