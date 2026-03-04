# Attractor Iteration Summary

## What Was Built

This iteration delivered four improvements to the Attractor pipeline execution engine:

1. **Centralized model registry** — single source of truth for Claude model IDs with alias resolution
2. **Comparison operators** — `>`, `>=`, `<`, `<=` in condition expressions (previously only `=` and `!=`)
3. **Append-mode log files** — `response.md` and `prompt.md` accumulate across re-executions instead of being overwritten
4. **README terminology** — all user-facing documentation uses `.dag` file extension instead of `.dot`

---

## Key Implementation Decisions and Trade-offs

### Model Registry (`packages/attractor/src/model/models.ts`)
- **`const` object over enum**: `Models` is a plain `const` object rather than a TypeScript enum. This avoids reverse-mapping noise and works identically in plain JS consumers.
- **Single resolution point**: Alias resolution (`resolveModel()`) is called only in `CodergenHandler.execute()`, right before invoking the CC backend. The parser, stylesheet applicator, and graph model all continue to store the raw user-provided string. This preserves the original value for serialization/debugging and keeps the transformation boundary explicit.
- **Case-insensitive passthrough**: Unknown strings are returned unchanged, preserving compatibility with full Claude model IDs and third-party model names like `"gpt-5"`.

### Comparison Operators (`conditions/parser.ts`, `conditions/evaluator.ts`)
- **Longest-match-first ordering**: The parser checks `>=` and `<=` before `>` and `<` respectively, preventing `>=` from being mis-parsed as `>` then `=`.
- **Float comparison with NaN guard**: Both operands are parsed with `parseFloat()`. If either is `NaN` (non-numeric value or empty string), the clause evaluates to `false` rather than throwing.
- **No lexer changes needed**: Conditions are string-valued DOT attributes; the condition parser operates independently of the DOT lexer.

### Append-Mode Logs (`handlers/codergen.ts`)
- **Separator omitted for first entry**: When `response.md` does not yet exist, no leading `---` separator is prepended, producing a clean first section.
- **`status.json` continues to overwrite**: It represents current state, not history; the checkpoint already captures the latest outcome.
- **ISO timestamp in header**: Each section is headed `## <nodeId> — <ISO timestamp>` for unambiguous traceability across re-executions.

### README Terminology
- **Extension-agnostic CLI**: The CLI itself accepts any file path; no runtime changes were needed. Only documentation was updated.
- **Internal references unchanged**: `"DOT lexer and parser"` on line 211 was intentionally left as-is (internal reference, not user-facing).

---

## Files Created and Modified

### New files
| File | Purpose |
|---|---|
| `packages/attractor/src/model/models.ts` | Model registry: `Models` const, `resolveModel()`, `ModelAlias` type |
| `packages/attractor/test/model/models.test.ts` | 12 unit tests for `resolveModel` and `Models` |

### Modified files
| File | Change |
|---|---|
| `packages/attractor/src/backend/cc-backend.ts` | Default model uses `Models.SONNET` instead of hardcoded string |
| `packages/attractor/src/handlers/codergen.ts` | `resolveModel()` applied to `node.llmModel`; `prompt.md`/`response.md` now append with timestamped headers |
| `packages/attractor/src/index.ts` | Exports `Models`, `resolveModel`, `ModelAlias` |
| `packages/attractor/src/conditions/parser.ts` | `Clause.operator` extended; OPS array replaces neqIdx/eqIdx chain |
| `packages/attractor/src/conditions/evaluator.ts` | Switch statement for `>`, `>=`, `<`, `<=` with float parsing and NaN guards |
| `packages/attractor/test/conditions/conditions.test.ts` | 14 new test cases (6 parser + 8 evaluator) |
| `packages/attractor/test/handlers/codergen.test.ts` | Append-behavior test + alias resolution integration test |
| `README.md` | `.dag` terminology; comparator docs; model alias table |

---

## How to Use the New Features

### Model Aliases

Use short aliases in `llm_model` attributes:

```dot
plan [shape=box, prompt="Create a plan", llm_model="opus"]
review [shape=box, prompt="Review the plan", llm_model="haiku"]
```

| Alias | Resolves to |
|---|---|
| `sonnet` | `claude-sonnet-4-6` |
| `opus` | `claude-opus-4-6` |
| `haiku` | `claude-haiku-4-5-20251001` |

Aliases are case-insensitive. Full model IDs continue to work as before.

Or via model stylesheet:

```dot
graph [model_stylesheet="* { llm_model: sonnet } .critical { llm_model: opus }"]
```

### Comparison Operators

Route edges based on numeric context values:

```dot
test -> wrapup [condition="context.clean_sessions>=3"]
test -> test   [condition="context.clean_sessions<3"]
```

Conditions support `=`, `!=`, `>`, `>=`, `<`, `<=`, and `&&`. Numeric comparisons use float parsing; non-numeric values evaluate to `false`.

### Append-Mode Logs

When a codergen node re-executes (e.g., via a retry loop), `response.md` and `prompt.md` accumulate all attempts rather than showing only the last:

```
## implement — 2026-03-04T03:45:12.000Z

<first response>

---

## implement — 2026-03-04T03:47:33.000Z

<second response>
```

---

## Test Results

- **447 tests passing** (421 attractor + 26 attractor-lsp)
- Build: clean
- Typecheck: zero errors

---

## Known Limitations and Future Work

- **No model validation**: Unrecognized model strings (neither an alias nor a known Claude ID) pass through silently to the CC backend, which may fail at runtime. A validation warning rule could be added later.
- **No `.dag` extension enforcement**: The CLI is extension-agnostic by design; users can name files anything.
- **Attempt-numbered response subdirectories**: Currently all attempts for a node go into the same stage directory. Future work could create per-attempt subdirectories for finer-grained traceability.
- **No provider aliases**: Only Claude model aliases are supported. Third-party model names (e.g., `"gpt-5"`) pass through unchanged.
