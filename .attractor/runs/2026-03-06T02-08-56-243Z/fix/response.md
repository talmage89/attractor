## fix — 2026-03-06T02:35:11.286Z

Fixed BUG-001: `hasArrowAhead()` in `semantic-tokens.ts` was scanning past `EQUALS` tokens into subsequent lines. The fix is two-part:

1. Added `"EQUALS"` to the `hasArrowAhead` terminator set — stops scanning when it sees `=`, meaning the current identifier is an assignment key, not an edge source.
2. In the node-declaration path, consume the `= value` tokens when present, so the value string isn't left in the stream to be re-classified as an edge source on the next iteration.

Added 2 regression tests covering both subgraph-body (`label="Test"\nn1 -> n2`) and top-level (`goal="test"\na -> b`) patterns. 513 tests pass, build and typecheck clean.

---

## fix — 2026-03-06T02:51:33.785Z

Done. Fixed FINDING-001: quoted duration values like `timeout="30s"` were classified as `string` because they lex as `STRING` tokens. Added a duration-pattern check in `parseAttrList` so that when the key is `timeout` and the string value matches `/^-?\d+(\.\d+)?(ms|s|m|h|d)$/`, it emits `number+readonly` — consistent with unquoted `DURATION` tokens. Added 2 tests; all 515 tests pass, pushed to main.