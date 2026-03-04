import type { Graph } from "../model/graph.js";
import {
  findStartNode,
  incomingEdges,
  outgoingEdges,
  reachableFrom,
} from "../model/graph.js";
import type { Diagnostic } from "./diagnostic.js";
import { parseCondition } from "../conditions/parser.js";
import { parseStylesheet } from "../stylesheet/parser.js";

export type LintRule = (graph: Graph) => Diagnostic[];

function startNodeRule(graph: Graph): Diagnostic[] {
  const startNodes = [...graph.nodes.values()].filter(
    (n) => n.shape === "Mdiamond" || n.id === "start" || n.id === "Start"
  );
  if (startNodes.length === 0) {
    return [
      {
        rule: "start_node",
        severity: "error",
        message: "Graph has no start node (shape=Mdiamond or id=start)",
      },
    ];
  }
  if (startNodes.length > 1) {
    return [
      {
        rule: "start_node",
        severity: "error",
        message: `Graph has ${startNodes.length} start nodes; expected exactly one`,
      },
    ];
  }
  return [];
}

function terminalNodeRule(graph: Graph): Diagnostic[] {
  const exitNodes = [...graph.nodes.values()].filter(
    (n) => n.shape === "Msquare" || n.type === "exit" || n.id === "exit" || n.id === "end"
  );
  if (exitNodes.length === 0) {
    return [
      {
        rule: "terminal_node",
        severity: "error",
        message: "Graph has no exit node (shape=Msquare, type=exit, or id=exit/end)",
      },
    ];
  }
  return [];
}

function startNoIncomingRule(graph: Graph): Diagnostic[] {
  const start = findStartNode(graph);
  if (!start) return [];
  if (incomingEdges(graph, start.id).length > 0) {
    return [
      {
        rule: "start_no_incoming",
        severity: "error",
        message: "Start node must not have incoming edges",
        nodeId: start.id,
        span: start.span,
      },
    ];
  }
  return [];
}

function exitNoOutgoingRule(graph: Graph): Diagnostic[] {
  const exitNodes = [...graph.nodes.values()].filter(
    (n) => n.shape === "Msquare" || n.type === "exit" || n.id === "exit" || n.id === "end"
  );
  return exitNodes
    .filter((exit) => outgoingEdges(graph, exit.id).length > 0)
    .map((exit) => ({
      rule: "exit_no_outgoing",
      severity: "error" as const,
      message: "Exit node must not have outgoing edges",
      nodeId: exit.id,
      span: exit.span,
    }));
}

function reachabilityRule(graph: Graph): Diagnostic[] {
  const start = findStartNode(graph);
  if (!start) return [];
  const reachable = reachableFrom(graph, start.id);
  reachable.add(start.id);
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    if (!reachable.has(node.id)) {
      diags.push({
        rule: "reachability",
        severity: "error",
        message: `Node '${node.id}' is unreachable from start`,
        nodeId: node.id,
        span: node.span,
      });
    }
  }
  return diags;
}

function edgeTargetExistsRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.from)) {
      diags.push({
        rule: "edge_target_exists",
        severity: "error",
        message: `Edge references unknown node '${edge.from}'`,
        edge: { from: edge.from, to: edge.to },
        span: edge.span,
      });
    }
    if (!graph.nodes.has(edge.to)) {
      diags.push({
        rule: "edge_target_exists",
        severity: "error",
        message: `Edge references unknown node '${edge.to}'`,
        edge: { from: edge.from, to: edge.to },
        span: edge.span,
      });
    }
  }
  return diags;
}

function conditionSyntaxRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const edge of graph.edges) {
    if (!edge.condition) continue;
    try {
      parseCondition(edge.condition);
    } catch (err) {
      diags.push({
        rule: "condition_syntax",
        severity: "error",
        message: `Invalid condition syntax: '${edge.condition}'`,
        edge: { from: edge.from, to: edge.to },
        span: edge.span,
      });
    }
  }
  return diags;
}

