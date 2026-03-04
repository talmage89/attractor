**No bugs found.** Testing complete for `test_d`.

**Summary:**
- Build, typecheck, and all 447 tests pass
- Model registry: alias resolution, case-insensitivity, passthrough, and edge cases all correct
- Comparators: OPS ordering prevents `>=`/`<=` misparsing; NaN guards, float evaluation, multi-clause `&&` all work correctly; no regressions on `=`/`!=`
- `response.md`/`prompt.md` append: first-write omits separator, subsequent writes include `\n\n---\n\n` separator with correct header format
- README: all `.dot`→`.dag` changes in place, internal "DOT lexer and parser" reference preserved, new operator docs and Model Aliases section added