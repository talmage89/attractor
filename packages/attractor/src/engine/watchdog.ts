export interface WatchdogNodeState {
  lastActivity: number;
  abortController: AbortController;
}

export interface WatchdogState {
  idleMs: number;
  pollMs: number;
  nodes: Map<string, WatchdogNodeState>;
  interval: ReturnType<typeof setInterval> | null;
  emit: (nodeId: string) => void;
}

/**
 * Create a watchdog and start its polling interval.
 * `emit` is called with the nodeId when a node is killed for idleness.
 */
export function createWatchdog(
  idleMs: number,
  pollMs: number,
  emit: (nodeId: string) => void
): WatchdogState {
  const state: WatchdogState = {
    idleMs,
    pollMs,
    nodes: new Map(),
    interval: null,
    emit,
  };

  state.interval = setInterval(() => {
    const now = Date.now();
    for (const [nodeId, nodeState] of state.nodes) {
      if (now - nodeState.lastActivity >= idleMs) {
        emit(nodeId);
        nodeState.abortController.abort();
        state.nodes.delete(nodeId);
      }
    }
  }, pollMs);

  // Don't let the interval keep Node.js alive past pipeline completion
  if (state.interval.unref) {
    state.interval.unref();
  }

  return state;
}

/**
 * Update the last-activity timestamp for a tracked node.
 * No-op if the node is not currently registered.
 */
export function trackActivity(watchdog: WatchdogState, nodeId: string): void {
  const nodeState = watchdog.nodes.get(nodeId);
  if (nodeState) {
    nodeState.lastActivity = Date.now();
  }
}

/**
 * Register a node for watchdog tracking.
 */
export function registerNode(
  watchdog: WatchdogState,
  nodeId: string,
  abortController: AbortController
): void {
  watchdog.nodes.set(nodeId, {
    lastActivity: Date.now(),
    abortController,
  });
}

/**
 * Remove a node from watchdog tracking (called after node completes normally).
 */
export function unregisterNode(watchdog: WatchdogState, nodeId: string): void {
  watchdog.nodes.delete(nodeId);
}

/**
 * Stop the watchdog polling interval.
 */
export function stopWatchdog(watchdog: WatchdogState): void {
  if (watchdog.interval !== null) {
    clearInterval(watchdog.interval);
    watchdog.interval = null;
  }
}
