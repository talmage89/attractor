/**
 * Session 3: LSP server integration tests via JSON-RPC over stdio.
 * Tests things NOT covered by the existing integration.test.ts:
 *  - didChange triggers diagnostics publication
 *  - diagnostics are published as notifications
 *  - shutdown/exit lifecycle
 *  - formatting a file with errors returns []
 *  - formatting a file not opened returns []
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, 'dist/server.js');

let passed = 0;
let failed = 0;
const bugs = [];

function test(name, fn) {
  return fn().then(() => {
    console.log(`  PASS: ${name}`);
    passed++;
  }).catch(e => {
    console.log(`  FAIL: ${name}`);
    console.log(`    ${e.message}`);
    failed++;
    bugs.push({ name, error: e.message });
  });
}

function encodeMessage(msg) {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'ascii'), Buffer.from(json, 'utf8')]);
}

function spawnServer() {
  return spawn('node', [SERVER_PATH, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function collectResponse(proc, id, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      proc.stdout.removeListener('data', onData);
      reject(new Error(`Timeout waiting for LSP response id=${id}`));
    }, timeoutMs);

    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const str = buf.toString('utf8');
        const sep = str.indexOf('\r\n\r\n');
        if (sep === -1) break;
        const header = str.slice(0, sep);
        const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!lenMatch) break;
        const len = parseInt(lenMatch[1], 10);
        const headerByteLen = Buffer.byteLength(header + '\r\n\r\n', 'utf8');
        if (buf.length < headerByteLen + len) break;
        const body = buf.slice(headerByteLen, headerByteLen + len).toString('utf8');
        buf = buf.slice(headerByteLen + len);
        let msg;
        try { msg = JSON.parse(body); } catch { continue; }
        if ('id' in msg && msg.id === id) {
          clearTimeout(timer);
          proc.stdout.removeListener('data', onData);
          resolve(msg);
          return;
        }
      }
    }
    proc.stdout.on('data', onData);
  });
}

/** Collect a notification (method name, no id) */
function collectNotification(proc, method, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      proc.stdout.removeListener('data', onData);
      reject(new Error(`Timeout waiting for notification ${method}`));
    }, timeoutMs);

    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const str = buf.toString('utf8');
        const sep = str.indexOf('\r\n\r\n');
        if (sep === -1) break;
        const header = str.slice(0, sep);
        const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!lenMatch) break;
        const len = parseInt(lenMatch[1], 10);
        const headerByteLen = Buffer.byteLength(header + '\r\n\r\n', 'utf8');
        if (buf.length < headerByteLen + len) break;
        const body = buf.slice(headerByteLen, headerByteLen + len).toString('utf8');
        buf = buf.slice(headerByteLen + len);
        let msg;
        try { msg = JSON.parse(body); } catch { continue; }
        if (msg.method === method) {
          clearTimeout(timer);
          proc.stdout.removeListener('data', onData);
          resolve(msg);
          return;
        }
      }
    }
    proc.stdout.on('data', onData);
  });
}

async function initServer(proc) {
  proc.stdin.write(encodeMessage({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { processId: process.pid, capabilities: {}, rootUri: null },
  }));
  await collectResponse(proc, 1);
  proc.stdin.write(encodeMessage({
    jsonrpc: '2.0', method: 'initialized', params: {},
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log('\n=== LSP server integration ===');

await test('didOpen triggers publishDiagnostics notification for invalid file', async () => {
  const proc = spawnServer();
  try {
    await initServer(proc);

    const diagPromise = collectNotification(proc, 'textDocument/publishDiagnostics');

    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///test.dag',
          languageId: 'attractor',
          version: 1,
          text: `digraph G { a [shape=box, type=badtype] a -> b b [shape=box] }`,
        },
      },
    }));

    const notif = await diagPromise;
    if (notif.params.uri !== 'file:///test.dag') throw new Error(`Wrong URI: ${notif.params.uri}`);
    if (!Array.isArray(notif.params.diagnostics)) throw new Error('diagnostics not an array');
    console.log(`    Got ${notif.params.diagnostics.length} diagnostics`);
    // Should have at least: start_node, terminal_node, type_known
    if (notif.params.diagnostics.length < 3) throw new Error(`Expected >=3 diagnostics, got ${notif.params.diagnostics.length}`);
  } finally {
    proc.kill('SIGTERM');
  }
});

