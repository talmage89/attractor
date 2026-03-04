All done. Here's what was completed in this wrapup stage:

**Final validation**: Build, typecheck, and all 419 tests pass (393 attractor + 26 attractor-lsp).

**Summary written** to `.attractor/workspace/summary.md` covering:
- What was built (LSP server with diagnostics + formatting)
- Key decisions (CST-level formatter, statement-level spans, error recovery strategy, vscode-languageserver version)
- All files created/modified with line counts
- Usage instructions (build, Helix config, formatting rules)
- Known limitations and future work

**Cleanup**: Removed `plan.md`, `progress.md`, and `findings.md` from the workspace directory; kept `spec.md` and `summary.md`.

**Committed and pushed** to `main`.