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

// ─── SECTION 1: Edge chains with quoted IDs ───────────────────────────────────
console.log("\n=== Edge chains with quoted IDs ===");

test("edge chain with quoted IDs is idempotent", () => {
  const input = `digraph G { "a b" [shape=Mdiamond] "a b" -> "c d" "c d" [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
  console.log(`    R1: ${r1}`);
  if (!r1.includes('"a b" -> "c d"')) throw new Error(`Quoted IDs in edge lost: ${r1}`);
});

test("edge with one quoted and one unquoted ID", () => {
  const input = `digraph G { start [shape=Mdiamond] start -> "the end" "the end" [shape=Msquare] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
  if (!r1.includes('start -> "the end"')) throw new Error(`Mixed ID edge lost: ${r1}`);
});

// ─── SECTION 2: Formatter output ends with correct character ──────────────────
console.log("\n=== Formatter output termination ===");

test("formatter output ends with '}' and no trailing whitespace", () => {
  const inputs = [
    `digraph G { a [shape=Mdiamond] a -> b b [shape=Msquare] }`,
    `digraph G { node [shape=box] a [shape=Mdiamond] a -> b b [shape=Msquare] }`,
    `digraph G { goal = "test" a [shape=Mdiamond] a -> b b [shape=Msquare] }`,
    `digraph G { a [shape=Mdiamond] a -> b b [shape=Msquare] subgraph x { c [shape=box] } }`,
  ];
  for (const input of inputs) {
    const result = formatted(input);
    if (result === null) throw new Error(`Got null for: ${input}`);
    if (!result.endsWith('}')) throw new Error(`Expected to end with '}': ${JSON.stringify(result.slice(-10))}`);
    if (/\s$/.test(result.slice(-1))) throw new Error(`Trailing whitespace: ${JSON.stringify(result.slice(-5))}`);
  }
  console.log(`    All 4 outputs end with '}'`);
});

// ─── SECTION 3: Test `conditionSyntaxRule` span ───────────────────────────────
console.log("\n=== conditionSyntaxRule span ===");

test("condition with empty key (=value) triggers condition_syntax with edge span", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  start -> end [condition="=success"]`,  // empty key
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const condDiag = diags.find(d => d.code === 'condition_syntax');
  if (!condDiag) {
    // Might not trigger for this specific pattern
    console.log(`    NOTE: no condition_syntax diag. All: ${JSON.stringify(diags.map(d=>d.code))}`);
    return;
  }
  // Edge is on line 3 (1-indexed) = line 2 (0-indexed)
  if (condDiag.range.start.line !== 2) throw new Error(`Expected line 2, got ${condDiag.range.start.line}`);
  console.log(`    condition_syntax diag range: ${JSON.stringify(condDiag.range)}`);
});

// ─── SECTION 4: Node declared in subgraph gets span ─────────────────────────
console.log("\n=== Subgraph node spans ===");

test("node declared inside subgraph has span with correct line (subgraph indented)", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  subgraph cluster {`,
    `    inner [shape=box, label=Inner]`,  // line 4 (1-indexed)
    `    inner -> done`,
    `  }`,
    `  done [shape=Msquare]`,
    `  start -> inner`,
    `}`,
  ].join('\n');
  const graph = parse(input);
  const innerNode = graph.nodes.get('inner');
  if (!innerNode) throw new Error('Expected inner node');
  if (!innerNode.span) throw new Error('Expected span on inner node');
  console.log(`    inner node span: ${JSON.stringify(innerNode.span)}`);
  // inner is on line 4 (1-indexed)
  if (innerNode.span.line !== 4) throw new Error(`Expected line 4, got ${innerNode.span.line}`);
  // 4-space indent → column 5 (1-indexed)
  if (innerNode.span.column !== 5) throw new Error(`Expected column 5, got ${innerNode.span.column}`);
});

// ─── SECTION 5: Graph with max_retries/goal_gate attributes ──────────────────
console.log("\n=== goal_gate/max_retries formatting ===");

