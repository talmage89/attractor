import * as fs from "node:fs/promises";
import type { Graph, GraphNode, Edge } from "../model/graph.js";
import { findStartNode, isTerminal } from "../model/graph.js";
import type { Outcome } from "../model/outcome.js";
import { Context } from "../model/context.js";
import type { PipelineEvent } from "../model/events.js";
import { saveCheckpoint, loadCheckpoint } from "../model/checkpoint.js";
import { HandlerRegistry } from "../handlers/registry.js";
import type { Handler } from "../handlers/registry.js";
import { WaitForHumanHandler } from "../handlers/wait-human.js";
import type { Interviewer } from "../interviewer/interviewer.js";
import { SessionManager } from "../backend/session-manager.js";
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
  /** Session manager for full-fidelity CC session persistence across checkpoints. */
  sessionManager?: SessionManager;
  /**
   * Set to true by the runner for the first node executed after a checkpoint
   * resume. CodergenHandler uses this to degrade `full` fidelity to
   * `summary:high` since the in-memory session state was not serialized
   * (spec Section 10.3, step 6).
   */
  firstNodeAfterResume?: boolean;
  /**
   * The edge that was traversed to reach the current node. Set by the runner
   * before each handler invocation so that handlers can honour edge-level
   * `fidelity` and `thread_id` overrides (which take priority over node-level
   * and graph-level defaults in the resolution chain).
   */
  incomingEdge?: Edge;
}

export interface RunResult {
  status: "success" | "fail";
  completedNodes: string[];
  nodeOutcomes: Map<string, Outcome>;
  finalContext: Map<string, unknown>;
  durationMs: number;
  totalCostUsd: number;
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

  // Use provided session manager or create a new one for this run
  const sessionManager = config.sessionManager ?? new SessionManager();

  // Use provided registry or create default
  const registry = config.registry ?? new HandlerRegistry(defaultMockHandler);

  // Register built-in handlers only if the caller has not already registered one.
  // This preserves the caller's custom start/exit/wait.human handlers when provided.
  if (!registry.hasHandler("start")) {
    registry.register("start", { async execute(): Promise<Outcome> { return { status: "success" }; } });
  }
  if (!registry.hasHandler("exit")) {
    registry.register("exit", { async execute(): Promise<Outcome> { return { status: "success" }; } });
  }
  if (!registry.hasHandler("wait.human")) {
    registry.register("wait.human", new WaitForHumanHandler(config.interviewer));
  }

  // Apply transforms
  applyTransforms(graph);

  // Validate (throws on errors)
  validateOrThrow(graph);

  let completedNodes: string[] = [];
  let nodeOutcomes = new Map<string, Outcome>();
  const nodeRetries = new Map<string, number>();
  let totalCostUsd = 0;

  // If resuming from checkpoint, restore state
  let startNode = findStartNode(graph);
  if (!startNode) throw new Error("No start node found");

  let currentNode: GraphNode = startNode;

  // Track whether the next node to execute is the first after a resume.
  // Passed to handlers so CodergenHandler can degrade full→summary:high fidelity.
  let isFirstNodeAfterResume = false;

