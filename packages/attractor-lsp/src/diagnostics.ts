import type { Diagnostic as LspDiag } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";

export function computeDiagnostics(_doc: TextDocument): LspDiag[] {
  return [];
}
