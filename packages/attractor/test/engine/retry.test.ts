import { describe, it, expect, vi } from "vitest";
import {
  buildRetryPolicy,
  delayForAttempt,
  executeWithRetry,
  type RetryPolicy,
} from "../../src/engine/retry.js";
import { Context } from "../../src/model/context.js";
import type { Graph, GraphNode } from "../../src/model/graph.js";
import type { Handler } from "../../src/handlers/registry.js";
import type { Outcome } from "../../src/model/outcome.js";

// --- helpers ---

function makeGraph(defaultMaxRetry = 0): Graph {
  return {
    name: "G",
    attributes: {
      goal: "",
      label: "",
      modelStylesheet: "",
      defaultMaxRetry,
      retryTarget: "",
      fallbackRetryTarget: "",
      defaultFidelity: "",
      raw: new Map(),
    },
    nodes: new Map(),
    edges: [],
  };
}

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id: "n1",
    label: "",
    shape: "box",
    type: "codergen",
    prompt: "",
    maxRetries: 0,
    goalGate: false,
    retryTarget: "",
    fallbackRetryTarget: "",
    fidelity: "",
    threadId: "",
    className: "",
    timeout: null,
    llmModel: "",
    llmProvider: "",
    reasoningEffort: "",
    autoStatus: false,
    allowPartial: false,
    raw: new Map(),
    ...overrides,
  };
}

function makePolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return {
    maxAttempts: 3,
    initialDelayMs: 200,
    backoffFactor: 2.0,
    maxDelayMs: 60_000,
    jitter: false,
    ...overrides,
  };
}

function makeHandler(outcomes: Outcome[]): Handler {
  let call = 0;
  return {
    async execute(): Promise<Outcome> {
      return outcomes[call++] ?? { status: "success" };
    },
  };
}

function makeThrowingHandler(errorMsg: string): Handler {
  return {
    async execute(): Promise<Outcome> {
      throw new Error(errorMsg);
    },
  };
}

const NOOP_CONFIG = {};

// --- buildRetryPolicy ---

describe("buildRetryPolicy", () => {
  it("uses node.maxRetries when > 0", () => {
    const node = makeNode({ maxRetries: 3 });
    const graph = makeGraph(1);
    const policy = buildRetryPolicy(node, graph);
    expect(policy.maxAttempts).toBe(4); // 3 retries + 1 initial
  });

  it("falls back to graph.attributes.defaultMaxRetry when node.maxRetries === 0", () => {
    const node = makeNode({ maxRetries: 0 });
    const graph = makeGraph(5);
    const policy = buildRetryPolicy(node, graph);
    expect(policy.maxAttempts).toBe(6); // 5 retries + 1 initial
  });

  it("returns maxAttempts=1 when both maxRetries and defaultMaxRetry are 0", () => {
    const node = makeNode({ maxRetries: 0 });
    const graph = makeGraph(0);
    const policy = buildRetryPolicy(node, graph);
    expect(policy.maxAttempts).toBe(1);
  });

  it("always sets fixed defaults for initialDelayMs, backoffFactor, maxDelayMs, jitter", () => {
    const policy = buildRetryPolicy(makeNode(), makeGraph());
    expect(policy.initialDelayMs).toBe(200);
    expect(policy.backoffFactor).toBe(2.0);
    expect(policy.maxDelayMs).toBe(60_000);
    expect(policy.jitter).toBe(true);
  });
});

// --- delayForAttempt ---

describe("delayForAttempt", () => {
  it("returns initialDelayMs for attempt=1 (no jitter)", () => {
    const policy = makePolicy({ jitter: false });
    expect(delayForAttempt(1, policy)).toBe(200);
  });

  it("doubles the delay for each subsequent attempt", () => {
    const policy = makePolicy({ jitter: false });
    expect(delayForAttempt(2, policy)).toBe(400);
    expect(delayForAttempt(3, policy)).toBe(800);
    expect(delayForAttempt(4, policy)).toBe(1600);
  });

  it("caps at maxDelayMs", () => {
    const policy = makePolicy({ jitter: false, maxDelayMs: 1000 });
    // attempt=10: 200 * 2^9 = 102400 → capped at 1000
    expect(delayForAttempt(10, policy)).toBe(1000);
  });

  it("large attempt number is capped at maxDelayMs=60000", () => {
    const policy = makePolicy({ jitter: false });
    const delay = delayForAttempt(100, policy);
    expect(delay).toBe(60_000);
  });

  it("with jitter returns value in [base * 0.5, base * 1.5]", () => {
    const policy = makePolicy({ jitter: true });
    // attempt=1: base=200; jitter range 100-300
    for (let i = 0; i < 50; i++) {
      const d = delayForAttempt(1, policy);
      expect(d).toBeGreaterThanOrEqual(100);
      expect(d).toBeLessThanOrEqual(300);
    }
  });

  it("with jitter caps after applying multiplier (base already capped before jitter)", () => {
    // maxDelayMs=500 so base caps at 500, then jitter multiplies
    // Result can exceed 500 but formula applies jitter after capping
    const policy = makePolicy({ jitter: true, maxDelayMs: 500 });
    for (let i = 0; i < 20; i++) {
      const d = delayForAttempt(100, policy);
      // base = 500 (capped), then * (0.5..1.5) → 250..750
      expect(d).toBeGreaterThanOrEqual(250);
      expect(d).toBeLessThanOrEqual(750);
    }
  });
});

// --- executeWithRetry ---

