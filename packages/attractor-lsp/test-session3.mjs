import { TextDocument } from "vscode-languageserver-textdocument";
import { format } from "./dist/formatter.js";
import { computeDiagnostics } from "./dist/diagnostics.js";
import { parse } from "attractor";

function makeDoc(text) {
  return TextDocument.create("file:///test.dag", "attractor", 1, text);
}

function formatted(text) {
  const edits = format(makeDoc(text));
  if (edits.length === 0) return null;
  return edits[0].newText;
}

let passed = 0;
let failed = 0;
const bugs = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${name}`);
    console.log(`    ${e.message}`);
    failed++;
    bugs.push({ name, error: e.message });
  }
}

// ─── SECTION 1: Implicit node spans in diagnostics ───────────────────────────
console.log("\n=== Implicit node span behavior ===");

test("reachability diagnostic for implicit node falls back to document start", () => {
  // 'orphan' is referenced only in an edge from another file that doesn't appear in the graph.
  // Actually let's make an implicit orphan: reference it in no outgoing edge from start.
  // Easiest: just declare a node and don't connect it, so it's unreachable.
  // Implicit node: appears only as edge target, not declared explicitly.
  // If 'ghost' only appears as a target, it's an implicit node with no span.
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  start -> end`,
    `  end [shape=Msquare]`,
    `  explicit_orphan [shape=box]`,  // Explicit orphan — HAS a span
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const reachDiag = diags.find(d => d.code === 'reachability' && d.message.includes('explicit_orphan'));
  if (!reachDiag) throw new Error(`Expected reachability for explicit_orphan. Got: ${JSON.stringify(diags.map(d=>d.message))}`);
  // explicit_orphan is on line 5 (1-indexed) → line 4 (0-indexed)
  if (reachDiag.range.start.line !== 4) throw new Error(`Expected line 4, got ${reachDiag.range.start.line}`);
});

test("implicit node (edge target only) reachability diagnostic falls back to document start", () => {
  // 'ghost' is never declared, only referenced as a dead target, so it's unreachable and implicit
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  start -> end`,
    `  end [shape=Msquare]`,
    `  ghost_source [shape=box]`,
    `  ghost_source -> ghost_target`,  // ghost_target is implicit — no span
    `}`,
  ].join('\n');
  const graph = parse(input);
  // ghost_target should be an implicit node — no span
  const ghostNode = graph.nodes.get('ghost_target');
  if (!ghostNode) throw new Error('Expected ghost_target to exist as implicit node');
  if (ghostNode.span !== undefined) {
    throw new Error(`Expected no span on implicit node, got: ${JSON.stringify(ghostNode.span)}`);
  }
  // Diagnostic for ghost_target reachability should fall back to {0,0}
  const diags = computeDiagnostics(makeDoc(input));
  const reachDiag = diags.find(d => d.code === 'reachability' && d.message.includes('ghost_target'));
  if (!reachDiag) throw new Error(`Expected reachability for ghost_target. Got diags: ${JSON.stringify(diags.map(d=>d.message))}`);
  console.log(`    ghost_target diag range: ${JSON.stringify(reachDiag.range)}`);
  // Since implicit node has no span, should fall back to {line:0, char:0} → {line:0, char:80}
  if (reachDiag.range.start.line !== 0) throw new Error(`Expected line 0 (fallback), got ${reachDiag.range.start.line}`);
  if (reachDiag.range.start.character !== 0) throw new Error(`Expected char 0 (fallback), got ${reachDiag.range.start.character}`);
});

// ─── SECTION 2: TextEdit range correctness ────────────────────────────────────
console.log("\n=== TextEdit range correctness ===");

test("formatter TextEdit covers entire document when file ends with newline", () => {
  const input = `digraph G { start [shape=Mdiamond] start -> end end [shape=Msquare] }\n`;
  const doc = makeDoc(input);
  const edits = format(doc);
  if (edits.length === 0) throw new Error("Expected edits");
  const edit = edits[0];
  // The range should cover from (0,0) to the end of the document
  if (edit.range.start.line !== 0 || edit.range.start.character !== 0) {
    throw new Error(`Range should start at {0,0}, got ${JSON.stringify(edit.range.start)}`);
  }
  // End position should be end of document
  const endOffset = doc.offsetAt(edit.range.end);
  if (endOffset !== input.length) {
    throw new Error(`End offset ${endOffset} != document length ${input.length}`);
  }
  console.log(`    Range: ${JSON.stringify(edit.range)}, newText ends with: ${JSON.stringify(edit.newText.slice(-3))}`);
});

test("formatter TextEdit covers entire document when file has no trailing newline", () => {
  const input = `digraph G { start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const doc = makeDoc(input);
  const edits = format(doc);
  if (edits.length === 0) throw new Error("Expected edits");
  const edit = edits[0];
  const endOffset = doc.offsetAt(edit.range.end);
  if (endOffset !== input.length) {
    throw new Error(`End offset ${endOffset} != document length ${input.length}`);
  }
});

