import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Graph, GraphNode } from "../model/graph.js";
import { outgoingEdges } from "../model/graph.js";
import type { Context } from "../model/context.js";
import type { Outcome, StageStatus } from "../model/outcome.js";
import type { Handler, RunConfig } from "../handlers/registry.js";
import type { SessionManager } from "../backend/session-manager.js";
import { resolveFidelity, resolveThreadId } from "../model/fidelity.js";
import { generatePreamble } from "../backend/preamble.js";
import { runCC } from "../backend/cc-backend.js";

export function parseEffort(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "high";
}

export function buildStatusInstruction(
  statusFilePath: string,
  node: GraphNode,
  graph: Graph
): string {
  const edges = outgoingEdges(graph, node.id);
  const edgeLabels = edges.map((e) => e.label).filter(Boolean);

  const lines = [
    "IMPORTANT — PIPELINE INTEGRATION:",
    "You are operating as a stage in an automated pipeline. When you have",
    "finished your work for this stage, you MUST write a status file to",
    "communicate your result to the pipeline engine.",
    "",
    "Write the following JSON file as your FINAL action:",
    `  Path: ${statusFilePath}`,
    "",
    "Schema:",
    "{",
    `  "outcome": "success" | "retry" | "fail",`,
    `  "preferred_next_label": "<optional: edge label to follow next>",`,
    `  "suggested_next_ids": [],`,
    `  "context_updates": { "<key>": "<value>" },`,
    `  "notes": "<brief summary of what you did>"`,
    "}",
    "",
    "Rules:",
    `- "outcome" is REQUIRED. Use "success" if you completed the task, "retry"`,
    `  if you made progress but need another attempt, "fail" if the task cannot`,
    `  be completed.`,
    `- "context_updates" is optional. Use it to pass data to subsequent stages.`,
    `  Keys should be descriptive (e.g., "files_changed", "test_results").`,
    `- "notes" is optional but recommended. Keep it under 200 characters.`,
  ];

  if (edgeLabels.length > 0) {
    lines.push(
      `- "preferred_next_label" can be one of: ${edgeLabels.map((l) => `"${l}"`).join(", ")}`
    );
  }

  lines.push("", "Do NOT skip writing this file. The pipeline cannot proceed without it.");

  return lines.join("\n");
}

export function parseStatusFile(data: unknown, nodeId: string): Outcome {
  if (!data || typeof data !== "object") {
    return {
      status: "fail",
      failureReason: `Invalid status file for node ${nodeId}`,
    };
  }

  const obj = data as Record<string, unknown>;
  const outcomeStr = typeof obj.outcome === "string" ? obj.outcome : undefined;

  let status: StageStatus;
  let defaultedFailReason: string | undefined;
  if (
    outcomeStr === "success" ||
    outcomeStr === "retry" ||
    outcomeStr === "fail" ||
    outcomeStr === "partial_success" ||
    outcomeStr === "skipped"
  ) {
    status = outcomeStr as StageStatus;
  } else {
    // Deliberate deviation from spec (Section 10.2 shows `?? "success"`): we
    // default to "fail" instead of "success" when the outcome field is missing
    // or unrecognised. This "fail-safe" behaviour prevents a pipeline from
    // silently succeeding when the codergen agent failed to write a valid
    // status.json (e.g. due to a crash, timeout, or output truncation). The
    // spec default of "success" could mask such failures entirely.
    status = "fail";
    defaultedFailReason = "Missing or unrecognised outcome field in status.json";
  }

  const result: Outcome = { status };

  if (typeof obj.preferred_next_label === "string") {
    result.preferredLabel = obj.preferred_next_label;
  }

  if (Array.isArray(obj.suggested_next_ids)) {
    result.suggestedNextIds = (obj.suggested_next_ids as unknown[]).filter(
      (x) => typeof x === "string"
    ) as string[];
  }

  if (obj.context_updates && typeof obj.context_updates === "object") {
    result.contextUpdates = obj.context_updates as Record<string, unknown>;
  }

  if (typeof obj.notes === "string") {
    result.notes = obj.notes;
  }

  if (status === "fail") {
    result.failureReason =
      defaultedFailReason ??
      (typeof obj.notes === "string" ? obj.notes : `Node ${nodeId} failed`);
  }

  return result;
}

export class CodergenHandler implements Handler {
  constructor(private sessionManager: SessionManager) {}