  // Track the edge that was traversed to reach the current node so handlers
  // can honour edge-level fidelity/threadId overrides.
  let currentIncomingEdge: Edge | undefined = undefined;

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
    // Restore session map so full-fidelity CC sessions resume correctly
    sessionManager.restore(checkpoint.sessionMap);
    // Restore per-node retry counts so the first node executes from the right attempt
    for (const [k, v] of Object.entries(checkpoint.nodeRetries)) {
      nodeRetries.set(k, v as number);
    }
    // Resume from saved currentNode
    const resumeNode = graph.nodes.get(checkpoint.currentNode);
    if (resumeNode) {
      currentNode = resumeNode;
    }
    isFirstNodeAfterResume = true;
  }

  // Emit pipeline_started
  emit(config, {
    kind: "pipeline_started",
    name: graph.name,
    goal: graph.attributes.goal,
    timestamp: Date.now(),
  });

  let finalStatus: "success" | "fail" = "success";

  // Counter for goal-gate-driven loop restarts. Capped at defaultMaxRetry to
  // prevent infinite loops when the retry subgraph never satisfies the gate.
  let goalGateRetries = 0;
  const maxGoalGateRetries = graph.attributes.defaultMaxRetry;

  // Wraps config.onEvent to intercept stage_retrying events, update per-node
  // retry counts, and save a mid-retry checkpoint so that a resumed pipeline
  // can start from the right attempt number rather than restarting at 1.
  function wrappedOnEvent(event: PipelineEvent): void {
    if (event.kind === "stage_retrying") {
      nodeRetries.set(event.nodeId, event.attempt);
      // Fire-and-forget: persist the updated retry count so crash recovery can
      // honour it. Errors here are non-fatal (worst case: retry restarts at 1).
      saveCheckpoint(
        {
          timestamp: Date.now(),
          currentNode: currentNode.id,
          completedNodes: [...completedNodes],
          nodeOutcomes: Object.fromEntries(nodeOutcomes),
          nodeRetries: Object.fromEntries(nodeRetries),
          contextValues: context.snapshot(),
          sessionMap: sessionManager.snapshot(),
        },
        config.logsRoot
      ).catch(() => {});
    }
    config.onEvent?.(event);
  }

  // 3. TRAVERSAL LOOP
  loop: while (true) {
    // On resume, compute how many attempts the current node has already consumed
    // so executeWithRetry starts from the right attempt (not attempt 1).
    const initialAttempt = isFirstNodeAfterResume
      ? (nodeRetries.get(currentNode.id) ?? 0) + 1
      : 1;

    // Build a per-iteration config that includes the incoming edge (so handlers
    // can honour edge-level fidelity/threadId overrides) and the
    // firstNodeAfterResume flag for the first node executed after a restore.
    const nodeConfig: RunConfig = {
      ...config,
      onEvent: wrappedOnEvent,
      incomingEdge: currentIncomingEdge,
      ...(isFirstNodeAfterResume ? { firstNodeAfterResume: true } : {}),
    };
    isFirstNodeAfterResume = false;

    // a. CHECK TERMINAL
    if (isTerminal(currentNode)) {
      // NOTE (spec extension): The spec (Section 8.2, step a) describes running
      // the goal gate check at the terminal node without mentioning executing
      // the exit handler. This implementation executes the exit handler first so
      // that any context updates it produces (e.g. setting "outcome") are
      // available before goal gate evaluation. This is an intentional,
      // documented extension of the spec. Goal gate check still happens below
      // after the handler returns.
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
        nodeConfig,
        exitPolicy,
        initialAttempt
      );

      totalCostUsd += exitOutcome.costUsd ?? 0;
      emit(config, {
        kind: "stage_completed",
        nodeId: currentNode.id,
        outcome: exitOutcome,
        durationMs: Date.now() - nodeStart,
        costUsd: exitOutcome.costUsd,
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
        if (retryTarget && goalGateRetries < maxGoalGateRetries) {
          goalGateRetries++;
          const retryNode = graph.nodes.get(retryTarget)!;
          currentNode = retryNode;
          // Goal-gate retries jump to a node directly (not via an edge), so
          // there is no incoming edge to honour for the next iteration.
          currentIncomingEdge = undefined;
          continue loop;
        } else {
          finalStatus = "fail";
          break loop;
        }
      }

      // Goal gates satisfied (or no goal gates): propagate exit handler failure
      if (exitOutcome.status === "fail") {
        finalStatus = "fail";
      }
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
      nodeConfig,
      policy,
      initialAttempt
    );

    emit(config, {
      kind: "stage_completed",
      nodeId: currentNode.id,
      outcome,
      durationMs: Date.now() - nodeStart,
      costUsd: outcome.costUsd,
      timestamp: Date.now(),
    });
    totalCostUsd += outcome.costUsd ?? 0;

    // c. RECORD
    // Intentional deviation from spec Section 8.2 step c: start nodes are excluded
    // from completedNodes and nodeOutcomes. Start nodes are sentinel markers for the
    // pipeline entry point; including them would conflate "work done" with pipeline
    // bookkeeping and would cause goal-gate logic to incorrectly evaluate the start
    // node's outcome. Exit nodes are also excluded (handled in the terminal branch).
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
        nodeRetries: Object.fromEntries(nodeRetries),
        contextValues: context.snapshot(),
        sessionMap: sessionManager.snapshot(),
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
    currentIncomingEdge = edge;
    currentNode = graph.nodes.get(edge.to)!;
  }

  // 4. FINALIZE
  await saveCheckpoint(
    {
      timestamp: Date.now(),
      currentNode: currentNode.id,
      completedNodes: [...completedNodes],
      nodeOutcomes: Object.fromEntries(nodeOutcomes),
      nodeRetries: Object.fromEntries(nodeRetries),
      contextValues: context.snapshot(),
      sessionMap: sessionManager.snapshot(),
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
    totalCostUsd,
  };
}
