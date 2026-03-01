import { spawn } from "node:child_process";
import type { Handler } from "./registry.js";
import type { GraphNode, Graph } from "../model/graph.js";
import type { Context } from "../model/context.js";
import type { RunConfig } from "../engine/runner.js";
import type { Outcome } from "../model/outcome.js";

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export async function runShellCommand(
  command: string,
  options: { cwd: string; timeoutMs: number }
): Promise<ShellResult> {
  return new Promise((resolve) => {
    let timedOut = false;

    // Use detached:true so we can kill the entire process group (kills child processes too)
    const child = spawn("/bin/sh", ["-c", command], {
      cwd: options.cwd,
      detached: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const killProcessGroup = (signal: NodeJS.Signals) => {
      try {
        if (child.pid != null) process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* already dead */ }
      }
    };

    const killTimer = setTimeout(() => {
      timedOut = true;
      killProcessGroup("SIGTERM");
      setTimeout(() => killProcessGroup("SIGKILL"), 2000);
    }, options.timeoutMs);

    child.on("close", (code: number | null) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });

    child.on("error", (err: Error) => {
      clearTimeout(killTimer);
      resolve({ stdout, stderr: err.message, exitCode: 1, timedOut: false });
    });
  });
}

const MAX_OUTPUT_LENGTH = 5000;

export class ToolHandler implements Handler {
  async execute(
    node: GraphNode,
    _context: Context,
    _graph: Graph,
    config: RunConfig
  ): Promise<Outcome> {
    // $goal substitution is applied to tool_command by applyTransforms before
    // the handler is invoked. Other context variable interpolation is not supported.
    const command = node.raw.get("tool_command");
    if (!command) {
      return { status: "fail", failureReason: "No tool_command specified" };
    }

    const timeoutMs = node.timeout ?? 30_000;
    const result = await runShellCommand(command, { cwd: config.cwd, timeoutMs });

    const output = result.stdout.slice(0, MAX_OUTPUT_LENGTH);
    const contextUpdates: Record<string, string> = {
      "tool.output": output,
      "tool.exit_code": String(result.exitCode),
      "tool.stderr": result.stderr.slice(0, MAX_OUTPUT_LENGTH),
    };

    if (result.exitCode === 0 && !result.timedOut) {
      return { status: "success", contextUpdates };
    } else {
      // Truncate failureReason to the first line of stderr (max 200 chars) so
      // that large multi-line compiler/test output does not pollute pipeline
      // events and checkpoints. Full stderr is preserved in contextUpdates.
      const stderrFirstLine = result.stderr.split("\n")[0].slice(0, 200);
      return {
        status: "fail",
        failureReason: result.timedOut
          ? "Command timed out"
          : stderrFirstLine || `Exit code: ${result.exitCode}`,
        contextUpdates,
      };
    }
  }
}
