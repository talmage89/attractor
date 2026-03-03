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

// ─── SECTION 1: Malformed inputs that don't throw ────────────────────────────
console.log("\n=== Malformed inputs (graceful handling) ===");

test("formatter with missing edge target (a -> [attrs]) doesn't crash", () => {
  const input = `digraph G { start [shape=Mdiamond] start -> [weight=2] end [shape=Msquare] }`;
  // This is malformed but the CstParser should handle it gracefully (maybe wrong output)
  // The key test: it should NOT throw/crash, it should return something or null
  let result;
  try {
    result = formatted(input);
  } catch (e) {
    throw new Error(`Formatter crashed on malformed input: ${e.message}`);
  }
  // Just document the behavior
  console.log(`    Result: ${JSON.stringify(result)}`);
  // Either null (parse failed) or some output is acceptable — no crash
});

test("formatter with empty attribute block on node doesn't crash", () => {
  const input = `digraph G { a [] b [shape=box] a -> b }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  // Should format fine; empty attr block should be omitted or preserved
});

test("formatter with only a graph header and no body", () => {
  const input = `digraph G {}`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  if (result === null) throw new Error("Expected output for empty graph");
  if (!result.includes('digraph G')) throw new Error(`Missing graph header: ${result}`);
  if (!result.includes('}')) throw new Error(`Missing closing brace: ${result}`);
});

test("formatter with graph that has no name", () => {
  // Anonymous digraph - the CST parser accepts it
  const input = `digraph { a [shape=Mdiamond] a -> b b [shape=Msquare] }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  // CstParser reads no name token before {, so name=""
  // emitId("") — empty string fails regex → quoteValue("") = ""
  // doc.name is "" (falsy) → header is "digraph {"
  // OR: name="" → false → "digraph {"
});

