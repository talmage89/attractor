import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Graph, GraphNode } from "../model/graph.js";
import { findStartNode, isTerminal } from "../model/graph.js";
import type { Outcome } from "../model/outcome.js";
import { Context } from "../model/context.js";
import type { PipelineEvent } from "../model/events.js";
import { saveCheckpoint, loadCheckpoint } from "../model/checkpoint.js";
import { HandlerRegistry } from "../handlers/registry.js";
import type { Handler } from "../handlers/registry.js";
import { WaitForHumanHandler } from "../handlers/wait-human.js";
import type { Interviewer } from "../interviewer/interviewer.js";
import { applyTransforms } from "./transforms.js";
import { validateOrThrow } from "../validation/validator.js";
import { selectEdge } from "./edge-selection.js";
import { buildRetryPolicy, executeWithRetry } from "./retry.js";
import { checkGoalGates, resolveRetryTarget } from "./goal-gates.js";
import { resolveFidelity, resolveThreadId } from "../model/fidelity.js";

export interface RunConfig {
  graph: Graph;
  cwd: string;
  logsRoot: string;
  interviewer: Interviewer;
  onEvent?: (event: PipelineEvent) => void;
  resumeFromCheckpoint?: string;
  ccPermissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  registry?: HandlerRegistry;
}

export interface RunResult {
  status: "success" | "fail";
  completedNodes: string[];
  nodeOutcomes: Map<string, Outcome>;
  finalContext: Map<string, unknown>;
  durationMs: number;
}

/** Default mock handler — always returns success. Used when no real registry is provided. */
const defaultMockHandler: Handler = {
  async execute(): Promise<Outcome> {
    return { status: "success" };
  },
};

function emit(config: RunConfig, event: PipelineEvent): void {
  if (config.onEvent) {
    try {
      config.onEvent(event);
    } catch {
      // ignore errors in event handlers
    }
  }
}

function handlerTypeFor(node: GraphNode): string {
  // Best-effort label for events; derive type from node attributes, not the resolved handler
  if (node.type) return node.type;
  const shapeMap: Record<string, string> = {
    Mdiamond: "start",
    Msquare: "exit",
    box: "codergen",
    hexagon: "wait.human",
    diamond: "conditional",
    component: "parallel",
    tripleoctagon: "parallel.fan_in",
    parallelogram: "tool",
    house: "stack.manager_loop",
  };
  return shapeMap[node.shape] ?? "default";
}

