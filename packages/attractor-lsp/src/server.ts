#!/usr/bin/env node
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { computeDiagnostics } from "./diagnostics.js";
import { format } from "./formatter.js";
import { computeSemanticTokens, TOKEN_LEGEND } from "./semantic-tokens.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    documentFormattingProvider: true,
    semanticTokensProvider: {
      legend: {
        tokenTypes: [...TOKEN_LEGEND.tokenTypes],
        tokenModifiers: [...TOKEN_LEGEND.tokenModifiers],
      },
      full: true,
    },
  },
}));

documents.onDidChangeContent((change) => {
  const diags = computeDiagnostics(change.document);
  connection.sendDiagnostics({ uri: change.document.uri, diagnostics: diags });
});

connection.languages.semanticTokens.on((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return { data: [] };
  return { data: computeSemanticTokens(doc.getText()) };
});

connection.onDocumentFormatting((params) => {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];
  return format(doc);
});

connection.onShutdown(() => {
  // Clean teardown
});

connection.onExit(() => {
  process.exit(0);
});

documents.listen(connection);
connection.listen();
