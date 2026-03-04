#!/usr/bin/env node
import { parseArgs } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "./parser/parser.js";
import { validate } from "./validation/validator.js";
import { applyTransforms } from "./engine/transforms.js";
import { run } from "./engine/runner.js";
import { HandlerRegistry } from "./handlers/registry.js";
import { CodergenHandler } from "./handlers/codergen.js";
import { ToolHandler } from "./handlers/tool.js";
import { ParallelHandler } from "./handlers/parallel.js";
import { FanInHandler } from "./handlers/fan-in.js";
import { ConditionalHandler } from "./handlers/conditional.js";
import { SessionManager } from "./backend/session-manager.js";
import { AutoApproveInterviewer } from "./interviewer/auto-approve.js";
import { ConsoleInterviewer } from "./interviewer/console.js";
import type { PipelineEvent } from "./model/events.js";

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

function formatTimestamp(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `[${padTwo(minutes)}:${padTwo(seconds)}]`;
}

function formatCost(costUsd?: number): string {
  if (costUsd == null) return "";
  return `, $${costUsd.toFixed(2)}`;
}

export function formatEvent(event: PipelineEvent, startTime: number): string {
  const ts = formatTimestamp(event.timestamp - startTime);
  switch (event.kind) {
    case "pipeline_started":
      return `${ts} Pipeline started: "${event.goal}"`;
    case "stage_started":
      return `${ts} ● ${event.nodeId} → running...`;
    case "stage_completed": {
      const durationS = (event.durationMs / 1000).toFixed(1);
      const cost = formatCost(event.costUsd);
      return `${ts} ● ${event.nodeId} → ${event.outcome.status} (${durationS}s${cost})`;
    }
    case "edge_selected": {
      const labelPart = event.label ? ` "${event.label}"` : "";
      return `${ts}  →${labelPart} → ${event.to}`;
    }
    case "human_question":
      return `${ts} [?] ${event.question.text}`;
    case "warning":
      return `${ts} ⚠ ${event.message}`;
    case "error":
      return `${ts} ✗ ${event.message}`;
    case "pipeline_completed": {
      const totalMs = event.durationMs;
      const mins = Math.floor(totalMs / 60000);
      const secs = Math.floor((totalMs % 60000) / 1000);
      return `${ts} Pipeline completed: ${event.status} (${mins}m ${secs}s)`;
    }
    case "parallel_started":
      return `${ts} ⊞ ${event.nodeId} → parallel (${event.branchCount} branches)`;
    case "parallel_branch_completed":
      return `${ts}   ├ ${event.nodeId} → ${event.outcome.status} (branch ${event.branchIndex + 1}/${event.totalBranches})`;
    case "parallel_completed":
      return `${ts} ⊞ ${event.nodeId} → done (${event.successCount} succeeded, ${event.failCount} failed)`;
    case "cc_event": {
      const msg = event.event as Record<string, unknown>;
      const type = String(msg["type"] ?? "unknown");
      const parts: string[] = [type];
      if (msg["subtype"]) parts.push(String(msg["subtype"]));
      if (type === "assistant") {
        const message = msg["message"] as Record<string, unknown> | undefined;
        if (message) {
          if (message["model"]) parts.push(String(message["model"]));
          const usage = message["usage"] as Record<string, unknown> | undefined;
          if (usage?.["output_tokens"]) parts.push(`${usage["output_tokens"]} tokens`);
        }
      } else if (type === "result") {
        if (msg["duration_ms"] != null) parts.push(`${msg["duration_ms"]}ms`);
        if (msg["total_cost_usd"] != null) parts.push(`$${(msg["total_cost_usd"] as number).toFixed(4)}`);
      } else if (type === "tool_progress") {
        if (msg["tool_name"]) parts.push(String(msg["tool_name"]));
      }
      return `${ts} [cc_event] ${parts.join(" ")}`;
    }
    default:
      if ("kind" in event) {
        return `${ts} [${(event as { kind: string }).kind}]`;
      }
      return `${ts} [event]`;
  }
}