await test('didOpen with valid file publishes empty diagnostics', async () => {
  const proc = spawnServer();
  try {
    await initServer(proc);

    const diagPromise = collectNotification(proc, 'textDocument/publishDiagnostics');

    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///test.dag',
          languageId: 'attractor',
          version: 1,
          text: `digraph G {\n  start [shape=Mdiamond]\n  start -> end\n  end [shape=Msquare]\n}`,
        },
      },
    }));

    const notif = await diagPromise;
    if (notif.params.diagnostics.length !== 0) {
      throw new Error(`Expected 0 diagnostics, got ${notif.params.diagnostics.length}: ${JSON.stringify(notif.params.diagnostics.map(d => d.code))}`);
    }
  } finally {
    proc.kill('SIGTERM');
  }
});

await test('didChange triggers publishDiagnostics notification', async () => {
  const proc = spawnServer();
  try {
    await initServer(proc);

    // Open valid file first
    const firstDiagPromise = collectNotification(proc, 'textDocument/publishDiagnostics');
    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///test.dag',
          languageId: 'attractor',
          version: 1,
          text: `digraph G {\n  start [shape=Mdiamond]\n  start -> end\n  end [shape=Msquare]\n}`,
        },
      },
    }));
    const firstDiag = await firstDiagPromise;
    if (firstDiag.params.diagnostics.length !== 0) throw new Error('Expected 0 diags on open');

    // Now change to invalid content
    const secondDiagPromise = collectNotification(proc, 'textDocument/publishDiagnostics');
    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didChange',
      params: {
        textDocument: { uri: 'file:///test.dag', version: 2 },
        contentChanges: [{ text: `digraph G { a [shape=box, type=unknown] }` }],
      },
    }));

    const secondDiag = await secondDiagPromise;
    console.log(`    Got ${secondDiag.params.diagnostics.length} diagnostics after change`);
    if (secondDiag.params.diagnostics.length === 0) throw new Error('Expected diagnostics after changing to invalid file');
    // Should have start_node, terminal_node errors plus type_known warning
    const hasBoth = secondDiag.params.diagnostics.some(d => d.code === 'start_node') &&
                    secondDiag.params.diagnostics.some(d => d.code === 'terminal_node');
    if (!hasBoth) throw new Error(`Expected start_node + terminal_node diagnostics. Got: ${JSON.stringify(secondDiag.params.diagnostics.map(d => d.code))}`);
  } finally {
    proc.kill('SIGTERM');
  }
});

await test('formatting request for document not opened returns []', async () => {
  const proc = spawnServer();
  try {
    await initServer(proc);

    // Don't open any document — just request formatting
    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', id: 2, method: 'textDocument/formatting',
      params: {
        textDocument: { uri: 'file:///not-opened.dag' },
        options: { tabSize: 2, insertSpaces: true },
      },
    }));

    const response = await collectResponse(proc, 2);
    // Should return [] or null — the doc is not in documents manager
    console.log(`    Response result: ${JSON.stringify(response.result)}`);
    if (response.error) throw new Error(`Got error: ${JSON.stringify(response.error)}`);
    // Per server.ts: if (!doc) return []
    const result = response.result;
    if (!Array.isArray(result) && result !== null) {
      throw new Error(`Expected [] or null, got: ${JSON.stringify(result)}`);
    }
    if (Array.isArray(result) && result.length > 0) {
      throw new Error(`Expected empty array for un-opened doc, got ${result.length} edits`);
    }
  } finally {
    proc.kill('SIGTERM');
  }
});