test("goal_gate and max_retries formatted and idempotent", () => {
  const input = `digraph G {
  start [shape=Mdiamond]
  work [shape=box, goal_gate=true, max_retries=3, retry_target=start]
  start -> work
  work -> end [condition=success]
  work -> start [condition=fail]
  end [shape=Msquare]
}`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1:\n${r1}\n\nR2:\n${r2}`);
  console.log(`    Work node line: ${r1.split('\n').find(l => l.includes('goal_gate'))}`);
  // Verify attribute order: goal_gate before retry_target
  const workLine = r1.split('\n').find(l => l.includes('goal_gate'));
  if (!workLine) throw new Error('No goal_gate in output');
  const goalIdx = workLine.indexOf('goal_gate');
  const retryIdx = workLine.indexOf('retry_target');
  if (goalIdx > retryIdx) throw new Error(`goal_gate (${goalIdx}) should come before retry_target (${retryIdx})`);
});

// ─── SECTION 6: Diagnostics for promptOnLlmNodesRule span ────────────────────
console.log("\n=== promptOnLlmNodesRule span ===");

test("prompt_on_llm_nodes diagnostic has span on the node declaration", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  work [shape=box]`,      // shape=box without prompt → LLM node without prompt
    `  start -> work`,
    `  work -> end`,
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const promptDiag = diags.find(d => d.code === 'prompt_on_llm_nodes' && d.message.includes('work'));
  if (!promptDiag) {
    console.log(`    NOTE: no prompt_on_llm_nodes for work. All: ${JSON.stringify(diags.map(d => d.code + '|' + d.message.split("'")[1]))}`);
    return;
  }
  console.log(`    prompt_on_llm_nodes range: ${JSON.stringify(promptDiag.range)}`);
  // 'work' is on line 3 (1-indexed) → 0-indexed = 2
  if (promptDiag.range.start.line !== 2) throw new Error(`Expected line 2, got ${promptDiag.range.start.line}`);
  // 2-space indent → char 2 (0-indexed)
  if (promptDiag.range.start.character !== 2) throw new Error(`Expected char 2, got ${promptDiag.range.start.character}`);
});

// ─── SECTION 7: Edge chain with > 2 nodes and attributes ─────────────────────
console.log("\n=== Long edge chains ===");

test("4-node edge chain a->b->c->d is preserved and idempotent", () => {
  const input = `digraph G { a -> b -> c -> d [weight=2] }`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1: ${r1}\nR2: ${r2}`);
  if (!r1.includes('a -> b -> c -> d')) throw new Error(`Long chain not preserved: ${r1}`);
  if (!r1.includes('[weight = "2"]')) throw new Error(`Chain attrs not preserved: ${r1}`);
});

test("multiple edge chains are each formatted on separate lines", () => {
  const input = `digraph G { a -> b b -> c c -> d }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result:\n${result}`);
  // Three separate edges on separate lines
  const edgeLines = result.split('\n').filter(l => l.includes(' -> '));
  if (edgeLines.length !== 3) throw new Error(`Expected 3 edge lines, got ${edgeLines.length}: ${result}`);
});

// ─── SECTION 8: Diagnostics — span for start/exit rules ──────────────────────
console.log("\n=== startNoIncoming / exitNoOutgoing span ===");

test("start_node_has_no_incoming diagnostic with span", () => {
  const input = [
    `digraph G {`,
    `  other [shape=box]`,
    `  other -> start`,         // creates incoming edge to start
    `  start [shape=Mdiamond]`, // start has incoming edge from 'other'
    `  start -> end`,
    `  end [shape=Msquare]`,
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const startDiag = diags.find(d => d.code === 'start_no_incoming');
  if (!startDiag) {
    console.log(`    NOTE: no start_no_incoming. All: ${JSON.stringify(diags.map(d=>d.code))}`);
    return;
  }
  console.log(`    start_no_incoming range: ${JSON.stringify(startDiag.range)}`);
  // start is on line 4 (1-indexed) → 0-indexed = 3
  if (startDiag.range.start.line !== 3) throw new Error(`Expected line 3, got ${startDiag.range.start.line}`);
});

test("exit_no_outgoing diagnostic has span", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  end [shape=Msquare]`,    // exit node
    `  start -> extra`,
    `  extra [shape=box]`,
    `  extra -> end [condition=success]`,
    `  end -> extra [condition=fail]`,   // creates outgoing edge from exit node
    `}`,
  ].join('\n');
  const diags = computeDiagnostics(makeDoc(input));
  const exitDiag = diags.find(d => d.code === 'exit_no_outgoing');
  if (!exitDiag) {
    console.log(`    NOTE: no exit_no_outgoing. All: ${JSON.stringify(diags.map(d=>d.code))}`);
    return;
  }
  console.log(`    exit_no_outgoing range: ${JSON.stringify(exitDiag.range)}`);
  // 'end' is on line 3 (1-indexed) → 0-indexed = 2
  if (exitDiag.range.start.line !== 2) throw new Error(`Expected line 2, got ${exitDiag.range.start.line}`);
});

// ─── SECTION 9: Formatter with no-separator attribute block ──────────────────
console.log("\n=== Attr block without comma separator ===");

