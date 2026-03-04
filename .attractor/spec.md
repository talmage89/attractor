# Attractor — Iteration Spec

## Changes

### 1. User-facing documentation: `.dag` file terminology

**Goal**: All user-facing documentation refers to pipeline definition files as
`.dag` files, not `.dot` files. Internal source code (parser module names,
comments referencing DOT syntax) is unchanged.

**File**: `README.md`

Changes:
- Line 5: "Define pipelines as DOT graphs" → "Define pipelines as `.dag` graphs"
- Line 9: "Pipelines are directed graphs written in a subset of the DOT
  language" → "Pipelines are directed graphs written in `.dag` files, a subset
  of the DOT language"
- Lines 42–49: All CLI examples change from `pipeline.dot` to `pipeline.dag`
- Line 45: "Validate a DOT file" → "Validate a `.dag` file"
- Line 195: `pipeline.dot` → `pipeline.dag` in the `--resume` example
- Line 211: "DOT lexer and parser" → remains unchanged (internal reference)

No other files need changes. The CLI itself is extension-agnostic (it reads any
file path the user provides), so no runtime changes are needed.

---

### 2. Result visibility: append to response.md instead of overwriting

**Package**: `attractor`
**File**: `packages/attractor/src/handlers/codergen.ts`

**Current behavior**: Line 215 unconditionally overwrites
`<logsRoot>/<nodeId>/response.md` with the latest CC response via
`fs.writeFile`. When a node re-executes (e.g., `implement` loops back), only
the last response survives.

**New behavior**: Append to `response.md` instead of overwriting. Each
execution appends a section with a header separator so individual responses
remain distinguishable.

**Format of each appended section**:

```markdown
---

## <nodeId> — <ISO timestamp>

<response text>
```

