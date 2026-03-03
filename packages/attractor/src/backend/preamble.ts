import type { FidelityMode } from "../model/fidelity.js";
import type { Context } from "../model/context.js";
import type { Graph } from "../model/graph.js";
import type { Outcome } from "../model/outcome.js";

export function generatePreamble(
  mode: FidelityMode,
  context: Context,
  graph: Graph,
  completedNodes: string[],
  nodeOutcomes: Map<string, Outcome>
): string {
  const goal = graph.attributes.goal || context.getString("graph.goal") || "";
  const total = graph.nodes.size;
  const completed = completedNodes.length;

  if (mode === "full") {
    return "";
  }

  if (mode === "truncate") {
    return [
      "## Pipeline Context",
      "",
      `**Goal:** ${goal}`,
    ].join("\n");
  }

  if (mode === "compact") {
    const lines: string[] = [
      "## Pipeline Context",
      "",
      `**Goal:** ${goal}`,
      `**Progress:** ${completed}/${total} stages complete`,
    ];

    if (completedNodes.length > 0) {
      lines.push("", "### Completed Stages");
      for (const nodeId of completedNodes) {
        const outcome = nodeOutcomes.get(nodeId);
        if (outcome) {
          lines.push(`- ${nodeId}: ${outcome.status} — ${outcome.notes ?? ""}`);
        } else {
          lines.push(`- ${nodeId}`);
        }
      }
    }

    const ctxKeys = context.keys().filter(k => !k.startsWith("__"));
    if (ctxKeys.length > 0) {
      lines.push("", "### Current Context");
      for (const k of ctxKeys) {
        lines.push(`- ${k}: ${context.getString(k)}`);
      }
    }

    return lines.join("\n");
  }

  if (mode === "summary:low") {
    const last = completedNodes[completedNodes.length - 1];
    const lastOutcome = last ? nodeOutcomes.get(last) : undefined;
    const lastStr = lastOutcome
      ? `, last outcome: ${lastOutcome.status}`
      : "";
    return [
      "## Pipeline Context",
      "",
      `Goal: ${goal}. ${completed} of ${total} stages completed${lastStr}.`,
    ].join("\n");
  }

  if (mode === "summary:medium") {
    const lines: string[] = [
      "## Pipeline Context",
      "",
      `**Goal:** ${goal}`,
      `**Progress:** ${completed}/${total} stages complete`,
    ];

    const recent = completedNodes.slice(-3);
    if (recent.length > 0) {
      lines.push("", "### Recent Stages");
      for (const nodeId of recent) {
        const outcome = nodeOutcomes.get(nodeId);
        if (outcome) {
          lines.push(`- ${nodeId}: ${outcome.status} — ${outcome.notes ?? ""}`);
        } else {
          lines.push(`- ${nodeId}`);
        }
      }
    }

    const ctxKeys = context.keys().filter(k => !k.startsWith("__"));
    if (ctxKeys.length > 0) {
      lines.push("", "### Active Context");
      for (const k of ctxKeys) {
        lines.push(`- ${k}: ${context.getString(k)}`);
      }
    }

    return lines.join("\n");
  }

  // summary:high
  const lines: string[] = [
    "## Pipeline Context",
    "",
    `**Goal:** ${goal}`,
    `**Progress:** ${completed}/${total} stages complete`,
    `**Detail:** All stage outcomes, complete context values, and failure reasons included below.`,
  ];

  if (completedNodes.length > 0) {
    lines.push("", "### All Completed Stages");
    for (const nodeId of completedNodes) {
      const outcome = nodeOutcomes.get(nodeId);
      if (outcome) {
        const failStr = outcome.failureReason ? ` (${outcome.failureReason})` : "";
        lines.push(`- ${nodeId}: ${outcome.status}${failStr} — ${outcome.notes ?? ""}`);
      } else {
        lines.push(`- ${nodeId}`);
      }
    }
  }

  const ctxKeys = context.keys().filter(k => !k.startsWith("__"));
  if (ctxKeys.length > 0) {
    lines.push("", "### Full Context");
    for (const k of ctxKeys) {
      lines.push(`- ${k}: ${context.getString(k)}`);
    }
  }

  return lines.join("\n");
}
