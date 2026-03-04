export const Models = {
  OPUS: "claude-opus-4-6",
  SONNET: "claude-sonnet-4-6",
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

export type ModelAlias = keyof typeof Models;

const ALIAS_MAP: Record<string, string> = {
  opus: Models.OPUS,
  sonnet: Models.SONNET,
  haiku: Models.HAIKU,
};

/**
 * Resolve a model string. If it matches a known alias (case-insensitive),
 * return the full model ID. Otherwise return the input unchanged (it may
 * be a full model ID or a third-party model name).
 */
export function resolveModel(input: string): string {
  return ALIAS_MAP[input.toLowerCase()] ?? input;
}
