import type { TextEdit } from "vscode-languageserver/node.js";
import type { TextDocument } from "vscode-languageserver-textdocument";

export function format(_doc: TextDocument): TextEdit[] {
  return [];
}
