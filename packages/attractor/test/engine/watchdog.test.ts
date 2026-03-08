import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createWatchdog,
  trackActivity,
  registerNode,
  unregisterNode,
  stopWatchdog,
} from "../../src/engine/watchdog.js";

describe("watchdog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a watchdog with correct idle and poll settings", () => {
    const watchdog = createWatchdog(5000, 1000, () => {});
    expect(watchdog.idleMs).toBe(5000);
    expect(watchdog.pollMs).toBe(1000);
    expect(watchdog.nodes.size).toBe(0);
    stopWatchdog(watchdog);
  });

  it("kills an idle node after the idle timeout", () => {
    const killed: string[] = [];
    const watchdog = createWatchdog(5000, 1000, (nodeId) => killed.push(nodeId));

    const controller = new AbortController();
    registerNode(watchdog, "work", controller);

    // Advance past the idle timeout
    vi.advanceTimersByTime(6000);

    expect(killed).toContain("work");
    expect(controller.signal.aborted).toBe(true);
    stopWatchdog(watchdog);
  });

  it("does not kill a node that is regularly receiving activity", () => {
    const killed: string[] = [];
    const watchdog = createWatchdog(5000, 1000, (nodeId) => killed.push(nodeId));

    const controller = new AbortController();
    registerNode(watchdog, "active", controller);

    // Keep sending activity every 500ms — never exceeds 5s idle
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(500);
      trackActivity(watchdog, "active");
    }

    expect(killed).toHaveLength(0);
    expect(controller.signal.aborted).toBe(false);
    stopWatchdog(watchdog);
  });

  it("trackActivity updates lastActivity timestamp", () => {
    const watchdog = createWatchdog(5000, 1000, () => {});
    const controller = new AbortController();
    registerNode(watchdog, "node", controller);

    // Advance 4s — not yet idle
    vi.advanceTimersByTime(4000);
    // Send activity to reset timer
    trackActivity(watchdog, "node");
    // Advance another 4s — still less than 5s since last activity
    vi.advanceTimersByTime(4000);

    expect(controller.signal.aborted).toBe(false);
    stopWatchdog(watchdog);
  });

  it("unregistered node is not killed", () => {
    const killed: string[] = [];
    const watchdog = createWatchdog(5000, 1000, (nodeId) => killed.push(nodeId));

    const controller = new AbortController();
    registerNode(watchdog, "work", controller);
    // Unregister before idle timeout fires
    unregisterNode(watchdog, "work");

    vi.advanceTimersByTime(6000);

    expect(killed).toHaveLength(0);
    expect(controller.signal.aborted).toBe(false);
    stopWatchdog(watchdog);
  });

  it("stopWatchdog prevents further kills", () => {
    const killed: string[] = [];
    const watchdog = createWatchdog(5000, 1000, (nodeId) => killed.push(nodeId));

    const controller = new AbortController();
    registerNode(watchdog, "work", controller);

    // Stop before idle timeout
    stopWatchdog(watchdog);

    // Advance past idle — should not fire since interval was cleared
    vi.advanceTimersByTime(10000);

    expect(killed).toHaveLength(0);
    expect(controller.signal.aborted).toBe(false);
  });

  it("stopWatchdog is idempotent", () => {
    const watchdog = createWatchdog(5000, 1000, () => {});
    stopWatchdog(watchdog);
    expect(() => stopWatchdog(watchdog)).not.toThrow();
    expect(watchdog.interval).toBeNull();
  });

  it("tracks multiple nodes independently", () => {
    const killed: string[] = [];
    const watchdog = createWatchdog(5000, 1000, (nodeId) => killed.push(nodeId));

    const c1 = new AbortController();
    const c2 = new AbortController();
    registerNode(watchdog, "fast", c1);
    registerNode(watchdog, "slow", c2);

    // Keep "slow" alive with activity
    vi.advanceTimersByTime(3000);
    trackActivity(watchdog, "slow");
    vi.advanceTimersByTime(3000); // "fast" has now been idle 6s total

    expect(killed).toContain("fast");
    expect(c1.signal.aborted).toBe(true);
    // "slow" had activity at 3s, only 3s idle at the 6s mark — still alive
    expect(killed).not.toContain("slow");
    expect(c2.signal.aborted).toBe(false);
    stopWatchdog(watchdog);
  });

  it("killed node is removed from nodes map", () => {
    const watchdog = createWatchdog(5000, 1000, () => {});
    const controller = new AbortController();
    registerNode(watchdog, "work", controller);

    vi.advanceTimersByTime(6000);

    expect(watchdog.nodes.has("work")).toBe(false);
    stopWatchdog(watchdog);
  });
});
