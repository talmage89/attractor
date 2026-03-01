import type { Handler } from "./registry.js";
import type { GraphNode, Graph } from "../model/graph.js";
import { outgoingEdges } from "../model/graph.js";
import type { Context } from "../model/context.js";
import type { RunConfig } from "../engine/runner.js";
import type { Outcome } from "../model/outcome.js";
import type { Interviewer } from "../interviewer/interviewer.js";

export function parseAcceleratorKey(label: string): string {
  // [K] Label
  const bracketMatch = label.match(/^\[([A-Za-z0-9])\]/);
  if (bracketMatch) return bracketMatch[1];

  // K) Label
  const parenMatch = label.match(/^([A-Za-z0-9])\)/);
  if (parenMatch) return parenMatch[1];

  // K - Label
  const dashMatch = label.match(/^([A-Za-z0-9]) - /);
  if (dashMatch) return dashMatch[1];

  // Fallback: first character uppercased
  return label[0]?.toUpperCase() ?? "?";
}

export class WaitForHumanHandler implements Handler {
  constructor(private interviewer: Interviewer) {}

  async execute(
    node: GraphNode,
    _context: Context,
    graph: Graph,
    _config: RunConfig
  ): Promise<Outcome> {
    const edges = outgoingEdges(graph, node.id);
    if (edges.length === 0) {
      return {
        status: "fail",
        failureReason: "No outgoing edges for human gate",
      };
    }

    const choices = edges.map((e) => ({
      key: parseAcceleratorKey(e.label || e.to),
      label: e.label || e.to,
      to: e.to,
    }));

    const question = {
      text: node.label || node.id,
      type: "multiple_choice" as const,
      options: choices.map((c) => ({ key: c.key, label: c.label })),
      stage: node.id,
    };

    const answer = await this.interviewer.ask(question);

    // Handle TIMEOUT or SKIPPED — try default choice
    if (answer.value === "TIMEOUT" || answer.value === "SKIPPED") {
      const defaultChoiceId = node.raw.get("human.default_choice");
      if (defaultChoiceId) {
        const defaultChoice = choices.find(
          (c) =>
            c.to === defaultChoiceId ||
            c.key.toLowerCase() === defaultChoiceId.toLowerCase() ||
            c.label.toLowerCase() === defaultChoiceId.toLowerCase()
        );
        if (defaultChoice) {
          return {
            status: "success",
            suggestedNextIds: [defaultChoice.to],
            contextUpdates: {
              "human.gate.selected": defaultChoice.key,
              "human.gate.label": defaultChoice.label,
            },
          };
        }
      }
      return {
        status: "fail",
        failureReason: "Human gate timed out or was skipped with no default choice",
      };
    }

    // Match answer by key or label (case-insensitive)
    const selected = choices.find(
      (c) =>
        c.key.toLowerCase() === answer.value.toLowerCase() ||
        c.label.toLowerCase() === answer.value.toLowerCase()
    );

    if (!selected) {
      return {
        status: "fail",
        failureReason: `Unknown choice: ${answer.value}`,
      };
    }

    return {
      status: "success",
      suggestedNextIds: [selected.to],
      contextUpdates: {
        "human.gate.selected": selected.key,
        "human.gate.label": selected.label,
      },
    };
  }
}