test("formatter newText does not add trailing newline", () => {
  const input = `digraph G { start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  if (result.endsWith('\n')) throw new Error(`Output should not end with newline, got: ${JSON.stringify(result.slice(-5))}`);
});

// ─── SECTION 3: Formatter with DIGRAPH keyword as node ID ────────────────────
console.log("\n=== DIGRAPH keyword as node ID ===");

test("'digraph' keyword used as node ID in edge", () => {
  // The DIGRAPH keyword is handled in parseStatement — it falls through to parseAfterFirstId
  const input = `digraph G { start [shape=Mdiamond] digraph -> end end [shape=Msquare] }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  if (result === null) throw new Error("Expected formatted output");
  // Should preserve the 'digraph' as a node ID in edge
  if (!result.includes('digraph -> end')) throw new Error(`Edge 'digraph -> end' lost: ${result}`);
});

test("'digraph' keyword as node ID in edge is idempotent", () => {
  const input = `digraph G { start [shape=Mdiamond] digraph -> end end [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
});

// ─── SECTION 4: Formatter canonical section ordering verification ─────────────
console.log("\n=== Canonical section ordering ===");

test("all sections appear in correct canonical order: attrs → defaults → nodes → edges → subgraphs", () => {
  const input = `digraph G {
  subgraph cluster_x { inner [shape=box] inner -> work }
  start -> work [weight=2]
  work [shape=box, prompt="do it"]
  node [shape=box]
  edge [weight=1]
  goal = "test"
  start [shape=Mdiamond]
  work -> end
  end [shape=Msquare]
}`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result:\n${result}`);
  const lines = result.split('\n');
  // Find indices of first occurrences of each section
  const goalIdx = lines.findIndex(l => l.includes('goal = '));
  const nodeDefaultIdx = lines.findIndex(l => l.trim().startsWith('node '));
  const edgeDefaultIdx = lines.findIndex(l => l.trim().startsWith('edge '));
  const startNodeIdx = lines.findIndex(l => l.trim().startsWith('start ['));
  const edgeIdx = lines.findIndex(l => l.includes(' -> ') && !l.includes('inner'));
  const subgraphIdx = lines.findIndex(l => l.trim().startsWith('subgraph'));
  console.log(`    goalIdx=${goalIdx}, nodeDefaultIdx=${nodeDefaultIdx}, edgeDefaultIdx=${edgeDefaultIdx}, startNodeIdx=${startNodeIdx}, edgeIdx=${edgeIdx}, subgraphIdx=${subgraphIdx}`);
  if (goalIdx >= nodeDefaultIdx) throw new Error(`goal attrs (${goalIdx}) should come before node defaults (${nodeDefaultIdx})`);
  if (nodeDefaultIdx >= edgeDefaultIdx) throw new Error(`node defaults (${nodeDefaultIdx}) should come before edge defaults (${edgeDefaultIdx})`);
  if (edgeDefaultIdx >= startNodeIdx) throw new Error(`edge defaults (${edgeDefaultIdx}) should come before node decls (${startNodeIdx})`);
  if (startNodeIdx >= edgeIdx) throw new Error(`node decls (${startNodeIdx}) should come before edges (${edgeIdx})`);
  if (edgeIdx >= subgraphIdx) throw new Error(`edges (${edgeIdx}) should come before subgraphs (${subgraphIdx})`);
});