test("formatter handles truly broken DOT (graph keyword instead of digraph)", () => {
  // The CST parser checks for DIGRAPH token first — 'graph' is not DIGRAPH
  const input = `graph G { a [shape=box] }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  // Should return null since CstParser.parseDocument returns null (no DIGRAPH token)
  if (result !== null) {
    // Check if this is a bug — returning non-null for undirected graph
    console.log(`    NOTE: formatter returned non-null output for undirected graph`);
  }
});

// ─── SECTION 2: Formatter with quoted graph name ──────────────────────────────
console.log("\n=== Quoted graph name formatting ===");

test("quoted graph name is preserved in formatter output", () => {
  // The attractor parser would reject this, but the CST formatter should handle it
  const input = `digraph "My Pipeline" { start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const result = formatted(input);
  console.log(`    Result: ${result}`);
  if (result === null) {
    // Acceptable if CST parser fails
    console.log(`    NOTE: formatter returned null for quoted graph name`);
    return;
  }
  // If it succeeds, should include the quoted name
  if (!result.startsWith('digraph "My Pipeline"') && !result.startsWith("digraph My")) {
    throw new Error(`Unexpected output for quoted graph name: ${result.split('\n')[0]}`);
  }
});

test("quoted graph name is idempotent if formatter produces output", () => {
  const input = `digraph "My Pipeline" { start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) {
    console.log(`    SKIP: formatter returned null for quoted graph name`);
    return;
  }
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
});

// ─── SECTION 3: TRUE/FALSE token as edge target ──────────────────────────────
console.log("\n=== Keyword tokens as edge targets ===");

test("TRUE token as edge target is preserved", () => {
  // 'true' → TRUE token in lexer; CstParser reads as edge target
  const input = `digraph G { start [shape=Mdiamond] start -> true true [shape=Msquare] }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  if (result === null) throw new Error("Expected output");
  if (!result.includes('-> true')) throw new Error(`Edge target 'true' lost: ${result}`);
});

test("FALSE token as edge source is preserved as edge (parseStatement fallback)", () => {
  // 'false' → FALSE token; in parseStatement, handled by the multi-type case → parseAfterFirstId
  const input = `digraph G { start [shape=Mdiamond] false -> end end [shape=Msquare] }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  if (result === null) throw new Error("Expected output");
  if (!result.includes('false -> end')) throw new Error(`Edge with 'false' source lost: ${result}`);
});

test("DURATION token as edge source (e.g. 30s -> end)", () => {
  // '30s' → DURATION token; in parseStatement, handled by the multi-type case → parseAfterFirstId
  const input = `digraph G { start [shape=Mdiamond] 30s -> end end [shape=Msquare] }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  // The DURATION "30s" would be parsed as edge source; emitId("30s") — fails both regexes, quoted
  // OR matches no regex: /^[A-Za-z_].../ — 3 is digit, fails. /^-?[0-9]+/ — 3 is digit, but "0s" is not...
  // actually "30s" has suffix, so regex fails. quoteValue("30s") = '"30s"'
  if (result === null) throw new Error("Expected output");
  // Document the result
});

// ─── SECTION 4: Formatter with SUBGRAPH as edge source ────────────────────────
console.log("\n=== SUBGRAPH keyword as edge source ===");

test("SUBGRAPH keyword as node ID in edge - documents formatter behavior", () => {
  // 'subgraph' → SUBGRAPH token; in parseStatement, would call parseSubgraph()
  // But parseSubgraph() then tries to parse LBRACE or an identifier... then fails
  // So 'subgraph -> end' might crash the CstParser or produce unexpected output
  const input = `digraph G { start [shape=Mdiamond] subgraph -> end end [shape=Msquare] }`;
  let result;
  try {
    result = formatted(input);
  } catch (e) {
    throw new Error(`Formatter crashed: ${e.message}`);
  }
  console.log(`    Result: ${JSON.stringify(result)}`);
  // The parseSubgraph() would try to eat LBRACE from '->',  which is ARROW — throws in eat()
  // But parseDocument() has a try/catch → returns null
  // OR parseBody() has no explicit try/catch, so parseSubgraph throw would propagate to parseDocument's catch
  // Either way: result should be null OR the edge is somehow preserved
  if (result !== null) {
    // If it's not null, verify the edge is in there
    console.log(`    NOTE: formatter produced output with 'subgraph' as node ID`);
  }
});

// ─── SECTION 5: Span accuracy — multi-edge span ───────────────────────────────
console.log("\n=== Multi-edge chain span ===");

test("edge chain a->b->c all get same span (from 'a' to ']')", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  start -> mid -> end [weight=2]`,
    `  mid [shape=box]`,
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const graph = parse(input);
  // There should be 2 edges: start->mid and mid->end, both with same span
  const edges = graph.edges;
  if (edges.length < 2) throw new Error(`Expected at least 2 edges, got ${edges.length}`);
  const startMid = edges.find(e => e.from === 'start' && e.to === 'mid');
  const midEnd = edges.find(e => e.from === 'mid' && e.to === 'end');
  if (!startMid) throw new Error('Expected start->mid edge');
  if (!midEnd) throw new Error('Expected mid->end edge');
  // Both edges should have spans
  if (!startMid.span) throw new Error('No span on start->mid edge');
  if (!midEnd.span) throw new Error('No span on mid->end edge');
  // Both should have the same span (from 'start' token to ']' token)
  if (JSON.stringify(startMid.span) !== JSON.stringify(midEnd.span)) {
    console.log(`    start->mid span: ${JSON.stringify(startMid.span)}`);
    console.log(`    mid->end span: ${JSON.stringify(midEnd.span)}`);
    throw new Error('Spans should be identical for edges in same chain');
  }
  console.log(`    Chain edge span: ${JSON.stringify(startMid.span)}`);
});

// ─── SECTION 6: Diagnostics for edge-level rules with span ───────────────────
console.log("\n=== Diagnostics edge-level span accuracy ===");

test("invalid_edge_weight diagnostic span points to correct line (2-edge file)", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  start -> mid`,         // line 3 (1-indexed)
    `  mid -> end [weight=abc]`,  // line 4 (1-indexed) → 0-indexed = 3
    `  mid [shape=box]`,
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const weightDiag = diags.find(d => d.code === 'invalid_edge_weight');
  if (!weightDiag) throw new Error(`Expected invalid_edge_weight. Got: ${JSON.stringify(diags.map(d=>d.code))}`);
  console.log(`    weight diag range: ${JSON.stringify(weightDiag.range)}`);
  // mid -> end [weight=abc] is on line 4 (1-indexed) → 0-indexed = 3
  if (weightDiag.range.start.line !== 3) throw new Error(`Expected line 3, got ${weightDiag.range.start.line}`);
});

