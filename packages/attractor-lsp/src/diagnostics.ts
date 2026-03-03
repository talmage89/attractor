import { parse, validate } from "attractor";
import type { Diagnostic as AttractorDiag } from "attractor";
import type { Diagnostic as LspDiag } from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";

const SEVERITY_MAP = {
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
  info: DiagnosticSeverity.Information,
} as const;

export function computeDiagnostics(doc: TextDocument): LspDiag[] {
  const text = doc.getText();
  let graph;
  try {
    graph = parse(text);
  } catch (err) {
    return [parseErrorToDiagnostic(err)];
  }

  const attractorDiags = validate(graph);
  return attractorDiags.map((d) => mapDiagnostic(d));
}

function mapDiagnostic(d: AttractorDiag): LspDiag {
  let range;
  if (d.span) {
    range = {
      start: { line: d.span.line - 1, character: d.span.column - 1 },
      end: { line: d.span.endLine - 1, character: d.span.endColumn - 1 },
    };
  } else {
    range = { start: { line: 0, character: 0 }, end: { line: 0, character: 80 } };
  }
  return {
    range,
    severity: SEVERITY_MAP[d.severity],
    source: "attractor",
    code: d.rule,
    message: d.message,
  };
}

function parseErrorToDiagnostic(err: unknown): LspDiag {
  const msg = err instanceof Error ? err.message : String(err);
  // Error messages contain "line N, column N" or just "line N"
  const lineColMatch = msg.match(/line (\d+), column (\d+)/);
  const lineOnlyMatch = msg.match(/line (\d+)/);

  let range;
  if (lineColMatch) {
    const line = parseInt(lineColMatch[1], 10) - 1;
    const col = parseInt(lineColMatch[2], 10) - 1;
    range = {
      start: { line, character: col },
      end: { line, character: col + 1 },
    };
  } else if (lineOnlyMatch) {
    const line = parseInt(lineOnlyMatch[1], 10) - 1;
    range = {
      start: { line, character: 0 },
      end: { line, character: 80 },
    };
  } else {
    range = { start: { line: 0, character: 0 }, end: { line: 0, character: 80 } };
  }

  return {
    range,
    severity: DiagnosticSeverity.Error,
    source: "attractor",
    code: "parse_error",
    message: msg,
  };
}
