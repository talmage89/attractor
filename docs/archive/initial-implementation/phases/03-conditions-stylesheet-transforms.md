# Phase 3: Condition Language + Model Stylesheet + Transforms

## Scope

Three small, self-contained subsystems and the transform pipeline that ties
them into graph preparation. After this phase, you can parse conditions,
apply stylesheets, expand variables, and fully prepare a graph for execution.

### Files to Create

```
src/
  conditions/
    parser.ts           # parseCondition() → Clause[]
    evaluator.ts        # evaluateCondition() → boolean

  stylesheet/
    parser.ts           # parseStylesheet() → StyleRule[]
    applicator.ts       # applyStylesheet(graph, rules)

  engine/
    transforms.ts       # applyTransforms(graph) — variable expansion + stylesheet

test/
  conditions/
    conditions.test.ts

  stylesheet/
    stylesheet.test.ts

  engine/
    transforms.test.ts
```

### Files to Update

```
src/
  validation/
    rules.ts            # Update conditionSyntaxRule and stylesheetSyntaxRule
                        # to use the real parsers, replacing the Phase 2 stubs
```

### Dependencies

Phase 1: `Graph`, `GraphNode`, `Outcome`, `Context`, graph query helpers.

---

## Implementation Notes

### conditions/parser.ts

```typescript
interface Clause {
  key: string;
  operator: "=" | "!=";
  value: string;
}

function parseCondition(source: string): Clause[]
```

Split on `&&`. For each clause:
1. Trim whitespace.
2. If empty, skip.
3. If contains `!=`, split on first `!=`. Key = left, value = right, operator = `!=`.
4. Else if contains `=`, split on first `=`. Key = left, value = right, operator = `=`.
5. Else treat as bare key (truthy check): `{ key: source, operator: "!=", value: "" }`.
6. Trim key and value.

On empty key after trimming, throw: `Invalid condition clause: "${clause}"`.

### conditions/evaluator.ts

```typescript
function evaluateCondition(
  condition: string,
  outcome: Outcome,
  context: Context
): boolean

function resolveKey(
  key: string,
  outcome: Outcome,
  context: Context
): string
```

`resolveKey`:
- `"outcome"` → `outcome.status ?? ""`
- `"preferred_label"` → `outcome.preferredLabel ?? ""`
- Starts with `"context."` → `context.getString(key)`. If empty, also try
  `context.getString(key.slice(8))` (without the "context." prefix).
- Anything else → `context.getString(key)`.
- Always returns a string. Missing values = `""`.

`evaluateCondition`:
- If condition is empty → return `true`.
- Parse into clauses.
- For each clause: resolve key, apply operator, short-circuit on first `false`.
- Return `true` only if all clauses pass.

### stylesheet/parser.ts

```typescript
interface StyleRule {
  selector: StyleSelector;
  declarations: Map<string, string>;
}

type StyleSelector =
  | { type: "universal" }
  | { type: "class"; className: string }
  | { type: "id"; nodeId: string };

function parseStylesheet(source: string): StyleRule[]
```

Parse rules left-to-right:
1. Skip whitespace.
2. Read selector: `*` → universal, `#identifier` → id, `.classname` → class.
3. Expect `{`.
4. Read declarations until `}`: `property : value ;`
   - Property must be one of: `llm_model`, `llm_provider`, `reasoning_effort`.
   - Value is everything until `;` or `}`, trimmed.
   - Semicolons between declarations are required. Trailing semicolon optional.
   - **Unrecognized property names are silently ignored** (not added to the
     declarations map). No error is thrown. This matches the source spec's
     "ignored with a warning" behavior — warnings can optionally be logged
     but the parse must succeed.
5. Return collected rules.

On malformed input (missing `{`, unterminated block), throw with position context.

### stylesheet/applicator.ts

```typescript
function applyStylesheet(graph: Graph, rules: StyleRule[]): void
```

For each node:
1. Collect all matching rules.
2. Sort by specificity ascending (0=universal, 1=class, 2=id). Later rules of
   same specificity win (stable sort, append order preserved).
3. For each property, if the node does not already have an explicit value:
   - `llm_model` → set `node.llmModel`
   - `llm_provider` → set `node.llmProvider`
   - `reasoning_effort` → set `node.reasoningEffort`

"Explicit value" means the node's raw attribute map contains the key. Default
values (like `reasoningEffort = "high"`) do NOT count as explicit. Check
`node.raw.has("llm_model")` etc.

A class selector `.code` matches if `node.className` (comma-separated) contains `"code"`.

### engine/transforms.ts

```typescript
function applyTransforms(graph: Graph): void
```

Runs in order:
1. **Variable expansion**: for every node, replace `$goal` in `node.prompt` with
   `graph.attributes.goal`.
2. **Stylesheet application**: if `graph.attributes.modelStylesheet` is non-empty,
   parse it and apply.

Both mutate the graph in place.

---

## Test Fixtures

