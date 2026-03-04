import type { GraphNode, Graph } from "../model/graph.js";
import type { Context } from "../model/context.js";
import type { Outcome } from "../model/outcome.js";
import type { Handler, RunConfig } from "../handlers/registry.js";

const STATUS_RANK: Record<string, number> = {
  success: 4,
  partial_success: 3,
  retry: 2,
  fail: 1,
};

export class FanInHandler implements Handler {
  async execute(
    _node: GraphNode,
    context: Context,
    _graph: Graph,
    _config: RunConfig
  ): Promise<Outcome> {
    const resultsJson = context.getString("parallel.results");
    if (!resultsJson) {
      return { status: "fail", failureReason: "No parallel results" };
    }

    let outcomes: Outcome[];
    try {
      outcomes = JSON.parse(resultsJson) as Outcome[];
    } catch {
      return { status: "fail", failureReason: "Failed to parse parallel results" };
    }

    if (outcomes.length === 0) {
      // Empty array = 0 branches ran (dynamic parallel with empty input) = success
      return { status: "success", contextUpdates: { "parallel.fan_in.best_outcome": "", "parallel.fan_in.best_notes": "" } };
    }

    // Rank by status: success > partial_success > retry > fail
    let best = outcomes[0];
    for (const o of outcomes.slice(1)) {
      const bestRank = STATUS_RANK[best.status] ?? 0;
      const oRank = STATUS_RANK[o.status] ?? 0;
      if (oRank > bestRank) {
        best = o;
      }
    }

    return {
      status: "success",
      contextUpdates: {
        "parallel.fan_in.best_outcome": best.status,
        "parallel.fan_in.best_notes": best.notes ?? "",
      },
    };
  }
}