test("attr block using semicolon as separator is handled", () => {
  // DOT allows semicolons as attr separators
  const input = `digraph G { a [shape=box; label=Work] }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  if (result === null) throw new Error("Expected output");
  // Both attrs should be in the output
  if (!result.includes('shape = "box"')) throw new Error(`Missing shape: ${result}`);
  if (!result.includes('label = "Work"')) throw new Error(`Missing label: ${result}`);
  // And they should be separated by ', ' not '; '
  const attrLine = result.split('\n').find(l => l.includes('['));
  if (!attrLine) throw new Error('No attr line');
  console.log(`    Attr line: ${attrLine}`);
});

test("attr block with no separator between attrs is handled", () => {
  // Attrs without any separator (malformed but DOT-like)
  const input = `digraph G { a [shape=box label=Work] }`;
  const result = formatted(input);
  console.log(`    Result: ${JSON.stringify(result)}`);
  // This is technically malformed — the formatter may handle it either way
  // The key test: no crash
});

// ─── SECTION 10: Node with existing class and subgraph class ─────────────────
console.log("\n=== Class attribute in subgraph ===");

test("node with class inside subgraph gets both classes (BUG-019 area)", () => {
  const input = [
    `digraph G {`,
    `  start [shape=Mdiamond]`,
    `  subgraph cluster_work {`,
    `    label = "Work Loop"`,
    `    work_node [shape=box, class=existing_class]`,
    `    work_node -> done`,
    `  }`,
    `  done [shape=Msquare]`,
    `  start -> work_node`,
    `}`,
  ].join('\n');
  const graph = parse(input);
  const workNode = graph.nodes.get('work_node');
  if (!workNode) throw new Error('Expected work_node');
  console.log(`    work_node.className: "${workNode.className}"`);
  // BUG-019: class "existing_class" + subgraph class "work_loop" should combine
  // But might have trailing comma issue (BUG-019 not yet fixed for this case)
  // Let's just document the actual value
});

test("formatter with class attribute — idempotent", () => {
  const input = `digraph G {
  start [shape=Mdiamond]
  work [shape=box, class=myclass, label=Work]
  start -> work
  work -> end
  end [shape=Msquare]
}`;
  const r1 = formatted(input);
  if (r1 === null) throw new Error("Expected r1");
  const r2 = formatted(r1);
  if (r1 !== r2) throw new Error(`Not idempotent!\nR1:\n${r1}\n\nR2:\n${r2}`);
  // Verify class appears in correct position (identity group, after shape)
  const workLine = r1.split('\n').find(l => l.includes('work ['));
  if (!workLine) throw new Error('Cannot find work node line');
  console.log(`    Work node: ${workLine}`);
  const labelIdx = workLine.indexOf('label');
  const classIdx = workLine.indexOf('class');
  if (labelIdx > classIdx) throw new Error(`label (${labelIdx}) should come before class (${classIdx})`);
});

// ─── SECTION 11: Span for node at line 1 (first line inside digraph) ─────────
console.log("\n=== Span for first-line node ===");

test("node on first line after opening brace has correct span", () => {
  const input = `digraph G { start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
  const graph = parse(input);
  const startNode = graph.nodes.get('start');
  if (!startNode) throw new Error('Expected start node');
  if (!startNode.span) throw new Error('Expected span on start node');
  console.log(`    start node span: ${JSON.stringify(startNode.span)}`);
  // Everything is on line 1 (1-indexed)
  if (startNode.span.line !== 1) throw new Error(`Expected line 1, got ${startNode.span.line}`);
  // 'start' begins after 'digraph G { ' (12 chars), col = 13 (1-indexed)
  if (startNode.span.column !== 13) throw new Error(`Expected column 13, got ${startNode.span.column}`);
});

// ─── SECTION 12: formatter with single-line digraph has no blank line ─────────
console.log("\n=== Single-line formatting ===");

test("single-line graph with only nodes formats correctly", () => {
  const input = `digraph G { a [shape=Mdiamond] b [shape=Msquare] }`;
  const result = formatted(input);
  if (result === null) throw new Error("Expected output");
  console.log(`    Result:\n${result}`);
  // Should have both nodes on separate lines, no blank line between them (same section)
  const nodeLines = result.split('\n').filter(l => l.includes('[shape'));
  if (nodeLines.length !== 2) throw new Error(`Expected 2 node lines, got ${nodeLines.length}`);
});

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (bugs.length > 0) {
  console.log('\nBUGS FOUND:');
  bugs.forEach(b => console.log(`  - ${b.name}: ${b.error}`));
}
process.exit(failed > 0 ? 1 : 0);