function stylesheetSyntaxRule(graph: Graph): Diagnostic[] {
  const stylesheet = graph.attributes.modelStylesheet;
  if (!stylesheet) return [];
  try {
    parseStylesheet(stylesheet);
  } catch (err) {
    return [
      {
        rule: "stylesheet_syntax",
        severity: "error",
        message: `Invalid stylesheet syntax: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  return [];
}

function stylesheetUnknownPropertyRule(graph: Graph): Diagnostic[] {
  const stylesheet = graph.attributes.modelStylesheet;
  if (!stylesheet) return [];
  const unknownProperties: string[] = [];
  try {
    parseStylesheet(stylesheet, unknownProperties);
  } catch {
    // Syntax errors are reported by stylesheetSyntaxRule
    return [];
  }
  return unknownProperties.map((prop) => ({
    rule: "stylesheet_unknown_property",
    severity: "warning" as const,
    message: `Unrecognized stylesheet property '${prop}'; known properties are: llm_model, llm_provider, reasoning_effort`,
  }));
}

const KNOWN_TYPES = new Set([
  "start",
  "exit",
  "codergen",
  "conditional",
  "wait.human",
  "parallel",
  "parallel.fan_in",
  "tool",
  "stack.manager_loop",
]);

function typeKnownRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    if (node.type && !KNOWN_TYPES.has(node.type)) {
      diags.push({
        rule: "type_known",
        severity: "warning",
        message: `Unknown node type '${node.type}'`,
        nodeId: node.id,
        span: node.span,
      });
    }
  }
  return diags;
}

const VALID_FIDELITY = new Set([
  "full",
  "truncate",
  "compact",
  "summary:low",
  "summary:medium",
  "summary:high",
]);

function fidelityValidRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    if (node.fidelity && !VALID_FIDELITY.has(node.fidelity)) {
      diags.push({
        rule: "fidelity_valid",
        severity: "warning",
        message: `Invalid fidelity mode '${node.fidelity}'`,
        nodeId: node.id,
        span: node.span,
      });
    }
  }
  for (const edge of graph.edges) {
    if (edge.fidelity && !VALID_FIDELITY.has(edge.fidelity)) {
      diags.push({
        rule: "fidelity_valid",
        severity: "warning",
        message: `Invalid fidelity mode '${edge.fidelity}' on edge ${edge.from} -> ${edge.to}`,
        edge: { from: edge.from, to: edge.to },
        span: edge.span,
      });
    }
  }
  if (graph.attributes.defaultFidelity && !VALID_FIDELITY.has(graph.attributes.defaultFidelity)) {
    diags.push({
      rule: "fidelity_valid",
      severity: "warning",
      message: `Invalid default_fidelity '${graph.attributes.defaultFidelity}'`,
    });
  }
  return diags;
}

function retryTargetExistsRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    if (node.retryTarget && !graph.nodes.has(node.retryTarget)) {
      diags.push({
        rule: "retry_target_exists",
        severity: "warning",
        message: `Node '${node.id}' has retry_target '${node.retryTarget}' which does not exist`,
        nodeId: node.id,
        span: node.span,
      });
    }
    if (node.fallbackRetryTarget && !graph.nodes.has(node.fallbackRetryTarget)) {
      diags.push({
        rule: "retry_target_exists",
        severity: "warning",
        message: `Node '${node.id}' has fallback_retry_target '${node.fallbackRetryTarget}' which does not exist`,
        nodeId: node.id,
        span: node.span,
      });
    }
  }
  if (graph.attributes.retryTarget && !graph.nodes.has(graph.attributes.retryTarget)) {
    diags.push({
      rule: "retry_target_exists",
      severity: "warning",
      message: `Graph retry_target '${graph.attributes.retryTarget}' does not exist`,
    });
  }
  if (graph.attributes.fallbackRetryTarget && !graph.nodes.has(graph.attributes.fallbackRetryTarget)) {
    diags.push({
      rule: "retry_target_exists",
      severity: "warning",
      message: `Graph fallback_retry_target '${graph.attributes.fallbackRetryTarget}' does not exist`,
    });
  }
  return diags;
}

function goalGateHasRetryRule(graph: Graph): Diagnostic[] {
  const graphHasRetry = !!graph.attributes.retryTarget || !!graph.attributes.fallbackRetryTarget;
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    if (node.goalGate) {
      const hasNodeRetry = !!node.retryTarget || !!node.fallbackRetryTarget;
      if (!hasNodeRetry && !graphHasRetry) {
        diags.push({
          rule: "goal_gate_has_retry",
          severity: "warning",
          message: `Goal gate node '${node.id}' has no retry target`,
          nodeId: node.id,
          span: node.span,
        });
      }
    }
  }
  return diags;
}

function nodeIdSafeRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    const hasPathSep = node.id.includes("/") || node.id.includes("\\");
    const hasParentSegment = node.id.split(/[/\\]/).some((part) => part === "..");
    if (hasPathSep || hasParentSegment) {
      diags.push({
        rule: "node_id_safe",
        severity: "error",
        message: `Node id '${node.id}' contains path traversal characters ('/', '\\', or '..')`,
        nodeId: node.id,
        span: node.span,
      });
    }
  }
  return diags;
}

function invalidDefaultMaxRetryRule(graph: Graph): Diagnostic[] {
  const raw = graph.attributes.raw.get("default_max_retry");
  if (raw === undefined) return [];
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return [
      {
        rule: "invalid_default_max_retry",
        severity: "warning",
        message: `default_max_retry "${raw}" is not a valid integer; using default (50)`,
      },
    ];
  }
  return [];
}

function invalidEdgeWeightRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const edge of graph.edges) {
    if (Number.isNaN(edge.weight)) {
      diags.push({
        rule: "invalid_edge_weight",
        severity: "warning",
        message: `Edge ${edge.from} -> ${edge.to} has an invalid weight value; using default (0)`,
        edge: { from: edge.from, to: edge.to },
        span: edge.span,
      });
    }
  }
  return diags;
}

function promptOnLlmNodesRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    const isLlmNode = !node.type && (node.shape === "box" || node.shape === "");
    const hasExplicitLabel = node.raw.has("label");
    if (isLlmNode && !node.prompt && !hasExplicitLabel) {
      diags.push({
        rule: "prompt_on_llm_nodes",
        severity: "warning",
        message: `LLM node '${node.id}' has no prompt or label`,
        nodeId: node.id,
        span: node.span,
      });
    }
  }
  return diags;
}

function foreachKeyValidRule(graph: Graph): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const node of graph.nodes.values()) {
    if (!node.raw.has("foreach_key")) continue;
    if (node.shape !== "component") {
      diags.push({
        rule: "foreach_key_valid",
        severity: "warning",
        message: `Node '${node.id}' has foreach_key but is not shape=component`,
        nodeId: node.id,
        span: node.span,
      });
    }
    const edges = outgoingEdges(graph, node.id);
    if (edges.length !== 1) {
      diags.push({
        rule: "foreach_key_valid",
        severity: "warning",
        message: `Node '${node.id}' has foreach_key and must have exactly 1 outgoing edge (template branch), got ${edges.length}`,
        nodeId: node.id,
        span: node.span,
      });
    }
  }
  return diags;
}

export const BUILT_IN_RULES: LintRule[] = [
  startNodeRule,
  terminalNodeRule,
  startNoIncomingRule,
  exitNoOutgoingRule,
  reachabilityRule,
  edgeTargetExistsRule,
  conditionSyntaxRule,
  stylesheetSyntaxRule,
  stylesheetUnknownPropertyRule,
  typeKnownRule,
  fidelityValidRule,
  retryTargetExistsRule,
  goalGateHasRetryRule,
  nodeIdSafeRule,
  promptOnLlmNodesRule,
  invalidDefaultMaxRetryRule,
  invalidEdgeWeightRule,
  foreachKeyValidRule,
];