test("canonical section ordering is idempotent", () => {
  const input = `digraph G {
  subgraph cluster_x { inner [shape=box] inner -> work }
  start -> work [weight=2]
  work [shape=box, prompt="do it"]
  node [shape=box]
  edge [weight=1]
  goal = "test"
  start [shape=Mdiamond]
  work -> end
  end [shape=Msquare]
}`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1:\n${r1}\n\nR2:\n${r2}`);
});

// ─── SECTION 5: Edge case values with special characters ─────────────────────
console.log("\n=== Values with special characters ===");

test("value containing tab character — idempotent", () => {
  // Raw tab in quoted string: parser sees \t escape → token value is actual tab char
  const input = `digraph G { a [label="col1\tcol2"] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${JSON.stringify(r1)}\nR2: ${JSON.stringify(r2)}`);
  console.log(`    R1: ${JSON.stringify(r1)}`);
  if (!r1.includes('\\t')) throw new Error(`Expected \\t escape in output, got: ${r1}`);
});

test("value containing backslash — idempotent", () => {
  const input = `digraph G { a [label="path\\\\to\\\\file"] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${JSON.stringify(r1)}\nR2: ${JSON.stringify(r2)}`);
  console.log(`    R1: ${JSON.stringify(r1)}`);
});

test("value with braces inside string doesn't confuse formatter", () => {
  const input = `digraph G { a [prompt="do {something} here", shape=box] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
  if (!r1.includes('do {something} here')) throw new Error(`Content modified: ${r1}`);
});

test("graph attribute with curly brace in value — idempotent", () => {
  const input = `digraph G { goal = "pipeline {v2}" start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
  if (!r1.includes('pipeline {v2}')) throw new Error(`Brace content lost: ${r1}`);
});

// ─── SECTION 6: Diagnostics code field ───────────────────────────────────────
console.log("\n=== Diagnostics code field verification ===");

test("diagnostic code is the rule name string (never undefined/null)", () => {
  const input = [
    `digraph G {`,
    `  a [shape=box, type=badtype, fidelity=badfidelity]`,
    `  a -> b [weight=notanumber]`,
    `  b [shape=box]`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  for (const d of diags) {
    if (d.code === undefined || d.code === null) {
      throw new Error(`Diagnostic code is null/undefined: ${JSON.stringify(d)}`);
    }
    if (typeof d.code !== 'string' && typeof d.code !== 'number') {
      throw new Error(`Diagnostic code is unexpected type: ${typeof d.code}: ${JSON.stringify(d.code)}`);
    }
  }
  console.log(`    All ${diags.length} diagnostics have non-null code fields`);
});

test("parse error diagnostic code is always 'parse_error'", () => {
  const brokenInputs = [
    `@@@`,
    `digraph G { a -- b }`,  // undirected
    `digraph G { unclosed`,
  ];
  for (const input of brokenInputs) {
    const diags = computeDiagnostics(makeDoc(input));
    if (diags.length === 0) throw new Error(`Expected diagnostic for: ${input}`);
    if (diags[0].code !== 'parse_error') {
      // Only check first diag — validate might add its own diags for some
      const parseErrors = diags.filter(d => d.code === 'parse_error');
      if (parseErrors.length === 0) throw new Error(`Expected parse_error code for: ${input}, got: ${JSON.stringify(diags.map(d => d.code))}`);
    }
  }
});

// ─── SECTION 7: Formatter with STRING token IDs (quoted node IDs) ─────────────
console.log("\n=== Quoted node IDs in formatter ===");

test("quoted node ID preserved through formatter", () => {
  const input = `digraph G { "my node" [shape=box, label=Work] "my node" -> end end [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
  console.log(`    R1: ${r1}`);
  if (!r1.includes('"my node"')) throw new Error(`Quoted ID lost: ${r1}`);
});

test("quoted node ID with special chars (dash, colon) is preserved", () => {
  const input = `digraph G { "node-with-dashes" [shape=Mdiamond] "node-with-dashes" -> "node:colon" "node:colon" [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
  if (!r1.includes('"node-with-dashes"')) throw new Error(`Expected quoted ID with dashes`);
  if (!r1.includes('"node:colon"')) throw new Error(`Expected quoted ID with colon`);
});

test("empty string node ID '\"\"' preserved", () => {
  // Empty string "" is technically a valid DOT node ID
  const input = `digraph G { "" [shape=Mdiamond] "" -> end end [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1 output");
  const r2 = formatted(r1);
  console.log(`    R1: ${r1}`);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
  // Empty string: emitId("") → regex fails → quoteValue("") → '""'
  if (!r1.includes('""')) throw new Error(`Empty string ID lost: ${r1}`);
});

// ─── SECTION 8: Formatter blank-line separation between sections ──────────────
console.log("\n=== Blank-line separation ===");

test("blank line separates graph attrs from node decls when no defaults", () => {
  const input = `digraph G { goal="test" start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result:\n${result}`);
  // There should be a blank line between goal="test" and start [...]
  const lines = result.split('\n');
  const goalLine = lines.findIndex(l => l.includes('goal = '));
  const startNodeLine = lines.findIndex(l => l.includes('start ['));
  if (goalLine < 0) throw new Error('No goal line');
  if (startNodeLine < 0) throw new Error('No start node line');
  // There should be an empty line between goal and start
  const linesBetween = lines.slice(goalLine + 1, startNodeLine);
  const hasBlankLine = linesBetween.some(l => l.trim() === '');
  if (!hasBlankLine) throw new Error(`No blank line between goal attr and node decls. Lines between: ${JSON.stringify(linesBetween)}`);
});

test("no extra blank lines when only edges section (no nodes or attrs)", () => {
  const input = `digraph G { a -> b -> c }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result: ${JSON.stringify(result)}`);
  // Should be compact: just the edge, no blank lines
  const blankLines = result.split('\n').filter(l => l.trim() === '').length;
  if (blankLines > 0) throw new Error(`Unexpected blank lines: ${blankLines}. Output: ${result}`);
});

test("only nodes (no edges) — no blank line between sections", () => {
  const input = `digraph G { a [shape=box] b [shape=box] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result: ${JSON.stringify(result)}`);
  // Only nodes section, no blank lines expected
  const blankLines = result.split('\n').filter(l => l.trim() === '').length;
  if (blankLines > 0) throw new Error(`Unexpected blank lines: ${blankLines}. Output: ${result}`);
});

// ─── SECTION 9: Span accuracy for graph-level default blocks ─────────────────
console.log("\n=== Span accuracy for default blocks ===");

test("node defaults span is recorded in attributeSpans", () => {
  const input = [
    `digraph G {`,
    `  node [shape=box]`,
    `  start [shape=Mdiamond]`,
    `  start -> end`,
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const graph = parse(input);
  const nodeSpan = graph.attributeSpans?.get('node');
  console.log(`    node default span: ${JSON.stringify(nodeSpan)}`);
  if (!nodeSpan) throw new Error('No span for node defaults block');
  // 'node [shape=box]' is on line 2 (1-indexed)
  if (nodeSpan.line !== 2) throw new Error(`Expected line 2, got ${nodeSpan.line}`);
});

test("edge defaults span is recorded in attributeSpans", () => {
  const input = [
    `digraph G {`,
    `  node [shape=box]`,
    `  edge [weight=1]`,
    `  start [shape=Mdiamond]`,
    `  start -> end`,
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const graph = parse(input);
  const edgeSpan = graph.attributeSpans?.get('edge');
  console.log(`    edge default span: ${JSON.stringify(edgeSpan)}`);
  if (!edgeSpan) throw new Error('No span for edge defaults block');
  // 'edge [weight=1]' is on line 3 (1-indexed)
  if (edgeSpan.line !== 3) throw new Error(`Expected line 3, got ${edgeSpan.line}`);
});

test("graph defaults span is recorded in attributeSpans", () => {
  const input = [
    `digraph G {`,
    `  graph [goal_gate=true]`,
    `  start [shape=Mdiamond]`,
    `  start -> end`,
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const graph = parse(input);
  const graphSpan = graph.attributeSpans?.get('graph');
  console.log(`    graph default span: ${JSON.stringify(graphSpan)}`);
  if (!graphSpan) throw new Error('No span for graph defaults block');
  // 'graph [goal_gate=true]' is on line 2 (1-indexed)
  if (graphSpan.line !== 2) throw new Error(`Expected line 2, got ${graphSpan.line}`);
});

// ─── SECTION 10: Node with no explicit span (implicit) ───────────────────────
console.log("\n=== Node with no prompt warning ===");

test("prompt_on_llm_nodes warning for implicit node (edge-only) has fallback range", () => {
  // 'implicit_node' only appears as edge target — never declared
  // It defaults to LLM handler (no shape=box overridden), so prompt_on_llm_nodes fires
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  start -> implicit_node`,
    `  implicit_node -> end`,
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const promptDiag = diags.find(d => d.code === 'prompt_on_llm_nodes' && d.message.includes('implicit_node'));
  if (!promptDiag) throw new Error(`Expected prompt_on_llm_nodes for implicit_node. Got: ${JSON.stringify(diags.map(d=>d.code+'|'+d.message))}`);
  console.log(`    implicit_node diag range: ${JSON.stringify(promptDiag.range)}`);
  // No span on implicit node → fallback {line:0, char:0}–{line:0, char:80}
  if (promptDiag.range.start.line !== 0) throw new Error(`Expected fallback line 0, got ${promptDiag.range.start.line}`);
});

// ─── SECTION 11: Edge between same node ──────────────────────────────────────
console.log("\n=== Self-loop edge formatting ===");

test("self-loop edge (a -> a) is preserved by formatter", () => {
  const input = `digraph G { start [shape=Mdiamond] work [shape=box] work -> work [condition=retry] work -> end end [shape=Msquare] start -> work }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1:\n${r1}\nR2:\n${r2}`);
  if (!r1.includes('work -> work')) throw new Error(`Self-loop lost: ${r1}`);
});

// ─── SECTION 12: Diagnostics with span - edge from subgraph ──────────────────
console.log("\n=== Subgraph node span in diagnostics ===");

test("unreachable node inside subgraph has correct span line", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  start -> end`,
    `  end [shape=Msquare]`,
    `  subgraph cluster {`,
    `    orphan_inner [shape=box]`,  // line 6 (1-indexed) → line 5 (0-indexed)
    `  }`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const reachDiag = diags.find(d => d.code === 'reachability' && d.message.includes('orphan_inner'));
  if (!reachDiag) throw new Error(`Expected reachability for orphan_inner. Got: ${JSON.stringify(diags.map(d=>d.message))}`);
  console.log(`    orphan_inner range: ${JSON.stringify(reachDiag.range)}`);
  // orphan_inner is on line 6 (1-indexed) → line 5 (0-indexed)
  if (reachDiag.range.start.line !== 5) throw new Error(`Expected line 5, got ${reachDiag.range.start.line}`);
  // 4-space indent → char 4 (0-indexed)
  if (reachDiag.range.start.character !== 4) throw new Error(`Expected char 4, got ${reachDiag.range.start.character}`);
});

// ─── SECTION 13: Formatter handles DURATION values ────────────────────────────
console.log("\n=== DURATION values in formatter ===");

test("duration value without quotes (e.g. timeout=30s) is quoted in output", () => {
  const input = `digraph G { start [shape=Mdiamond, timeout=30s] start -> end end [shape=Msquare] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result: ${result}`);
  if (!result.includes('timeout = "30s"')) throw new Error(`Expected timeout = "30s", got: ${result}`);
});

test("duration value is idempotent (30s stays as \"30s\" on second format)", () => {
  const input = `digraph G { start [shape=Mdiamond, timeout=30s] start -> end end [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
});

// ─── SECTION 14: Multiple attr blocks on defaults ─────────────────────────────
console.log("\n=== Multiple attr blocks on defaults ===");

test("multiple attr blocks on node defaults — BUG-017 in CST parser", () => {
  // CST parser should handle multiple [..][..] blocks on defaults too
  const input = `digraph G { node [shape=box] [label=Default] start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result: ${result}`);
  // Both attrs should be in the node defaults output
  if (!result.includes('shape = "box"')) throw new Error(`Missing shape in node defaults: ${result}`);
  if (!result.includes('label = "Default"')) throw new Error(`Missing label in node defaults: ${result}`);
});

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (bugs.length > 0) {
  console.log('\nBUGS FOUND:');
  bugs.forEach(b => console.log(`  - ${b.name}: ${b.error}`));
}
process.exit(failed > 0 ? 1 : 0);
