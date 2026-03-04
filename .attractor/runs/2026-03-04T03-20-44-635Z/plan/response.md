Plan created with 4 phases matching the spec's implementation order:

1. **Model registry** — new `models.ts` + wire into codergen/cc-backend
2. **Comparators** — `>`, `>=`, `<`, `<=` in condition parser/evaluator
3. **Append response.md** — codergen appends instead of overwriting
4. **README docs** — `.dag` terminology + model alias + comparator docs

Committed and pushed to main.