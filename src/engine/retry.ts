import type { GraphNode, Graph } from "../model/graph.js";
import type { Context } from "../model/context.js";
import type { Outcome } from "../model/outcome.js";
import type { Handler, RunConfig } from "../handlers/registry.js";

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitter: boolean;
}

export function buildRetryPolicy(node: GraphNode, graph: Graph): RetryPolicy {
  const maxRetries = node.maxRetries > 0
    ? node.maxRetries
    : graph.attributes.defaultMaxRetry;
  return {
    maxAttempts: maxRetries + 1,
    initialDelayMs: 200,
    backoffFactor: 2.0,
    maxDelayMs: 60_000,
    jitter: true,
  };
}

export function delayForAttempt(attempt: number, policy: RetryPolicy): number {
  // attempt is 1-indexed (first retry = attempt 1)
  let delay = policy.initialDelayMs * (policy.backoffFactor ** (attempt - 1));
  delay = Math.min(delay, policy.maxDelayMs);
  if (policy.jitter) {
    delay *= 0.5 + Math.random();
  }
  return delay;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeWithRetry(
  handler: Handler,
  node: GraphNode,
  context: Context,
  graph: Graph,
  config: RunConfig,
  policy: RetryPolicy
): Promise<Outcome> {
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    let outcome: Outcome;
    try {
      outcome = await handler.execute(node, context, graph, config);
    } catch (error: unknown) {
      if (attempt < policy.maxAttempts) {
        const delay = delayForAttempt(attempt, policy);
        config.onEvent?.({ kind: "stage_retrying", nodeId: node.id, attempt, delayMs: delay, timestamp: Date.now() });
        await sleep(delay);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      config.onEvent?.({
        kind: "error",
        nodeId: node.id,
        message,
        timestamp: Date.now(),
      });
      return { status: "fail", failureReason: message };
    }

    if (outcome.status === "success" || outcome.status === "partial_success") {
      return outcome;
    }

    if (outcome.status === "retry") {
      if (attempt < policy.maxAttempts) {
        const delay = delayForAttempt(attempt, policy);
        config.onEvent?.({ kind: "stage_retrying", nodeId: node.id, attempt, delayMs: delay, timestamp: Date.now() });
        await sleep(delay);
        continue;
      } else {
        if (node.allowPartial) {
          return { status: "partial_success", notes: "retries exhausted" };
        }
        return { status: "fail", failureReason: "max retries exceeded" };
      }
    }

    if (outcome.status === "fail") {
      return outcome;
    }

    // skipped or unknown — pass through
    return outcome;
  }

  return { status: "fail", failureReason: "max retries exceeded" };
}
