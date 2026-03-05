import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, "../dist/server.js");

// ─── LSP message helpers ──────────────────────────────────────────────────────

function encodeMessage(msg: object): Buffer {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(json, "utf8")]);
}

/**
 * Wait for an LSP response whose `id` matches the given value.
 * Notifications and requests from the server (no matching id) are ignored.
 */
function waitForResponse(proc: ChildProcess, id: number, timeoutMs = 8000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);

    const timer = setTimeout(() => {
      proc.stdout!.removeListener("data", onData);
      reject(new Error(`Timeout waiting for LSP response id=${id}`));
    }, timeoutMs);

    function onData(chunk: Buffer): void {
      buf = Buffer.concat([buf, chunk]);

      // Try to parse as many complete messages as possible
      while (true) {
        const str = buf.toString("utf8");
        const sep = str.indexOf("\r\n\r\n");
        if (sep === -1) break;

        const header = str.slice(0, sep);
        const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!lenMatch) break;

        const len = parseInt(lenMatch[1], 10);
        const headerByteLen = Buffer.byteLength(header + "\r\n\r\n", "utf8");
        if (buf.length < headerByteLen + len) break;

        const body = buf.slice(headerByteLen, headerByteLen + len).toString("utf8");
        buf = buf.slice(headerByteLen + len);

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(body) as Record<string, unknown>;
        } catch {
          continue;
        }

        // Check if this is the response we're waiting for
        if ("id" in msg && msg.id === id) {
          clearTimeout(timer);
          proc.stdout!.removeListener("data", onData);
          resolve(msg);
          return;
        }
      }
    }

    proc.stdout!.on("data", onData);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LSP server integration", () => {
  let server: ChildProcess | null = null;

  afterEach(() => {
    if (server) {
      server.kill("SIGTERM");
      server = null;
    }
  });

  it(
    "responds to initialize with textDocumentSync and documentFormattingProvider capabilities",
    async () => {
      server = spawn("node", [SERVER_PATH, "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      server.stdin!.write(
        encodeMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            processId: process.pid,
            capabilities: {},
            rootUri: null,
          },
        }),
      );

      const response = await waitForResponse(server, 1);
      expect(response.error).toBeUndefined();

      const result = response.result as Record<string, unknown>;
      expect(result).toBeDefined();

      const caps = result.capabilities as Record<string, unknown>;
      // textDocumentSync: Full = 1
      expect(caps.textDocumentSync).toBe(1);
      expect(caps.documentFormattingProvider).toBe(true);

      // Semantic tokens capability is advertised
      const stp = caps.semanticTokensProvider as Record<string, unknown>;
      expect(stp).toBeDefined();
      expect(stp.full).toBe(true);
      const legend = stp.legend as Record<string, unknown>;
      expect(Array.isArray(legend.tokenTypes)).toBe(true);
      expect((legend.tokenTypes as string[]).length).toBeGreaterThan(0);
      expect(Array.isArray(legend.tokenModifiers)).toBe(true);
    },
    10000,
  );

  it(
    "returns a TextEdit array for textDocument/formatting after opening a document",
    async () => {
      server = spawn("node", [SERVER_PATH, "--stdio"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const docUri = "file:///test.dag";
      const docText = `digraph G { start [shape=Mdiamond] start -> end end [shape=Msquare] }`;

      // Step 1: initialize
      server.stdin!.write(
        encodeMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { processId: process.pid, capabilities: {}, rootUri: null },
        }),
      );
      await waitForResponse(server, 1);

      // Step 2: initialized notification (no response expected)
      server.stdin!.write(
        encodeMessage({
          jsonrpc: "2.0",
          method: "initialized",
          params: {},
        }),
      );

      // Step 3: open the document
      server.stdin!.write(
        encodeMessage({
          jsonrpc: "2.0",
          method: "textDocument/didOpen",
          params: {
            textDocument: {
              uri: docUri,
              languageId: "attractor",
              version: 1,
              text: docText,
            },
          },
        }),
      );

      // Step 4: request formatting
      server.stdin!.write(
        encodeMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "textDocument/formatting",
          params: {
            textDocument: { uri: docUri },
            options: { tabSize: 2, insertSpaces: true },
          },
        }),
      );

      const response = await waitForResponse(server, 2);
      expect(response.error).toBeUndefined();

      const edits = response.result as Array<{ newText: string }>;
      expect(Array.isArray(edits)).toBe(true);
      expect(edits.length).toBe(1);
      // The formatted output should contain quoted attribute values
      expect(edits[0].newText).toContain('shape = "Mdiamond"');
      expect(edits[0].newText).toContain('shape = "Msquare"');
    },
    10000,
  );
});
