All 4 phases implemented and committed:

1. **Phase 1** — `models.ts` with `Models`/`resolveModel`/`ModelAlias`; wired into `CodergenHandler` and `cc-backend.ts`; exported from `index.ts`; 12 new tests + 1 integration test
2. **Phase 2** — Condition parser extended with `>`, `>=`, `<`, `<=` using longest-match-first; evaluator does float comparison with NaN guards; 14 new tests
3. **Phase 3** — `response.md` and `prompt.md` now append with `## <nodeId> — <ISO timestamp>` headers separated by `---`; new append test added
4. **Phase 4** — README updated: `.dot` → `.dag` in user examples, Model Aliases table, updated conditions operator list with routing example

**421 attractor tests + 26 LSP tests pass. Build and typecheck clean.**