The `---` horizontal rule serves as a visual separator. The heading includes the
node ID and an ISO 8601 timestamp for traceability. The first entry in the file
omits the leading `---` (since there's nothing above it to separate from).

**Implementation**: In `CodergenHandler.execute()`, replace:

```typescript
await fs.writeFile(path.join(stageDir, "response.md"), ccResult.text, "utf-8");
```

with:

```typescript
const responsePath = path.join(stageDir, "response.md");
const timestamp = new Date().toISOString();
const header = `## ${node.id} — ${timestamp}`;
let existing = "";
try {
  existing = await fs.readFile(responsePath, "utf-8");
} catch {
  // file doesn't exist yet
}
const separator = existing ? "\n\n---\n\n" : "";
await fs.writeFile(responsePath, existing + separator + header + "\n\n" + ccResult.text, "utf-8");
```

Apply the same append pattern to `prompt.md` (line 191), so the prompt that
produced each response is also preserved.

`status.json` continues to be overwritten (it represents current state, not
history — the checkpoint already captures the latest outcome).

#### Tests

Add a test in `packages/attractor/test/handlers/codergen.test.ts` (or the
existing handler test file) that:

1. Executes a codergen node twice against the same stage directory
2. Reads `response.md` and verifies it contains both responses separated by
   `---`
3. Verifies each section has the correct header format
4. Verifies `prompt.md` also contains both prompts

---

### 3. Better comparators in condition expressions

**Package**: `attractor`
**Files**:
- `packages/attractor/src/conditions/parser.ts`
- `packages/attractor/src/conditions/evaluator.ts`

#### 4a. Parser changes

**Current state**: `Clause.operator` is `"=" | "!="`. The parser checks for
`!=` first (indexOf), then `=`.

**New operator type**:

```typescript
export interface Clause {
  key: string;
  operator: "=" | "!=" | ">" | ">=" | "<" | "<=";
  value: string;
}
```

**Parsing order**: Check for multi-character operators first (longest match),
then single-character:

1. `>=`
2. `<=`
3. `!=`
4. `>`
5. `<`
6. `=`

This prevents `>=` from being parsed as `>` + `=`.

**Implementation**: Replace the current `neqIdx`/`eqIdx` chain with an ordered
search through operator tokens:

```typescript
const OPS: { token: string; operator: Clause["operator"] }[] = [
  { token: ">=", operator: ">=" },
  { token: "<=", operator: "<=" },
  { token: "!=", operator: "!=" },
  { token: ">", operator: ">" },
  { token: "<", operator: "<" },
  { token: "=", operator: "=" },
];

for (const { token, operator } of OPS) {
  const idx = clause.indexOf(token);
  if (idx !== -1) {
    const key = clause.slice(0, idx).trim();
    const value = clause.slice(idx + token.length).trim();
    if (key === "") throw new Error(`Invalid condition clause: "${clause}"`);
    clauses.push({ key, operator, value });
    break;
  }
}
```

The bare-key fallback (no operator found) remains: `{ key, operator: "!=", value: "" }`.

#### 4b. Evaluator changes

**Current state**: `evaluateCondition()` does string comparison for `=` and `!=`.

**New behavior**: For `>`, `>=`, `<`, `<=`, both the resolved value and the
clause value are parsed as floats. If either side is `NaN`, the clause evaluates
to `false`.

```typescript
for (const clause of clauses) {
  const resolved = resolveKey(clause.key, outcome, context).trim();
  switch (clause.operator) {
    case "=":
      if (resolved !== clause.value) return false;
      break;
    case "!=":
      if (resolved === clause.value) return false;
      break;
    case ">":
    case ">=":
    case "<":
    case "<=": {
      const a = parseFloat(resolved);
      const b = parseFloat(clause.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (clause.operator === ">" && !(a > b)) return false;
      if (clause.operator === ">=" && !(a >= b)) return false;
      if (clause.operator === "<" && !(a < b)) return false;
      if (clause.operator === "<=" && !(a <= b)) return false;
      break;
    }
  }
}
```

#### 4c. Validation

The existing condition syntax validation rule (if any) should be updated to
accept the new operators. The lexer does not need changes — conditions are
string values inside quoted attributes and parsed by the condition parser, not
the DOT lexer.

#### 4d. Documentation

Update `README.md` line 120 from:

```
Conditions support `=`, `!=`, and `&&`:
```

to:

```
Conditions support `=`, `!=`, `>`, `>=`, `<`, `<=`, and `&&`:
```

Add an example:

```dot
test -> wrapup [condition="context.clean_sessions>=3"]
test -> test   [condition="context.clean_sessions<3"]
```

#### Tests

Add test cases in the existing condition parser/evaluator test files:

**Parser tests**:
- `context.x>5` → `{ key: "context.x", operator: ">", value: "5" }`
- `context.x>=5` → `{ key: "context.x", operator: ">=", value: "5" }`
- `context.x<5` → `{ key: "context.x", operator: "<", value: "5" }`
- `context.x<=5` → `{ key: "context.x", operator: "<=", value: "5" }`
- `context.x>=5 && context.y<10` → two clauses with correct operators
- Bare key fallback still works

**Evaluator tests**:
- `context.count>2` with count=3 → true
- `context.count>2` with count=2 → false
- `context.count>=2` with count=2 → true
- `context.count<5` with count=3 → true
- `context.count<=3` with count=3 → true
- `context.count>2` with count="abc" → false (NaN guard)
- `context.count>2` with count="" → false (NaN guard)
- Mixed: `context.x>=1 && context.y!=bad` → both clauses evaluated

---

### 4. Centralized model registry with alias resolution

**Package**: `attractor`

#### 4a. New file: `packages/attractor/src/model/models.ts`

Create a centralized model registry that maps short aliases to full model IDs.
The registry is a plain object with version-free keys (`OPUS`, `SONNET`,
`HAIKU`) so that updating to a new model release requires changing a single
file.

```typescript
export const Models = {
  OPUS: "claude-opus-4-6",
  SONNET: "claude-sonnet-4-6",
  HAIKU: "claude-haiku-4-5-20251001",
} as const;

export type ModelAlias = keyof typeof Models;

const ALIAS_MAP: Record<string, string> = {
  opus: Models.OPUS,
  sonnet: Models.SONNET,
  haiku: Models.HAIKU,
};

/**
 * Resolve a model string. If it matches a known alias (case-insensitive),
 * return the full model ID. Otherwise return the input unchanged (it may
 * be a full model ID or a third-party model name).
 */
export function resolveModel(input: string): string {
  return ALIAS_MAP[input.toLowerCase()] ?? input;
}
```

Design notes:
- `Models` is a `const` object, not an enum, for simpler consumption (no
  reverse mapping noise, works as values in plain JS).
- `resolveModel` is case-insensitive: `"Sonnet"`, `"SONNET"`, `"sonnet"` all
  resolve to the same ID.
- Unknown strings pass through unchanged — this preserves support for
  third-party model names (e.g., `"gpt-5"`) and full Claude model IDs written
  explicitly.

#### 4b. Export from `packages/attractor/src/index.ts`

Add to the public API exports:

```typescript
export { Models, resolveModel } from "./model/models.js";
export type { ModelAlias } from "./model/models.js";
```

This allows programmatic consumers to use `Models.OPUS` instead of hardcoding
strings.

#### 4c. Resolution point: `CodergenHandler`

**File**: `packages/attractor/src/handlers/codergen.ts`

Apply alias resolution in `CodergenHandler.execute()` where `node.llmModel` is
passed to `ccOptions`. Change:

```typescript
if (node.llmModel) ccOptions.model = node.llmModel;
```

to:

```typescript
if (node.llmModel) ccOptions.model = resolveModel(node.llmModel);
```

Import `resolveModel` from `../model/models.js`.

This is the single resolution point — aliases are resolved at the boundary
between the pipeline model and the CC backend. The parser and stylesheet
applicator continue to store the raw user-provided string. This means:
- `node.llmModel` retains the alias (useful for serialization, debugging)
- Resolution happens once, right before invocation
- The formatter round-trips the original value, not the resolved one

#### 4d. Replace hardcoded default in `cc-backend.ts`

**File**: `packages/attractor/src/backend/cc-backend.ts`

Change line 54:

```typescript
queryOptions.model = options.model ?? "claude-sonnet-4-6";
```

to:

```typescript
queryOptions.model = options.model ?? Models.SONNET;
```

Import `Models` from `../model/models.js`. This ensures the default model is
defined in one place.

#### 4e. Documentation

Update `README.md` to document alias support. Add a subsection under
"Pipeline Features" or within the "Node Types" table context:

```markdown
### Model Aliases

Use short aliases instead of full model IDs in `llm_model` attributes:

| Alias | Resolves to |
|---|---|
| `sonnet` | `claude-sonnet-4-6` |
| `opus` | `claude-opus-4-6` |
| `haiku` | `claude-haiku-4-5-20251001` |

Aliases are case-insensitive. Full model IDs and third-party model names
continue to work as before.

```dot
plan [shape=box, prompt="Create a plan", llm_model="opus"]
```

Or via model stylesheet:

```dot
graph [model_stylesheet="* { llm_model: sonnet } .critical { llm_model: opus }"]
```
```

#### Tests

Add tests in a new file `packages/attractor/test/model/models.test.ts`:

**`resolveModel` tests**:
- `resolveModel("sonnet")` → `"claude-sonnet-4-6"`
- `resolveModel("opus")` → `"claude-opus-4-6"`
- `resolveModel("haiku")` → `"claude-haiku-4-5-20251001"`
- `resolveModel("Sonnet")` → `"claude-sonnet-4-6"` (case-insensitive)
- `resolveModel("OPUS")` → `"claude-opus-4-6"` (case-insensitive)
- `resolveModel("claude-sonnet-4-6")` → `"claude-sonnet-4-6"` (passthrough)
- `resolveModel("gpt-5")` → `"gpt-5"` (unknown passthrough)
- `resolveModel("")` → `""` (empty passthrough)

**`Models` constant tests**:
- `Models.OPUS` is a string
- `Models.SONNET` is a string
- `Models.HAIKU` is a string
- All values contain `"claude-"` prefix (sanity check)

**Integration test** (in existing codergen handler tests):
- Set `node.llmModel = "opus"` and verify `runCC` receives
  `"claude-opus-4-6"` as the model option

---

## Implementation order

1. **Change 4** (model registry) — new file + two call-site changes, no
   cross-package dependencies; do first so other changes can reference
   `Models` if needed
2. **Change 3** (comparators) — standalone, conditions package only
3. **Change 2** (response.md append) — standalone, codergen handler only
4. **Change 1** (README terminology) — documentation only, do last (can
   incorporate README changes from changes 3, 4 at the same time)

## Out of scope

- Runtime enforcement of `.dag` file extension
- Renaming internal parser modules from "DOT" to "DAG"
- Writing a `summary.md` at pipeline exit (deferred)
- Attempt-numbered subdirectories for response files
- Model validation (warning on unrecognized model strings) — may add later
- Provider-specific alias resolution (e.g., OpenAI model aliases)
