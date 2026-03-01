import type { GraphNode } from "../model/graph.js";
import type { Context } from "../model/context.js";
import type { Graph } from "../model/graph.js";
import type { Outcome } from "../model/outcome.js";
// import type is erased at compile-time; no circular dep at runtime
import type { RunConfig } from "../engine/runner.js";

export type { RunConfig };

export interface Handler {
  execute(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome>;
}

export const SHAPE_TO_TYPE: Record<string, string> = {
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

export class HandlerRegistry {
  private handlers = new Map<string, Handler>();
  private defaultHandler: Handler;

  constructor(defaultHandler: Handler) {
    this.defaultHandler = defaultHandler;
    // Register stub for stack.manager_loop (deferred per Section 1.2)
    this.register("stack.manager_loop", {
      async execute(): Promise<Outcome> {
        return {
          status: "fail",
          failureReason: "stack.manager_loop handler is not implemented (deferred)",
        };
      },
    });
  }

  register(typeString: string, handler: Handler): void {
    this.handlers.set(typeString, handler);
  }

  resolve(node: GraphNode): Handler {
    // 1. Explicit type attribute
    if (node.type && this.handlers.has(node.type)) {
      return this.handlers.get(node.type)!;
    }
    // 2. Shape-based resolution
    const handlerType = SHAPE_TO_TYPE[node.shape];
    if (handlerType && this.handlers.has(handlerType)) {
      return this.handlers.get(handlerType)!;
    }
    // 3. Default
    return this.defaultHandler;
  }
}
