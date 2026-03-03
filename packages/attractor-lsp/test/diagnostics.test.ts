import { describe, it, expect } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { computeDiagnostics } from "../src/diagnostics.js";

function makeDoc(text: string): TextDocument {
  return TextDocument.create("file:///test.dag", "attractor", 1, text);
}

describe("computeDiagnostics()", () => {
  it("returns no diagnostics for a valid file", () => {
    const input = [
      `digraph G {`,
      `  start [shape=Mdiamond]`,
      `  start -> end`,
      `  end [shape=Msquare]`,
      `}`,
    ].join("\n");

    const diags = computeDiagnostics(makeDoc(input));
    expect(diags).toEqual([]);
  });

  it("returns a single parse_error diagnostic with correct line/column for a lex error", () => {
    // '@' is illegal — lexer throws: "Unexpected character '@' at line 1, column 13"
    const input = `digraph G { @@@invalid }`;
    const diags = computeDiagnostics(makeDoc(input));

    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe(DiagnosticSeverity.Error);
    expect(d.source).toBe("attractor");
    expect(d.code).toBe("parse_error");
    // 'digraph G { ' is 12 chars → '@' is at column 13 (1-indexed) → 12 (0-indexed)
    expect(d.range.start).toEqual({ line: 0, character: 12 });
    expect(d.range.end).toEqual({ line: 0, character: 13 });
  });

  it("returns an error diagnostic for missing start node, falling back to document start", () => {
    // No shape=Mdiamond and no id=start/Start
    const input = [
      `digraph G {`,
      `  a [shape=box, label=Work]`,
      `  a -> end`,
      `  end [shape=Msquare]`,
      `}`,
    ].join("\n");

    const diags = computeDiagnostics(makeDoc(input));
    const startDiag = diags.find((d) => d.code === "start_node");

    expect(startDiag).toBeDefined();
    expect(startDiag!.severity).toBe(DiagnosticSeverity.Error);
    // No span on graph-level diagnostic → fallback to {line:0, char:0}–{line:0, char:80}
    expect(startDiag!.range.start).toEqual({ line: 0, character: 0 });
    expect(startDiag!.range.end).toEqual({ line: 0, character: 80 });
  });

  it("returns an error diagnostic with span pointing at an unreachable node declaration", () => {
    const input = [
      `digraph G {`,
      `  start [shape=Mdiamond]`,
      `  start -> end`,
      `  end [shape=Msquare]`,
      `  orphan [shape=box, label=Orphan]`,
      `}`,
    ].join("\n");

    const diags = computeDiagnostics(makeDoc(input));
    const reachDiag = diags.find((d) => d.code === "reachability");

    expect(reachDiag).toBeDefined();
    expect(reachDiag!.severity).toBe(DiagnosticSeverity.Error);
    // 'orphan' is on line 5 (1-indexed) → line 4 (0-indexed)
    expect(reachDiag!.range.start.line).toBe(4);
    // Should have a non-zero character position (2-space indent → character 2)
    expect(reachDiag!.range.start.character).toBe(2);
  });

  it("returns a warning diagnostic with span for an invalid edge weight", () => {
    const input = [
      `digraph G {`,
      `  start [shape=Mdiamond]`,
      `  start -> end [weight=not_a_number]`,
      `  end [shape=Msquare]`,
      `}`,
    ].join("\n");

    const diags = computeDiagnostics(makeDoc(input));
    const weightDiag = diags.find((d) => d.code === "invalid_edge_weight");

    expect(weightDiag).toBeDefined();
    expect(weightDiag!.severity).toBe(DiagnosticSeverity.Warning);
    expect(weightDiag!.source).toBe("attractor");
    // Edge 'start -> end' is on line 3 (1-indexed) → line 2 (0-indexed)
    expect(weightDiag!.range.start.line).toBe(2);
    // Should NOT be the fallback character=0 with line=0
    expect(weightDiag!.range.start).not.toEqual({ line: 0, character: 0 });
  });

  it("maps multiple diagnostics with correct severity values", () => {
    // This file triggers: start_node (error), terminal_node (error),
    // type_known (warning), fidelity_valid (warning), invalid_edge_weight (warning)
    const input = [
      `digraph G {`,
      `  a [shape=box, type=unknown_type, fidelity=invalid_fidelity]`,
      `  a -> b [weight=bad_weight]`,
      `  b [shape=box, label=Work]`,
      `}`,
    ].join("\n");

    const diags = computeDiagnostics(makeDoc(input));

    // At minimum we expect errors and warnings
    const errors = diags.filter((d) => d.severity === DiagnosticSeverity.Error);
    const warnings = diags.filter((d) => d.severity === DiagnosticSeverity.Warning);

    // start_node + terminal_node
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((d) => d.code === "start_node")).toBe(true);
    expect(errors.some((d) => d.code === "terminal_node")).toBe(true);

    // type_known + fidelity_valid + invalid_edge_weight
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    expect(warnings.some((d) => d.code === "type_known")).toBe(true);
    expect(warnings.some((d) => d.code === "fidelity_valid")).toBe(true);
    expect(warnings.some((d) => d.code === "invalid_edge_weight")).toBe(true);

    // Verify severity constants map correctly
    expect(DiagnosticSeverity.Error).toBe(1);
    expect(DiagnosticSeverity.Warning).toBe(2);
  });
});