  async execute(
    node: GraphNode,
    context: Context,
    graph: Graph,
    config: RunConfig
  ): Promise<Outcome> {
    // 1. Build prompt ($goal substitution already done by applyTransforms)
    const prompt = node.prompt || node.label || node.id;

    // 2. Resolve fidelity and session
    // If this is the first node after a checkpoint resume and fidelity is "full",
    // degrade to "summary:high". In-memory CC sessions cannot be serialized
    // (only the sessionId is saved); resuming with full fidelity but no active
    // session would send no context at all (spec Section 10.3, step 6).
    let fidelity = resolveFidelity(node, graph, config.incomingEdge);
    if (config.firstNodeAfterResume && fidelity === "full") {
      fidelity = "summary:high";
    }
    const threadId = resolveThreadId(node, graph, config.incomingEdge, config.previousNodeId);

    let finalPrompt = prompt;
    let resumeSessionId: string | undefined;

    if (fidelity === "full") {
      const existing = this.sessionManager.getSessionId(threadId);
      if (existing) {
        resumeSessionId = existing;
      }
      // full fidelity: no preamble, use session resume
    } else {
      // Generate preamble for non-full fidelity
      const completedNodesStr = context.getString("__completedNodes");
      const nodeOutcomesStr = context.getString("__nodeOutcomes");

      const completedNodes: string[] = completedNodesStr
        ? (JSON.parse(completedNodesStr) as string[])
        : [];
      const nodeOutcomesArr: [string, Outcome][] = nodeOutcomesStr
        ? (JSON.parse(nodeOutcomesStr) as [string, Outcome][])
        : [];
      const nodeOutcomes = new Map<string, Outcome>(nodeOutcomesArr);

      const preamble = generatePreamble(fidelity, context, graph, completedNodes, nodeOutcomes);
      if (preamble) {
        finalPrompt = preamble + "\n\n" + prompt;
      }
    }

    // 3. Build status instruction
    const stageDir = path.join(config.logsRoot, node.id);

    // Guard against path traversal: node.id must not escape logsRoot
    const resolvedStageDir = path.resolve(stageDir);
    const resolvedLogsRoot = path.resolve(config.logsRoot);
    if (!resolvedStageDir.startsWith(resolvedLogsRoot + path.sep)) {
      throw new Error(`Node id '${node.id}' would escape logsRoot — path traversal rejected`);
    }

    const statusFilePath = path.join(stageDir, "status.json");
    const systemPromptAppend = buildStatusInstruction(statusFilePath, node, graph);

    // 4. Create stage directory and write prompt.md
    await fs.mkdir(stageDir, { recursive: true });
    await fs.writeFile(path.join(stageDir, "prompt.md"), finalPrompt, "utf-8");

    // 5. Call CC
    const ccOptions: Parameters<typeof runCC>[1] = {
      cwd: config.cwd,
      systemPromptAppend,
      permissionMode: config.ccPermissionMode,
    };

    if (node.llmModel) ccOptions.model = node.llmModel;
    if (node.reasoningEffort) ccOptions.reasoningEffort = parseEffort(node.reasoningEffort);
    if (node.timeout !== null && node.timeout !== undefined) ccOptions.timeout = node.timeout;
    if (resumeSessionId) ccOptions.resume = resumeSessionId;

    const ccResult = await runCC(finalPrompt, ccOptions, (sdkEvent) => {
      config.onEvent?.({ kind: "cc_event", nodeId: node.id, event: sdkEvent, timestamp: Date.now() });
    });

    // 6. Track session for full fidelity
    if (fidelity === "full" && ccResult.sessionId) {
      this.sessionManager.setSessionId(threadId, ccResult.sessionId);
    }

    // 7. Write response
    await fs.writeFile(path.join(stageDir, "response.md"), ccResult.text, "utf-8");

    // 8. Read status file
    let outcome: Outcome;
    let statusFileAbsent = false;
    try {
      const statusContent = await fs.readFile(statusFilePath, "utf-8");
      const statusData = JSON.parse(statusContent) as unknown;
      outcome = parseStatusFile(statusData, node.id);
    } catch {
      statusFileAbsent = true;
      // No status file or parse error — fall back to CC result
      if (ccResult.success) {
        outcome = {
          status: "success",
          notes: `Stage completed: ${node.id}`,
          contextUpdates: {
            last_stage: node.id,
            last_response: ccResult.text.slice(0, 200),
          },
        };
      } else {
        const failReason =
          ccResult.errors?.join("; ") || ccResult.errorSubtype || "CC execution failed";
        outcome = {
          status: "fail",
          failureReason: failReason,
        };
      }
    }

    // 8.5 AUTO STATUS: when auto_status=true and the CC agent ran successfully but
    // did not write a status file, override a fail outcome to success so the pipeline
    // can proceed past nodes that don't need to communicate structured results
    // (spec Section 9.5, step 9). The ccResult.success guard ensures we do NOT mask
    // CC infrastructure failures (e.g., no API key, process exit code 1).
    if (node.autoStatus && statusFileAbsent && ccResult.success && outcome.status === "fail") {
      outcome = {
        status: "success",
        notes: "auto-status: agent completed without writing status.json",
      };
    }

    // Propagate cost from CC result so callers can surface it in stage_completed events
    if (ccResult.costUsd > 0) {
      outcome.costUsd = ccResult.costUsd;
    }

    // 9. Write final status
    try {
      await fs.writeFile(statusFilePath, JSON.stringify(outcome, null, 2), "utf-8");
    } catch {
      // ignore write errors
    }

    return outcome;
  }
}