### test/conditions/conditions.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { parseCondition } from "../../src/conditions/parser";
import { evaluateCondition } from "../../src/conditions/evaluator";
import { Context } from "../../src/model/context";

describe("condition parser", () => {
  it("parses a simple equality", () => {
    const clauses = parseCondition("outcome=success");
    expect(clauses).toEqual([
      { key: "outcome", operator: "=", value: "success" }
    ]);
  });

  it("parses not-equals", () => {
    const clauses = parseCondition("outcome!=success");
    expect(clauses).toEqual([
      { key: "outcome", operator: "!=", value: "success" }
    ]);
  });

  it("parses AND conjunction", () => {
    const clauses = parseCondition("outcome=success && context.tests_passed=true");
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toEqual({ key: "outcome", operator: "=", value: "success" });
    expect(clauses[1]).toEqual({ key: "context.tests_passed", operator: "=", value: "true" });
  });

  it("parses bare key as truthy check", () => {
    const clauses = parseCondition("context.has_flag");
    expect(clauses).toEqual([
      { key: "context.has_flag", operator: "!=", value: "" }
    ]);
  });

  it("trims whitespace", () => {
    const clauses = parseCondition("  outcome = success  ");
    expect(clauses[0].key).toBe("outcome");
    expect(clauses[0].value).toBe("success");
  });

  it("returns empty array for empty string", () => {
    expect(parseCondition("")).toEqual([]);
  });

  it("handles multiple && with spaces", () => {
    const clauses = parseCondition("a=1 && b=2 && c!=3");
    expect(clauses).toHaveLength(3);
  });
});

describe("condition evaluator", () => {
  function makeContext(values: Record<string, string>): Context {
    const ctx = new Context();
    for (const [k, v] of Object.entries(values)) {
      ctx.set(k, v);
    }
    return ctx;
  }

  it("empty condition returns true", () => {
    expect(evaluateCondition("", { status: "success" }, new Context())).toBe(true);
  });

  it("matches outcome=success", () => {
    expect(evaluateCondition(
      "outcome=success",
      { status: "success" },
      new Context()
    )).toBe(true);
  });

  it("rejects outcome=success when outcome is fail", () => {
    expect(evaluateCondition(
      "outcome=success",
      { status: "fail" },
      new Context()
    )).toBe(false);
  });

  it("matches outcome!=success", () => {
    expect(evaluateCondition(
      "outcome!=success",
      { status: "fail" },
      new Context()
    )).toBe(true);
  });

  it("resolves context values", () => {
    const ctx = makeContext({ "tests_passed": "true" });
    expect(evaluateCondition(
      "context.tests_passed=true",
      { status: "success" },
      ctx
    )).toBe(true);
  });

  it("resolves context values without prefix", () => {
    const ctx = makeContext({ "tests_passed": "true" });
    // context.tests_passed first checks the full key "context.tests_passed",
    // if not found, tries "tests_passed"
    expect(evaluateCondition(
      "context.tests_passed=true",
      { status: "success" },
      ctx
    )).toBe(true);
  });

  it("missing context values resolve to empty string", () => {
    expect(evaluateCondition(
      "context.missing=true",
      { status: "success" },
      new Context()
    )).toBe(false);
  });

  it("AND conjunction: all must pass", () => {
    const ctx = makeContext({ "flag": "true" });
    expect(evaluateCondition(
      "outcome=success && context.flag=true",
      { status: "success" },
      ctx
    )).toBe(true);
  });

  it("AND conjunction: one fails → false", () => {
    const ctx = makeContext({ "flag": "false" });
    expect(evaluateCondition(
      "outcome=success && context.flag=true",
      { status: "success" },
      ctx
    )).toBe(false);
  });

  it("resolves preferred_label", () => {
    expect(evaluateCondition(
      "preferred_label=Fix",
      { status: "success", preferredLabel: "Fix" },
      new Context()
    )).toBe(true);
  });

  it("bare key truthy check: non-empty = true", () => {
    const ctx = makeContext({ "has_flag": "yes" });
    expect(evaluateCondition("context.has_flag", { status: "success" }, ctx)).toBe(true);
  });

  it("bare key truthy check: missing = false", () => {
    expect(evaluateCondition("context.has_flag", { status: "success" }, new Context())).toBe(false);
  });
});
```

### test/stylesheet/stylesheet.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { parseStylesheet } from "../../src/stylesheet/parser";
import { applyStylesheet } from "../../src/stylesheet/applicator";
import { parse } from "../../src/parser/parser";

describe("stylesheet parser", () => {
  it("parses universal selector", () => {
    const rules = parseStylesheet(`* { llm_model: claude-sonnet-4-5; }`);
    expect(rules).toHaveLength(1);
    expect(rules[0].selector).toEqual({ type: "universal" });
    expect(rules[0].declarations.get("llm_model")).toBe("claude-sonnet-4-5");
  });

  it("parses class selector", () => {
    const rules = parseStylesheet(`.code { llm_model: claude-opus-4-6; }`);
    expect(rules[0].selector).toEqual({ type: "class", className: "code" });
  });

  it("parses id selector", () => {
    const rules = parseStylesheet(`#review { reasoning_effort: high; }`);
    expect(rules[0].selector).toEqual({ type: "id", nodeId: "review" });
  });

  it("parses multiple declarations", () => {
    const rules = parseStylesheet(`* { llm_model: claude-sonnet-4-5; llm_provider: anthropic; reasoning_effort: medium; }`);
    expect(rules[0].declarations.size).toBe(3);
  });

  it("parses multiple rules", () => {
    const rules = parseStylesheet(`
      * { llm_model: claude-sonnet-4-5; }
      .code { llm_model: claude-opus-4-6; }
      #critical { reasoning_effort: high; }
    `);
    expect(rules).toHaveLength(3);
  });

  it("throws on malformed stylesheet", () => {
    expect(() => parseStylesheet(`* llm_model: foo; }`)).toThrow();
  });
});