test("condition_syntax diagnostic span points to edge line", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  start -> end [condition="=badcondition"]`,  // line 3 → 0-indexed = 2
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const condDiag = diags.find(d => d.code === 'condition_syntax');
  if (!condDiag) {
    // condition_syntax only fires on truly malformed conditions
    // Empty key like "=bad" or "!=bad"
    console.log(`    NOTE: no condition_syntax diagnostic. All diags: ${JSON.stringify(diags.map(d=>d.code))}`);
    return;
  }
  console.log(`    condition diag range: ${JSON.stringify(condDiag.range)}`);
  if (condDiag.range.start.line !== 2) throw new Error(`Expected line 2, got ${condDiag.range.start.line}`);
});

// ─── SECTION 7: Formatter with `default_max_retry` as graph attr ──────────────
console.log("\n=== Graph attrs in formatter ===");

test("default_max_retry value is quoted in formatter output", () => {
  const input = `digraph G { default_max_retry = 50 start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result has default_max_retry: ${result.includes('default_max_retry')}`);
  if (!result.includes('default_max_retry = "50"')) {
    throw new Error(`Expected default_max_retry = "50", got: ${result}`);
  }
});

test("all graph attributes appear in canonical order (alphabetical for unrecognized)", () => {
  // Two custom graph attrs: z_attr and a_attr — should be in alpha order
  const input = `digraph G { z_attr = "last" a_attr = "first" start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  const lines = result.split('\n');
  const aLine = lines.findIndex(l => l.includes('a_attr'));
  const zLine = lines.findIndex(l => l.includes('z_attr'));
  console.log(`    a_attr at line ${aLine}, z_attr at line ${zLine}`);
  // NOTE: graph attrs maintain SOURCE ORDER in the formatter (they're not sorted)
  // The formatter just puts all graph_attrs before defaults/nodes/edges
  // There's no sorting within graph_attrs section
  console.log(`    Graph attrs order: ${aLine < zLine ? 'source order maintained' : 'reversed'}`);
  // This is documenting behavior, not asserting expected order
});

test("multiple graph attr assignments appear in correct section", () => {
  const input = `digraph G {
  start [shape=Mdiamond]
  goal = "Refactor"
  label = "My Pipeline"
  start -> end
  end [shape=Msquare]
}`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result:\n${result}`);
  const lines = result.split('\n');
  const goalLine = lines.findIndex(l => l.includes('goal = '));
  const labelLine = lines.findIndex(l => l.includes('label = '));
  const startNodeLine = lines.findIndex(l => l.includes('start ['));
  // Both graph attrs should come before node declarations
  if (goalLine >= startNodeLine) throw new Error(`goal attr (${goalLine}) should come before start node (${startNodeLine})`);
  if (labelLine >= startNodeLine) throw new Error(`label attr (${labelLine}) should come before start node (${startNodeLine})`);
});

// ─── SECTION 8: Edge attribute ordering in detail ─────────────────────────────
console.log("\n=== Edge attribute ordering ===");

test("edge attrs: condition before weight before loop_restart", () => {
  const input = `digraph G {
  start [shape=Mdiamond]
  start -> end [loop_restart=true, weight=5, condition=success]
  end [shape=Msquare]
}`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  const edgeLine = result.split('\n').find(l => l.includes('->'));
  console.log(`    Edge line: ${edgeLine}`);
  if (!edgeLine) throw new Error('No edge line found');
  const attrContent = edgeLine.replace(/.*\[/, '').replace(/\].*/, '');
  const parts = attrContent.split(', ');
  const condIdx = parts.findIndex(p => p.startsWith('condition'));
  const weightIdx = parts.findIndex(p => p.startsWith('weight'));
  const loopIdx = parts.findIndex(p => p.startsWith('loop_restart'));
  if (condIdx === -1) throw new Error('Missing condition attr');
  if (weightIdx === -1) throw new Error('Missing weight attr');
  if (loopIdx === -1) throw new Error('Missing loop_restart attr');
  if (condIdx >= weightIdx) throw new Error(`condition (${condIdx}) should come before weight (${weightIdx})`);
  if (weightIdx >= loopIdx) throw new Error(`weight (${weightIdx}) should come before loop_restart (${loopIdx})`);
});

// ─── SECTION 9: Idempotency with special node/edge IDs ──────────────────────
console.log("\n=== Idempotency with special IDs ===");

test("idempotency with numeric graph name", () => {
  const input = `digraph 42 { start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
});

test("idempotency with nested subgraphs", () => {
  const input = `digraph G {
  start [shape=Mdiamond]
  subgraph outer {
    label = "Outer"
    subgraph inner {
      label = "Inner"
      a [shape=box]
      a -> b
    }
    b [shape=box]
    b -> c
  }
  c [shape=Msquare]
  start -> a
}`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  console.log(`    R1:\n${r1}`);
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1:\n${r1}\n\nR2:\n${r2}`);
});

test("idempotency with float values", () => {
  // Float values as graph attrs (e.g., version = 1.5)
  const input = `digraph G { version = 1.5 start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  console.log(`    R1: ${r1}`);
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
});

// ─── SECTION 10: Diagnostics message content ─────────────────────────────────
console.log("\n=== Diagnostics message content ===");

test("all diagnostics have non-empty messages", () => {
  const input = [
    `digraph G {`,
    `  a [shape=box, type=badtype, fidelity=badfidelity]`,
    `  a -> b [weight=notanumber]`,
    `  b [shape=box]`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  for (const d of diags) {
    if (!d.message || d.message.trim() === '') {
      throw new Error(`Empty message in diagnostic: ${JSON.stringify(d)}`);
    }
    if (d.severity !== 1 && d.severity !== 2 && d.severity !== 3 && d.severity !== 4) {
      throw new Error(`Unexpected severity ${d.severity} in diagnostic: ${JSON.stringify(d)}`);
    }
  }
  console.log(`    All ${diags.length} diagnostics have valid messages and severities`);
});

test("parse error diagnostic message includes original error message", () => {
  const input = `digraph G { @invalid }`;
  const diags = computeDiagnostics(makeDoc(input));
  if (diags.length === 0) throw new Error('Expected diagnostic');
  const d = diags[0];
  // The message should not be empty
  if (!d.message || d.message.length < 5) throw new Error(`Message too short: ${JSON.stringify(d.message)}`);
  console.log(`    Parse error message: ${d.message}`);
  // Should mention the unexpected character
  if (!d.message.includes('@') && !d.message.includes('Unexpected')) {
    throw new Error(`Message doesn't mention the error cause: ${d.message}`);
  }
});

// ─── SECTION 11: Formatter handles node with no attrs ─────────────────────────
console.log("\n=== Node with no attributes ===");

test("node with no attrs in formatter produces bare node declaration", () => {
  const input = `digraph G { start [shape=Mdiamond] orphan_no_attrs start -> end end [shape=Msquare] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result:\n${result}`);
  // 'orphan_no_attrs' should appear as a bare identifier in the nodes section
  if (!result.includes('orphan_no_attrs')) throw new Error(`Node 'orphan_no_attrs' missing: ${result}`);
  // Should NOT have brackets after it (no attrs)
  const orphanLine = result.split('\n').find(l => l.includes('orphan_no_attrs'));
  if (!orphanLine) throw new Error('Cannot find orphan line');
  if (orphanLine.includes('[')) throw new Error(`Unexpected brackets on bare node: ${orphanLine}`);
});

// ─── SECTION 12: Formatter canonical output — precise spec check ──────────────
console.log("\n=== Spec-compliant canonical output ===");

test("canonical output matches spec example format", () => {
  // Re-test against the spec's example output
  const input = `digraph GraphName {
node [shape=box]
edge [weight=1]
start [shape=Mdiamond, label=Start]
work [label="Do Work", prompt="...", shape=box]
done [shape=Msquare, label=Done]
goal = "Refactor auth module"
label = "My Pipeline"
start -> work
work -> done [condition="outcome.status=success", label="[A] Approve"]
}`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result:\n${result}`);

  // Verify: goal comes before label (both are graph attrs, source order preserved)
  const lines = result.split('\n');
  const goalLine = lines.findIndex(l => l.includes('goal = '));
  const labelLine = lines.findIndex(l => l.includes('label = "My Pipeline"'));
  const nodeDefaultLine = lines.findIndex(l => l.trim().startsWith('node '));
  const edgeDefaultLine = lines.findIndex(l => l.trim().startsWith('edge '));
  const startNodeLine = lines.findIndex(l => l.includes('start ['));
  const edgeLine = lines.findIndex(l => l.includes('-> work'));

  // Verify canonical section order
  if (goalLine >= nodeDefaultLine) throw new Error(`Graph attrs (${goalLine}) should be before node defaults (${nodeDefaultLine})`);
  if (nodeDefaultLine >= edgeDefaultLine) throw new Error(`Node defaults (${nodeDefaultLine}) should be before edge defaults (${edgeDefaultLine})`);
  if (edgeDefaultLine >= startNodeLine) throw new Error(`Edge defaults (${edgeDefaultLine}) should be before node decls (${startNodeLine})`);
  if (startNodeLine >= edgeLine) throw new Error(`Node decls (${startNodeLine}) should be before edges (${edgeLine})`);

  // Verify attribute quoting
  if (!result.includes('shape = "box"')) throw new Error('Missing quoted shape attr');
  if (!result.includes('weight = "1"')) throw new Error('Missing quoted weight attr');

  // Verify attribute ordering (label before shape)
  const startNodeFull = lines.find(l => l.includes('start ['));
  if (!startNodeFull) throw new Error('Cannot find start node line');
  const labelIdx = startNodeFull.indexOf('label');
  const shapeIdx = startNodeFull.indexOf('shape');
  if (labelIdx > shapeIdx) throw new Error(`label (${labelIdx}) should come before shape (${shapeIdx}): ${startNodeFull}`);
});

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (bugs.length > 0) {
  console.log('\nBUGS FOUND:');
  bugs.forEach(b => console.log(`  - ${b.name}: ${b.error}`));
}
process.exit(failed > 0 ? 1 : 0);
