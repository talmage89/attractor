import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { format } from "../src/formatter.js";

function makeDoc(text: string): TextDocument {
  return TextDocument.create("file:///test.dag", "attractor", 1, text);
}

/** Run the formatter and return the formatted text, or null if no edits. */
function formatted(text: string): string | null {
  const edits = format(makeDoc(text));
  if (edits.length === 0) return null;
  return edits[0].newText;
}

describe("format()", () => {
  it("formats a minimal pipeline to canonical output", () => {
    const input = `digraph G { start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  start [shape = "Mdiamond"]`,
        `  end   [shape = "Msquare"]`,
        ``,
        `  start -> end`,
        `}`,
      ].join("\n"),
    );
  });

  it("moves graph attributes declared between nodes to the top", () => {
    const input = `digraph G { start [shape=Mdiamond] goal = "Refactor" end [shape=Msquare] start -> end }`;
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  goal = "Refactor"`,
        ``,
        `  start [shape = "Mdiamond"]`,
        `  end   [shape = "Msquare"]`,
        ``,
        `  start -> end`,
        `}`,
      ].join("\n"),
    );
  });

  it("preserves node defaults in the defaults section", () => {
    const input = `digraph G { node [shape=box] start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  node [shape = "box"]`,
        ``,
        `  start [shape = "Mdiamond"]`,
        `  end   [shape = "Msquare"]`,
        ``,
        `  start -> end`,
        `}`,
      ].join("\n"),
    );
  });

  it("preserves edge defaults in the defaults section", () => {
    const input = `digraph G { edge [weight=1] start [shape=Mdiamond] start -> end end [shape=Msquare] }`;
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  edge [weight = "1"]`,
        ``,
        `  start [shape = "Mdiamond"]`,
        `  end   [shape = "Msquare"]`,
        ``,
        `  start -> end`,
        `}`,
      ].join("\n"),
    );
  });

  it("quotes bare attribute values", () => {
    const input = `digraph G { a [shape=box, label=MyNode] }`;
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  a [label = "MyNode", shape = "box"]`,
        `}`,
      ].join("\n"),
    );
  });

  it("reorders attributes by semantic group", () => {
    // Input has attributes in random order: weight, goal_gate, shape, label, condition, prompt
    const input = `digraph G { a [weight=2, goal_gate=true, shape=box, label=Work, condition=success, prompt="Do work"] }`;
    const result = formatted(input);
    // Expected order: label(0), shape(1), prompt(4), goal_gate(6), condition(17), weight(18)
    expect(result).toBe(
      [
        `digraph G {`,
        `  a [label = "Work", shape = "box", prompt = "Do work", goal_gate = "true", condition = "success", weight = "2"]`,
        `}`,
      ].join("\n"),
    );
  });

  it("formats subgraphs with recursive indentation and canonical ordering", () => {
    const input = [
      `digraph G {`,
      `  start [shape=Mdiamond]`,
      `  subgraph cluster_loop {`,
      `    node [shape=box]`,
      `    inner [label=Inner]`,
      `    inner -> done`,
      `  }`,
      `  start -> done`,
      `  done [shape=Msquare]`,
      `}`,
    ].join("\n");

    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  start [shape = "Mdiamond"]`,
        `  done  [shape = "Msquare"]`,
        ``,
        `  start -> done`,
        ``,
        `  subgraph cluster_loop {`,
        `    node [shape = "box"]`,
        ``,
        `    inner [label = "Inner"]`,
        ``,
        `    inner -> done`,
        `  }`,
        `}`,
      ].join("\n"),
    );
  });

  it("preserves edge chains (does not expand them)", () => {
    const input = `digraph G { a -> b -> c [weight=2] }`;
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  a -> b -> c [weight = "2"]`,
        `}`,
      ].join("\n"),
    );
  });

  it("strips comments from the output", () => {
    const input = [
      `// Pipeline comment`,
      `digraph G {`,
      `  /* block comment */`,
      `  start [shape=Mdiamond] // inline comment`,
      `  start -> end`,
      `  end [shape=Msquare]`,
      `}`,
    ].join("\n");

    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  start [shape = "Mdiamond"]`,
        `  end   [shape = "Msquare"]`,
        ``,
        `  start -> end`,
        `}`,
      ].join("\n"),
    );
  });

  it("is idempotent — formatting already-formatted output yields the same result", () => {
    const alreadyFormatted = [
      `digraph G {`,
      `  start [shape = "Mdiamond"]`,
      `  end   [shape = "Msquare"]`,
      ``,
      `  start -> end`,
      `}`,
    ].join("\n");

    expect(formatted(alreadyFormatted)).toBe(alreadyFormatted);
  });

  it("returns no edits for an empty file", () => {
    expect(format(makeDoc(""))).toEqual([]);
  });

  it("returns no edits when the file has a lex error", () => {
    // '@' is an illegal character in DOT — lex() will throw
    const broken = `digraph G { @@@invalid }`;
    expect(format(makeDoc(broken))).toEqual([]);
  });

  it("is idempotent for empty node defaults block", () => {
    const input = `digraph G { node [] start [shape=Mdiamond] start->end end[shape=Msquare] }`;
    const r1 = formatted(input);
    const r2 = formatted(r1!);
    expect(r1).not.toBeNull();
    expect(r1).toBe(r2);
    expect(r1).toContain("node []");
  });

  it("is idempotent for empty edge defaults block", () => {
    const input = `digraph G { edge [] start [shape=Mdiamond] start->end end[shape=Msquare] }`;
    const r1 = formatted(input);
    const r2 = formatted(r1!);
    expect(r1).not.toBeNull();
    expect(r1).toBe(r2);
    expect(r1).toContain("edge []");
  });

  it("is idempotent for empty graph defaults block (does not drop statement)", () => {
    const input = `digraph G { graph [] start [shape=Mdiamond] start->end end[shape=Msquare] }`;
    const r1 = formatted(input);
    const r2 = formatted(r1!);
    expect(r1).not.toBeNull();
    expect(r1).toBe(r2);
    expect(r1).toContain("graph []");
  });

  it("preserves edge starting with keyword 'graph' as node name (graph -> b)", () => {
    // "graph" used as a node identifier in an edge statement
    const input = `digraph G { start [shape=Mdiamond] graph -> b b [shape=Msquare] }`;
    const result = formatted(input);
    expect(result).not.toBeNull();
    // The edge must be present in the output
    expect(result).toContain("graph -> b");
    // The node 'b' must appear exactly once
    const bOccurrences = (result!.match(/\bb\b/g) ?? []).length;
    expect(bOccurrences).toBe(2); // once in edge chain, once in node decl
  });

  it("preserves edge starting with keyword 'node' as node name (node -> b)", () => {
    const input = `digraph G { start [shape=Mdiamond] node -> b b [shape=Msquare] }`;
    const result = formatted(input);
    expect(result).not.toBeNull();
    expect(result).toContain("node -> b");
  });

  it("preserves edge starting with keyword 'edge' as node name (edge -> b)", () => {
    const input = `digraph G { start [shape=Mdiamond] edge -> b b [shape=Msquare] }`;
    const result = formatted(input);
    expect(result).not.toBeNull();
    expect(result).toContain("edge -> b");
  });

  // ── Alignment tests (Phase 3) ────────────────────────────────────────────────

  it("aligns node IDs within an alignment block", () => {
    const input = [
      `digraph G {`,
      `  s [shape=Mdiamond]`,
      `  long_node [shape=box, prompt="Work"]`,
      `  e [shape=Msquare]`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    // All three nodes in same block (no blank lines between them); maxIdLen = 9 ("long_node")
    expect(result).toContain(`  s         [shape = "Mdiamond"]`);
    expect(result).toContain(`  long_node [shape = "box",`);
    expect(result).toContain(`  e         [shape = "Msquare"]`);
  });

  it("aligns = signs within node attr blocks by position", () => {
    const input = [
      `digraph G {`,
      `  a [shape=box, prompt="Do work"]`,
      `  b [llm_model=claude, shape=circle]`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    // sorted order: shape(1), prompt(4), llm_model(12)
    // maxKeyLen[0]=5 (both "shape"); maxKeyLen[1]=max("prompt"=6,"llm_model"=9)=9
    // "prompt".padEnd(9) = "prompt   " → prompt    = "Do work"
    expect(result).toContain(`shape = "box", prompt    = "Do work"`);
    expect(result).toContain(`shape = "circle", llm_model = "claude"`);
  });

  it("aligns edge -> arrows within an alignment block", () => {
    const input = [
      `digraph G {`,
      `  src -> dst`,
      `  long_src -> dst`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    // maxNodeLen[0] = max(3("src"), 8("long_src")) = 8
    expect(result).toContain(`  src      -> dst`);
    expect(result).toContain(`  long_src -> dst`);
  });

  it("aligns [ bracket for edges with attrs in same block", () => {
    const input = [
      `digraph G {`,
      `  a -> b [weight=1]`,
      `  long_a -> b [condition=success]`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    // maxNodeLen[0]=6("long_a"), maxNodeLen[1]=1("b")
    // chains: "a      -> b" (11), "long_a -> b" (11) — same width
    // Both have attrs, maxChainWidth = 11
    expect(result).toContain(`  a      -> b [weight    = "1"]`);
    expect(result).toContain(`  long_a -> b [condition = "success"]`);
  });

  it("aligns graph attributes = signs", () => {
    const input = [
      `digraph G {`,
      `  goal = "Build"`,
      `  default_fidelity = "compact"`,
      `  s [shape=Mdiamond]`,
      `  e [shape=Msquare]`,
      `  s -> e`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    // maxKeyLen = max("goal"=4, "default_fidelity"=16) = 16
    expect(result).toContain(`  goal             = "Build"`);
    expect(result).toContain(`  default_fidelity = "compact"`);
  });

  it("does not align across blank-line boundaries (separate alignment blocks)", () => {
    const input = [
      `digraph G {`,
      `  short_id [shape=box]`,
      ``,
      `  very_long_identifier [shape=circle]`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    // blank line between them → separate alignment blocks → no cross-block padding
    expect(result).toContain(`  short_id [shape = "box"]`);
    expect(result).toContain(`  very_long_identifier [shape = "circle"]`);
  });

  it("is idempotent with aligned nodes", () => {
    const input = `digraph G { s [shape=Mdiamond] long_node [shape=box, goal_gate=true] e [shape=Msquare] s -> e }`;
    const result = formatted(input);
    expect(result).not.toBeNull();
    // Aligned output must itself be idempotent
    expect(formatted(result!)).toBe(result);
    // Alignment must be present: short IDs padded to "long_node" length (9)
    expect(result).toContain(`  s         [shape = "Mdiamond"]`);
    expect(result).toContain(`  long_node [shape = "box"`);
    expect(result).toContain(`  e         [shape = "Msquare"]`);
  });

  // ── Blank-line preservation tests (Phase 2) ─────────────────────────────────

  it("preserves one blank line between nodes that had a blank line in source", () => {
    const input = [
      `digraph G {`,
      `  a [shape = "box"]`,
      ``,
      `  b [shape = "circle"]`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  a [shape = "box"]`,
        ``,
        `  b [shape = "circle"]`,
        `}`,
      ].join("\n"),
    );
  });

  it("collapses multiple consecutive blank lines to one", () => {
    const input = [
      `digraph G {`,
      `  a [shape = "box"]`,
      ``,
      ``,
      `  b [shape = "circle"]`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  a [shape = "box"]`,
        ``,
        `  b [shape = "circle"]`,
        `}`,
      ].join("\n"),
    );
  });

  it("does not insert blank line between nodes that had no blank line in source", () => {
    const input = [
      `digraph G {`,
      `  a [shape = "box"]`,
      `  b [shape = "circle"]`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  a [shape = "box"]`,
        `  b [shape = "circle"]`,
        `}`,
      ].join("\n"),
    );
  });

  it("does not insert blank line between section-reordered nodes that were not adjacent in source", () => {
    // node_a and node_b are separated by an edge in the source;
    // after reordering they appear adjacent in the nodes section but should not get a blank line.
    const input = [
      `digraph G {`,
      `  a [shape = "Mdiamond"]`,
      `  a -> b`,
      `  b [shape = "Msquare"]`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  a [shape = "Mdiamond"]`,
        `  b [shape = "Msquare"]`,
        ``,
        `  a -> b`,
        `}`,
      ].join("\n"),
    );
  });

  it("preserves blank line between edges in edge section", () => {
    const input = [
      `digraph G {`,
      `  s [shape = "Mdiamond"]`,
      `  e [shape = "Msquare"]`,
      `  s -> a`,
      ``,
      `  a -> e`,
      `}`,
    ].join("\n");
    const result = formatted(input);
    expect(result).toBe(
      [
        `digraph G {`,
        `  s [shape = "Mdiamond"]`,
        `  e [shape = "Msquare"]`,
        ``,
        `  s -> a`,
        ``,
        `  a -> e`,
        `}`,
      ].join("\n"),
    );
  });

  it("is idempotent when blank lines are present", () => {
    const withBlanks = [
      `digraph G {`,
      `  a [shape = "box"]`,
      ``,
      `  b [shape = "circle"]`,
      ``,
      `  a -> b`,
      `}`,
    ].join("\n");
    expect(formatted(withBlanks)).toBe(withBlanks);
  });
});