describe("executeWithRetry", () => {
  it("returns success immediately on first success", async () => {
    const handler = makeHandler([{ status: "success" }]);
    const policy = makePolicy({ maxAttempts: 3 });
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("success");
  });

  it("returns fail immediately without retrying", async () => {
    let calls = 0;
    const handler: Handler = {
      async execute(): Promise<Outcome> {
        calls++;
        return { status: "fail", failureReason: "hard failure" };
      },
    };
    const policy = makePolicy({ maxAttempts: 3 });
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("fail");
    expect(result.failureReason).toBe("hard failure");
    expect(calls).toBe(1); // no retry on FAIL
  });

  it("retries on RETRY status and succeeds on next attempt", async () => {
    const handler = makeHandler([
      { status: "retry" },
      { status: "success" },
    ]);
    const policy = makePolicy({ maxAttempts: 3, jitter: false, initialDelayMs: 0 });
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("success");
  });

  it("returns fail after exhausting retries (no allowPartial)", async () => {
    const handler = makeHandler([
      { status: "retry" },
      { status: "retry" },
      { status: "retry" },
    ]);
    const policy = makePolicy({ maxAttempts: 3, jitter: false, initialDelayMs: 0 });
    const node = makeNode({ allowPartial: false });
    const result = await executeWithRetry(
      handler, node, new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("fail");
    expect(result.failureReason).toBe("max retries exceeded");
  });

  it("returns partial_success after exhausting retries when allowPartial=true", async () => {
    const handler = makeHandler([
      { status: "retry" },
      { status: "retry" },
      { status: "retry" },
    ]);
    const policy = makePolicy({ maxAttempts: 3, jitter: false, initialDelayMs: 0 });
    const node = makeNode({ allowPartial: true });
    const result = await executeWithRetry(
      handler, node, new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("partial_success");
    expect(result.notes).toBe("retries exhausted");
  });

  it("throws are caught and retried; on final attempt returns fail", async () => {
    const handler = makeThrowingHandler("boom");
    const policy = makePolicy({ maxAttempts: 2, jitter: false, initialDelayMs: 0 });
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("fail");
    expect(result.failureReason).toBe("boom");
  });

  it("throws on intermediate attempts are retried, success on final attempt", async () => {
    let calls = 0;
    const handler: Handler = {
      async execute(): Promise<Outcome> {
        calls++;
        if (calls < 3) throw new Error("transient");
        return { status: "success" };
      },
    };
    const policy = makePolicy({ maxAttempts: 3, jitter: false, initialDelayMs: 0 });
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("success");
    expect(calls).toBe(3);
  });

  it("emits stage_retrying event on retry", async () => {
    const handler = makeHandler([{ status: "retry" }, { status: "success" }]);
    const policy = makePolicy({ maxAttempts: 2, jitter: false, initialDelayMs: 0 });
    const events: unknown[] = [];
    const config = { onEvent: (e: unknown) => { events.push(e); } };
    await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), config, policy
    );
    expect(events).toHaveLength(1);
    expect((events[0] as { kind: string }).kind).toBe("stage_retrying");
  });

  it("emits error event when final attempt throws", async () => {
    const handler = makeThrowingHandler("fatal");
    const policy = makePolicy({ maxAttempts: 1, jitter: false, initialDelayMs: 0 });
    const events: unknown[] = [];
    const config = { onEvent: (e: unknown) => { events.push(e); } };
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), config, policy
    );
    expect(result.status).toBe("fail");
    const errorEvent = events.find((e) => (e as { kind: string }).kind === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { message: string }).message).toBe("fatal");
  });

  it("respects initialAttempt to skip earlier attempts (resume behaviour)", async () => {
    let calls = 0;
    const handler: Handler = {
      async execute(): Promise<Outcome> {
        calls++;
        return { status: "success" };
      },
    };
    // maxAttempts=3 but initialAttempt=3 means only one iteration runs
    const policy = makePolicy({ maxAttempts: 3, jitter: false, initialDelayMs: 0 });
    await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy,
      3 // initialAttempt
    );
    expect(calls).toBe(1);
  });

  it("passes through partial_success from handler immediately", async () => {
    const handler = makeHandler([{ status: "partial_success", notes: "ok-ish" }]);
    const policy = makePolicy({ maxAttempts: 3 });
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("partial_success");
    expect(result.notes).toBe("ok-ish");
  });

  it("clamps initialAttempt when it exceeds maxAttempts (BUG-012: resume with lowered retry policy)", async () => {
    let calls = 0;
    const handler: Handler = {
      async execute(): Promise<Outcome> {
        calls++;
        return { status: "success" };
      },
    };
    // maxAttempts=2 but initialAttempt=5 simulates a resumed checkpoint where
    // the stored nodeRetries (4) exceeds the current policy (maxAttempts=2).
    // Without the clamp, the loop never runs and the node silently fails.
    const policy = makePolicy({ maxAttempts: 2, jitter: false, initialDelayMs: 0 });
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy,
      5 // initialAttempt exceeds maxAttempts
    );
    expect(result.status).toBe("success");
    expect(calls).toBe(1); // handler must run at least once
  });

  it("passes through skipped outcome without retrying", async () => {
    const handler = makeHandler([{ status: "skipped" }]);
    const policy = makePolicy({ maxAttempts: 3 });
    const result = await executeWithRetry(
      handler, makeNode(), new Context(), makeGraph(), NOOP_CONFIG, policy
    );
    expect(result.status).toBe("skipped");
  });
});
