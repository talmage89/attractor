Review complete. All four spec changes are correctly implemented with no findings:

1. **Model registry** — `Models` const, `resolveModel()`, exports, and integration all match spec
2. **Comparators** — Parser extended with `>`, `>=`, `<`, `<=` (longest-match-first); evaluator does float comparison with NaN guards
3. **Append response.md** — Both `prompt.md` and `response.md` append with headers and separators; `status.json` still overwrites
4. **README .dag terminology** — All user-facing references updated; internal "DOT lexer and parser" unchanged

Build, typecheck, and all 447 tests pass cleanly.