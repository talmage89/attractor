Testing complete. **No bugs found.**

Summary:
- **Build/typecheck/tests**: All clean (447/447 tests pass)
- **Model registry**: `resolveModel()` works case-insensitively, passthrough for unknowns, `Models.SONNET` used as default in cc-backend
- **Comparators**: `>`, `>=`, `<`, `<=` all parse and evaluate correctly with float comparison and NaN guards; existing `=`/`!=` unaffected
- **Append response.md**: First entry has no leading `---`, subsequent entries separated by `\n\n---\n\n` with `## nodeId — <ISO>` headers; prompt.md gets same treatment
- **README**: All spec-required terminology changes present, no `.dot` references remain
- **Regressions**: LSP (26/26), edge selection, validation rules — all clean