await test('diagnostics have correct source field in LSP notification', async () => {
  const proc = spawnServer();
  try {
    await initServer(proc);

    const diagPromise = collectNotification(proc, 'textDocument/publishDiagnostics');

    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///test.dag',
          languageId: 'attractor',
          version: 1,
          text: `digraph G { a [shape=box, type=badtype] }`,
        },
      },
    }));

    const notif = await diagPromise;
    for (const d of notif.params.diagnostics) {
      if (d.source !== 'attractor') throw new Error(`Expected source='attractor', got '${d.source}' for code '${d.code}'`);
      if (typeof d.severity !== 'number') throw new Error(`Expected numeric severity, got ${typeof d.severity} for code '${d.code}'`);
      if (!d.range || typeof d.range.start.line !== 'number') throw new Error(`Invalid range for code '${d.code}'`);
    }
    console.log(`    All ${notif.params.diagnostics.length} diagnostics have correct shape`);
  } finally {
    proc.kill('SIGTERM');
  }
});

await test('formatting a file with a lex error returns empty edits (not crash)', async () => {
  const proc = spawnServer();
  try {
    await initServer(proc);

    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///test.dag',
          languageId: 'attractor',
          version: 1,
          text: `digraph G { @@@invalid }`,
        },
      },
    }));
    // Wait for publishDiagnostics
    await collectNotification(proc, 'textDocument/publishDiagnostics');

    // Now request formatting — should return [] since lex fails
    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', id: 3, method: 'textDocument/formatting',
      params: {
        textDocument: { uri: 'file:///test.dag' },
        options: { tabSize: 2, insertSpaces: true },
      },
    }));

    const response = await collectResponse(proc, 3);
    if (response.error) throw new Error(`Got error: ${JSON.stringify(response.error)}`);
    const result = response.result;
    console.log(`    Formatting result for lex-error file: ${JSON.stringify(result)}`);
    if (!Array.isArray(result)) throw new Error(`Expected array result, got ${JSON.stringify(result)}`);
    if (result.length !== 0) throw new Error(`Expected empty edits for broken file, got ${result.length} edits`);
  } finally {
    proc.kill('SIGTERM');
  }
});

await test('shutdown/exit lifecycle — server responds to shutdown', async () => {
  const proc = spawnServer();
  try {
    await initServer(proc);

    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', id: 99, method: 'shutdown', params: null,
    }));

    const response = await collectResponse(proc, 99);
    if (response.error) throw new Error(`shutdown failed: ${JSON.stringify(response.error)}`);
    console.log(`    Shutdown response result: ${JSON.stringify(response.result)}`);
  } finally {
    proc.kill('SIGTERM');
  }
});

await test('parse error diagnostic has correct range from LSP server', async () => {
  const proc = spawnServer();
  try {
    await initServer(proc);

    const diagPromise = collectNotification(proc, 'textDocument/publishDiagnostics');
    const lexErrorText = `digraph G { @@@invalid }`;  // @ at column 13

    proc.stdin.write(encodeMessage({
      jsonrpc: '2.0', method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///test.dag',
          languageId: 'attractor',
          version: 1,
          text: lexErrorText,
        },
      },
    }));

    const notif = await diagPromise;
    const diags = notif.params.diagnostics;
    if (diags.length !== 1) throw new Error(`Expected 1 diagnostic, got ${diags.length}`);
    const d = diags[0];
    if (d.code !== 'parse_error') throw new Error(`Expected parse_error code, got ${d.code}`);
    // '@' is at 0-indexed char 12
    console.log(`    Parse error range: ${JSON.stringify(d.range)}`);
    if (d.range.start.line !== 0) throw new Error(`Expected line 0, got ${d.range.start.line}`);
    if (d.range.start.character !== 12) throw new Error(`Expected char 12, got ${d.range.start.character}`);
  } finally {
    proc.kill('SIGTERM');
  }
});

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (bugs.length > 0) {
  console.log('\nBUGS FOUND:');
  bugs.forEach(b => console.log(`  - ${b.name}: ${b.error}`));
}
process.exit(failed > 0 ? 1 : 0);