describe("stylesheet applicator", () => {
  it("applies universal rule to all nodes", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        b [shape=box]
        s -> a -> b -> e
      }
    `);
    const rules = parseStylesheet(`* { llm_model: claude-sonnet-4-5; }`);
    applyStylesheet(graph, rules);
    expect(graph.nodes.get("a")?.llmModel).toBe("claude-sonnet-4-5");
    expect(graph.nodes.get("b")?.llmModel).toBe("claude-sonnet-4-5");
  });

  it("class selector overrides universal", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, class="code"]
        b [shape=box]
        s -> a -> b -> e
      }
    `);
    const rules = parseStylesheet(`
      * { llm_model: claude-sonnet-4-5; }
      .code { llm_model: claude-opus-4-6; }
    `);
    applyStylesheet(graph, rules);
    expect(graph.nodes.get("a")?.llmModel).toBe("claude-opus-4-6");
    expect(graph.nodes.get("b")?.llmModel).toBe("claude-sonnet-4-5");
  });

  it("id selector overrides class", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        review [shape=box, class="code"]
        s -> review -> e
      }
    `);
    const rules = parseStylesheet(`
      .code { llm_model: claude-opus-4-6; }
      #review { llm_model: gpt-5; }
    `);
    applyStylesheet(graph, rules);
    expect(graph.nodes.get("review")?.llmModel).toBe("gpt-5");
  });

  it("explicit node attribute overrides stylesheet", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box, llm_model="my-model"]
        s -> a -> e
      }
    `);
    const rules = parseStylesheet(`* { llm_model: claude-sonnet-4-5; }`);
    applyStylesheet(graph, rules);
    expect(graph.nodes.get("a")?.llmModel).toBe("my-model");
  });
});
```

### test/engine/transforms.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser";
import { applyTransforms } from "../../src/engine/transforms";

describe("transforms", () => {
  it("expands $goal in node prompts", () => {
    const graph = parse(`
      digraph G {
        graph [goal="Build auth system"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        plan [prompt="Create a plan for: $goal"]
        s -> plan -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("plan")?.prompt).toBe(
      "Create a plan for: Build auth system"
    );
  });

  it("applies stylesheet during transform", () => {
    const graph = parse(`
      digraph G {
        graph [model_stylesheet="* { llm_model: claude-sonnet-4-5; }"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [shape=box]
        s -> a -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("a")?.llmModel).toBe("claude-sonnet-4-5");
  });

  it("does not modify prompts without $goal", () => {
    const graph = parse(`
      digraph G {
        graph [goal="Something"]
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [prompt="No variable here"]
        s -> a -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("a")?.prompt).toBe("No variable here");
  });

  it("handles empty goal gracefully", () => {
    const graph = parse(`
      digraph G {
        s [shape=Mdiamond]
        e [shape=Msquare]
        a [prompt="Goal is: $goal"]
        s -> a -> e
      }
    `);
    applyTransforms(graph);
    expect(graph.nodes.get("a")?.prompt).toBe("Goal is: ");
  });
});
```

---

## Completion Criteria

- [ ] Condition parser handles `=`, `!=`, `&&`, bare keys, whitespace
- [ ] Condition evaluator resolves `outcome`, `preferred_label`, `context.*`
- [ ] Missing context values resolve to empty string
- [ ] Stylesheet parser handles `*`, `.class`, `#id` selectors
- [ ] Stylesheet applicator respects specificity order
- [ ] Explicit node attributes override stylesheet
- [ ] `applyTransforms()` runs variable expansion and stylesheet in order
- [ ] `$goal` expansion works, no-op when absent
- [ ] Update `conditionSyntaxRule` in `src/validation/rules.ts` to call
  `parseCondition()` and report parse errors as diagnostics (replacing Phase 2 stub)
- [ ] Update `stylesheetSyntaxRule` in `src/validation/rules.ts` to call
  `parseStylesheet()` and report parse errors as diagnostics (replacing Phase 2 stub)
- [ ] All Phase 1 and 2 tests still pass
- [ ] All tests pass: `npx vitest run`
