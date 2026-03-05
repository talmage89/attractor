import type { ExtensionContext } from "vscode";
import {
  LanguageClient,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  client = new LanguageClient(
    "attractor",
    "Attractor DAG",
    {
      command: "attractor-lsp",
      args: ["--stdio"],
      transport: TransportKind.stdio,
    },
    {
      documentSelector: [{ scheme: "file", language: "attractor" }],
    },
  );

  client.start();
  context.subscriptions.push(client);
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
