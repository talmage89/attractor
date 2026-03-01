import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface CCBackendOptions {
  cwd: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
  maxTurns?: number;
  sessionId?: string;
  resume?: string;
  systemPromptAppend?: string;
  timeout?: number;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

export interface CCResult {
  text: string;
  sessionId: string;
  success: boolean;
  costUsd: number;
  numTurns: number;
  durationMs: number;
  errorSubtype?: string;
  errors?: string[];
}

export async function runCC(
  prompt: string,
  options: CCBackendOptions,
  onEvent?: (event: SDKMessage) => void
): Promise<CCResult> {
  const abortController = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  if (options.timeout !== undefined) {
    timeoutHandle = setTimeout(() => abortController.abort(), options.timeout);
  }

  const startTime = Date.now();
  let sessionId = "";
  let numTurns = 0;
  let resultMessage: Record<string, unknown> | null = null;

  try {
    const permissionMode = options.permissionMode ?? "default";
    const allowDangerouslySkipPermissions = permissionMode === "bypassPermissions";

    const queryOptions: Options = {
      cwd: options.cwd,
      abortController,
      permissionMode,
      allowDangerouslySkipPermissions,
    };

    if (options.model !== undefined) queryOptions.model = options.model;
    if (options.reasoningEffort !== undefined) queryOptions.effort = options.reasoningEffort;
    if (options.maxTurns !== undefined) queryOptions.maxTurns = options.maxTurns;
    if (options.sessionId !== undefined) queryOptions.sessionId = options.sessionId;
    if (options.resume !== undefined) queryOptions.resume = options.resume;
    if (options.systemPromptAppend !== undefined) {
      queryOptions.systemPrompt = {
        type: "preset",
        preset: "claude_code",
        append: options.systemPromptAppend,
      };
    }

    const gen = query({ prompt, options: queryOptions });

    for await (const message of gen) {
      onEvent?.(message);
      numTurns++;

      const msg = message as Record<string, unknown>;
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id as string;
      } else if (msg.type === "result") {
        resultMessage = msg;
      }
    }

    if (resultMessage === null) {
      return {
        text: "",
        sessionId,
        success: false,
        costUsd: 0,
        numTurns,
        durationMs: Date.now() - startTime,
        errorSubtype: "error_during_execution",
        errors: ["No result message received"],
      };
    }

    const success = resultMessage.subtype === "success";
    const resultSessionId = (resultMessage.session_id as string | undefined) || sessionId;

    return {
      text: success ? ((resultMessage.result as string) ?? "") : "",
      sessionId: resultSessionId,
      success,
      costUsd: (resultMessage.total_cost_usd as number | undefined) ?? 0,
      numTurns: (resultMessage.num_turns as number | undefined) ?? numTurns,
      durationMs: Date.now() - startTime,
      errorSubtype: success ? undefined : (resultMessage.subtype as string),
      errors: success ? undefined : ((resultMessage.errors as string[] | undefined) ?? []),
    };
  } catch (err) {
    return {
      text: "",
      sessionId,
      success: false,
      costUsd: 0,
      numTurns,
      durationMs: Date.now() - startTime,
      errorSubtype: "error_during_execution",
      errors: [err instanceof Error ? err.message : String(err)],
    };
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}
