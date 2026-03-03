export interface Graph {
  name: string;
  attributes: GraphAttributes;
  nodes: Map<string, GraphNode>;
  edges: Edge[];
}

export interface GraphAttributes {
  goal: string;
  label: string;
  modelStylesheet: string;
  defaultMaxRetry: number;
  retryTarget: string;
  fallbackRetryTarget: string;
  defaultFidelity: string;
  raw: Map<string, string>;
}

export interface GraphNode {
  id: string;
  label: string;
  shape: string;
  type: string;
  prompt: string;
  maxRetries: number;
  goalGate: boolean;
  retryTarget: string;
  fallbackRetryTarget: string;
  fidelity: string;
  threadId: string;
  className: string;
  timeout: number | null;
  llmModel: string;
  llmProvider: string;
  reasoningEffort: string;
  autoStatus: boolean;
  allowPartial: boolean;
  raw: Map<string, string>;
}

export interface Edge {
  from: string;
  to: string;
  label: string;
  condition: string;
  weight: number;
  fidelity: string;
  threadId: string;
  loopRestart: boolean;
}

export function outgoingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

export function incomingEdges(graph: Graph, nodeId: string): Edge[] {
  return graph.edges.filter((e) => e.to === nodeId);
}

export function findStartNode(graph: Graph): GraphNode | null {
  for (const node of graph.nodes.values()) {
    if (node.shape === "Mdiamond") return node;
  }
  return (
    graph.nodes.get("start") ?? graph.nodes.get("Start") ?? null
  );
}

export function findExitNode(graph: Graph): GraphNode | null {
  for (const node of graph.nodes.values()) {
    if (node.shape === "Msquare" || node.type === "exit") return node;
  }
  return (
    graph.nodes.get("exit") ?? graph.nodes.get("end") ?? null
  );
}

export function isTerminal(node: GraphNode): boolean {
  return node.shape === "Msquare" || node.type === "exit" || node.id === "exit" || node.id === "end";
}

export function reachableFrom(graph: Graph, nodeId: string): Set<string> {
  const visited = new Set<string>();
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of outgoingEdges(graph, current)) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return visited;
}