export async function run(config: RunConfig): Promise<RunResult> {
  const { graph } = config;
  const startTime = Date.now();

  // 1. INITIALIZE
  await fs.mkdir(config.logsRoot, { recursive: true });

  const context = new Context();
  context.set("graph.goal", graph.attributes.goal);

  // Use provided registry or create default
  const registry = config.registry ?? new HandlerRegistry(defaultMockHandler);

  // Always register built-in handlers so they never fall through to custom defaults
  registry.register("start", { async execute(): Promise<Outcome> { return { status: "success" }; } });
  registry.register("exit", { async execute(): Promise<Outcome> { return { status: "success" }; } });
  registry.register("wait.human", new WaitForHumanHandler(config.interviewer));

  // Apply transforms
  applyTransforms(graph);

  // Validate (throws on errors)
  validateOrThrow(graph);

  let completedNodes: string[] = [];
  let nodeOutcomes = new Map<string, Outcome>();

  // If resuming from checkpoint, restore state
  let startNode = findStartNode(graph);
  if (!startNode) throw new Error("No start node found");

  let currentNode: GraphNode = startNode;

  if (config.resumeFromCheckpoint) {
    const checkpoint = await loadCheckpoint(config.resumeFromCheckpoint);
    completedNodes = checkpoint.completedNodes;
    // Restore nodeOutcomes
    for (const [k, v] of Object.entries(checkpoint.nodeOutcomes)) {
      nodeOutcomes.set(k, v as Outcome);
    }
    // Restore context
    for (const [k, v] of Object.entries(checkpoint.contextValues)) {
      context.set(k, v);
    }
    // Resume from saved currentNode
    const resumeNode = graph.nodes.get(checkpoint.currentNode);
    if (resumeNode) {
      currentNode = resumeNode;
    }
  }

  // Emit pipeline_started
  emit(config, {
    kind: "pipeline_started",
    name: graph.name,
    goal: graph.attributes.goal,
    timestamp: Date.now(),
  });

  let finalStatus: "success" | "fail" = "success";

  // 3. TRAVERSAL LOOP
  loop: while (true) {
    // a. CHECK TERMINAL
    if (isTerminal(currentNode)) {
      // Execute exit node but don't add to completedNodes
      const nodeStart = Date.now();
      emit(config, {
        kind: "stage_started",
        nodeId: currentNode.id,
        label: currentNode.label || currentNode.id,
        handlerType: handlerTypeFor(currentNode),
        timestamp: Date.now(),
      });

      context.set("__completedNodes", JSON.stringify(completedNodes));
      context.set("__nodeOutcomes", JSON.stringify([...nodeOutcomes]));

      const exitPolicy = buildRetryPolicy(currentNode, graph);
      const exitOutcome = await executeWithRetry(
        registry.resolve(currentNode),
        currentNode,
        context,
        graph,
        config,
        exitPolicy
      );

      emit(config, {
        kind: "stage_completed",
        nodeId: currentNode.id,
        outcome: exitOutcome,
        durationMs: Date.now() - nodeStart,
        timestamp: Date.now(),
      });

      // Apply context updates from exit node
      if (exitOutcome.contextUpdates) {
        context.applyUpdates(exitOutcome.contextUpdates);
      }
      context.set("outcome", exitOutcome.status);
      if (exitOutcome.preferredLabel) {
        context.set("preferred_label", exitOutcome.preferredLabel);
      }

      // Check goal gates
      const gateResult = checkGoalGates(graph, nodeOutcomes);
      emit(config, {
        kind: "goal_gate_check",
        satisfied: gateResult.satisfied,
        failedNodeId: gateResult.failedNode?.id,
        timestamp: Date.now(),
      });

      if (!gateResult.satisfied && gateResult.failedNode) {
        const retryTarget = resolveRetryTarget(gateResult.failedNode, graph);
        if (retryTarget) {
          const retryNode = graph.nodes.get(retryTarget)!;
          currentNode = retryNode;
          continue loop;
        } else {
          finalStatus = "fail";
          break loop;
        }
      }

      // Satisfied or no goal gates
      break loop;
    }

    // b. EXECUTE NODE (non-terminal)
    const isStartNode = currentNode.shape === "Mdiamond" || currentNode.type === "start";
    const nodeStart = Date.now();

    emit(config, {
      kind: "stage_started",
      nodeId: currentNode.id,
      label: currentNode.label || currentNode.id,
      handlerType: handlerTypeFor(currentNode),
      timestamp: Date.now(),
    });

    // Set engine context before handler call
    context.set("__completedNodes", JSON.stringify(completedNodes));
    context.set("__nodeOutcomes", JSON.stringify([...nodeOutcomes]));

    const policy = buildRetryPolicy(currentNode, graph);
    const outcome = await executeWithRetry(
      registry.resolve(currentNode),
      currentNode,
      context,
      graph,
      config,
      policy
    );

    emit(config, {
      kind: "stage_completed",
      nodeId: currentNode.id,
      outcome,
      durationMs: Date.now() - nodeStart,
      timestamp: Date.now(),
    });

    // c. RECORD (only non-start, non-exit work nodes)
    if (!isStartNode) {
      completedNodes.push(currentNode.id);
      nodeOutcomes.set(currentNode.id, outcome);
    }

    // d. APPLY CONTEXT UPDATES
    if (outcome.contextUpdates) {
      context.applyUpdates(outcome.contextUpdates);
    }
    context.set("outcome", outcome.status);
    if (outcome.preferredLabel) {
      context.set("preferred_label", outcome.preferredLabel);
    }

    // f. SELECT NEXT EDGE
    const edge = selectEdge(graph, currentNode, outcome, context);

    if (edge === null) {
      // No edge available
      if (outcome.status === "fail") {
        finalStatus = "fail";
      }
      break loop;
    }

    // g. LOOP RESTART CHECK
    if (edge.loopRestart) {
      // Per spec Section 8.2 step g: restart the run with a fresh logsRoot.
      // A new sibling directory is used so logs from each cycle are preserved.
      const restartLogsRoot = `${config.logsRoot}-restart-${Date.now()}`;
      return run({ ...config, logsRoot: restartLogsRoot, resumeFromCheckpoint: undefined });
    }

    // e. CHECKPOINT (save with nextNode = edge.to)
    await saveCheckpoint(
      {
        timestamp: Date.now(),
        currentNode: edge.to,
        completedNodes: [...completedNodes],
        nodeOutcomes: Object.fromEntries(nodeOutcomes),
        nodeRetries: {},
        contextValues: context.snapshot(),
        sessionMap: {},
      },
      config.logsRoot
    );

    emit(config, {
      kind: "checkpoint_saved",
      nodeId: currentNode.id,
      timestamp: Date.now(),
    });

    emit(config, {
      kind: "edge_selected",
      from: currentNode.id,
      to: edge.to,
      label: edge.label,
      reason: edge.condition ? "condition" : "weight",
      timestamp: Date.now(),
    });

    // h. ADVANCE
    currentNode = graph.nodes.get(edge.to)!;
  }

  // 4. FINALIZE
  await saveCheckpoint(
    {
      timestamp: Date.now(),
      currentNode: currentNode.id,
      completedNodes: [...completedNodes],
      nodeOutcomes: Object.fromEntries(nodeOutcomes),
      nodeRetries: {},
      contextValues: context.snapshot(),
      sessionMap: {},
    },
    config.logsRoot
  );

  emit(config, {
    kind: "pipeline_completed",
    status: finalStatus,
    durationMs: Date.now() - startTime,
    timestamp: Date.now(),
  });

  // Build finalContext map (exclude __ internal keys for snapshot, but include for Map)
  const snapshot = context.snapshot();
  const finalContext = new Map<string, unknown>();
  for (const [k, v] of Object.entries(snapshot)) {
    if (!k.startsWith("__")) {
      finalContext.set(k, v);
    }
  }

  return {
    status: finalStatus,
    completedNodes: [...completedNodes],
    nodeOutcomes,
    finalContext,
    durationMs: Date.now() - startTime,
  };
}
