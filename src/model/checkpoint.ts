import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface Checkpoint {
  timestamp: number;
  currentNode: string;
  completedNodes: string[];
  nodeRetries: Record<string, number>;
  contextValues: Record<string, unknown>;
  sessionMap: Record<string, string>;
}

export async function saveCheckpoint(
  checkpoint: Checkpoint,
  logsRoot: string
): Promise<void> {
  await fs.mkdir(logsRoot, { recursive: true });
  const filePath = path.join(logsRoot, "checkpoint.json");
  await fs.writeFile(filePath, JSON.stringify(checkpoint, null, 2), "utf-8");
}

export async function loadCheckpoint(filePath: string): Promise<Checkpoint> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    throw new Error(`Checkpoint file not found: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Checkpoint file contains invalid JSON: ${filePath}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Checkpoint file is not an object: ${filePath}`);
  }

  const obj = parsed as Record<string, unknown>;
  const required = [
    "timestamp",
    "currentNode",
    "completedNodes",
    "nodeRetries",
    "contextValues",
    "sessionMap",
  ];
  for (const field of required) {
    if (!(field in obj)) {
      throw new Error(`Checkpoint missing required field: ${field}`);
    }
  }

  return obj as unknown as Checkpoint;
}