export async function cmdRun(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      cwd: { type: "string" },
      logs: { type: "string" },
      resume: { type: "string" },
      "auto-approve": { type: "boolean", default: false },
      "permission-mode": { type: "string", default: "bypassPermissions" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });

  const dotfile = positionals[0];
  if (!dotfile) {
    process.stderr.write("Usage: attractor run <dotfile> [options]\n");
    process.exit(3);
  }

  const source = await fs.readFile(dotfile, "utf-8").catch(() => {
    process.stderr.write(`Error: cannot read file: ${dotfile}\n`);
    process.exit(3);
    return "" as never;
  });

  const graph = parse(source);
  applyTransforms(graph);
  const diags = validate(graph);
  const errors = diags.filter((d) => d.severity === "error");
  for (const d of diags) {
    process.stderr.write(`[${d.severity}] (${d.rule}) ${d.message}\n`);
  }
  if (errors.length > 0) {
    process.exit(2);
  }

  const workingCwd = (values.cwd as string | undefined) ?? process.cwd();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logsRoot = (values.logs as string | undefined) ?? path.join(".attractor", "runs", timestamp);

  const interviewer = (values["auto-approve"] as boolean)
    ? new AutoApproveInterviewer()
    : new ConsoleInterviewer();

  const startTime = Date.now();
  const verbose = values.verbose as boolean;

  const onEvent = (event: PipelineEvent) => {
    const line = formatEvent(event, startTime);
    if (
      verbose ||
      event.kind === "pipeline_started" ||
      event.kind === "pipeline_completed" ||
      event.kind === "stage_started" ||
      event.kind === "stage_completed" ||
      event.kind === "human_question" ||
      event.kind === "warning" ||
      event.kind === "error" ||
      event.kind === "parallel_started" ||
      event.kind === "parallel_branch_completed" ||
      event.kind === "parallel_completed"
    ) {
      process.stderr.write(line + "\n");
    }
  };

  // Build registry with CodergenHandler sharing the same SessionManager that the
  // runner will use for checkpoint persistence, so full-fidelity CC sessions
  // survive crash/resume cycles.
  const sessionManager = new SessionManager();
  const registry = new HandlerRegistry({
    async execute() { return { status: "success" }; },
  });
  registry.register("codergen", new CodergenHandler(sessionManager));
  registry.register("tool", new ToolHandler());
  registry.register("parallel", new ParallelHandler(registry));
  registry.register("parallel.fan_in", new FanInHandler());
  registry.register("conditional", new ConditionalHandler());

  let result;
  try {
    result = await run({
      graph,
      cwd: workingCwd,
      logsRoot,
      interviewer,
      onEvent,
      resumeFromCheckpoint: values.resume as string | undefined,
      ccPermissionMode: values["permission-mode"] as "default" | "acceptEdits" | "bypassPermissions",
      registry,
      sessionManager,
    });
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(3);
  }

  const durationS = (result.durationMs / 1000).toFixed(1);
  process.stdout.write(`\nStatus: ${result.status}\n`);
  process.stdout.write(`Completed nodes: ${result.completedNodes.join(", ")}\n`);
  process.stdout.write(`Duration: ${durationS}s\n`);
  if (result.totalCostUsd > 0) {
    process.stdout.write(`Total cost: $${result.totalCostUsd.toFixed(4)}\n`);
  }

  process.exit(result.status === "success" ? 0 : 1);
}

export async function cmdValidate(args: string[]): Promise<void> {
  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
  });

  const dotfile = positionals[0];
  if (!dotfile) {
    process.stderr.write("Usage: attractor validate <dotfile>\n");
    process.exit(3);
  }

  const source = await fs.readFile(dotfile, "utf-8").catch(() => {
    process.stderr.write(`Error: cannot read file: ${dotfile}\n`);
    process.exit(3);
    return "" as never;
  });

  const graph = parse(source);
  applyTransforms(graph);

  const diags = validate(graph);
  for (const d of diags) {
    process.stdout.write(`[${d.severity}] (${d.rule}) ${d.message}\n`);
  }

  const errors = diags.filter((d) => d.severity === "error");
  process.exit(errors.length > 0 ? 2 : 0);
}

export async function cmdVisualize(args: string[]): Promise<void> {
  const { positionals } = parseArgs({
    args,
    options: {},
    allowPositionals: true,
  });

  const dotfile = positionals[0];
  if (!dotfile) {
    process.stderr.write("Usage: attractor visualize <dotfile>\n");
    process.exit(3);
  }

  const source = await fs.readFile(dotfile, "utf-8").catch(() => {
    process.stderr.write(`Error: cannot read file: ${dotfile}\n`);
    process.exit(3);
    return "" as never;
  });

  const child = spawn("dot", ["-Tsvg"], { stdio: ["pipe", "inherit", "inherit"] });

  await new Promise<void>((resolve) => {
    child.on("error", () => {
      process.stderr.write(
        "Graphviz not found. Install it with: apt-get install graphviz (or brew install graphviz)\n"
      );
      process.exit(3);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        process.stderr.write(`Error: dot exited with code ${code}\n`);
        process.exit(3);
      }
      resolve();
    });

    child.stdin?.write(source);
    child.stdin?.end();
  });

  process.exit(0);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const rest = argv.slice(1);

  switch (command) {
    case "run":
      await cmdRun(rest);
      break;
    case "validate":
      await cmdValidate(rest);
      break;
    case "visualize":
      await cmdVisualize(rest);
      break;
    default:
      process.stderr.write(
        "Usage: attractor <command> [options]\n\nCommands:\n  run <dotfile>        Execute a pipeline\n  validate <dotfile>   Validate a DOT file\n  visualize <dotfile>  Generate SVG via Graphviz\n"
      );
      process.exit(1);
  }
}

// Only run when executed directly, not when imported by tests or other modules.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(3);
  });
}
