# Phase 2: Validation and Linting

## Scope

All lint rules and the validation API. After this phase, you can parse a DOT
file and get a list of errors, warnings, and info diagnostics.

### Files to Create

```
src/
  validation/
    diagnostic.ts       # Diagnostic, Severity types
    rules.ts            # All built-in lint rule functions
    validator.ts         # validate(), validateOrThrow()

test/
  validation/
    validator.test.ts
```

### Dependencies

Phase 1: `Graph`, `GraphNode`, `Edge`, graph query helpers, `parse()`.

---

## Implementation Notes

### validation/diagnostic.ts

```typescript
type Severity = "error" | "warning" | "info";

interface Diagnostic {
  rule: string;
  severity: Severity;
  message: string;
  nodeId?: string;
  edge?: { from: string; to: string };
  fix?: string;
}
```

### validation/rules.ts

Each rule is a standalone function: `(graph: Graph) => Diagnostic[]`.

Export all rules as an array:

```typescript
type LintRule = (graph: Graph) => Diagnostic[];

const BUILT_IN_RULES: LintRule[] = [
  startNodeRule,
  terminalNodeRule,
  startNoIncomingRule,
  exitNoOutgoingRule,
  reachabilityRule,
  edgeTargetExistsRule,
  conditionSyntaxRule,
  stylesheetSyntaxRule,
  typeKnownRule,
  fidelityValidRule,
  retryTargetExistsRule,
  goalGateHasRetryRule,
  promptOnLlmNodesRule,
];
```

**Rule implementations:**

`startNodeRule`: Count nodes where `shape === "Mdiamond"` or `id` is `"start"`/`"Start"`.
If zero → error. If more than one → error.

`terminalNodeRule`: Count nodes where `shape === "Msquare"` or `id` is `"exit"`/`"end"`.
If zero → error.

`startNoIncomingRule`: Find start node. Check `incomingEdges(graph, startNode.id).length === 0`.
If not → error.

`exitNoOutgoingRule`: Find exit node. Check `outgoingEdges(graph, exitNode.id).length === 0`.
If not → error.

`reachabilityRule`: BFS from start node. Any node not in the visited set → error per node.
Use `outgoingEdges` to traverse.

`edgeTargetExistsRule`: For every edge, check `graph.nodes.has(edge.from)` and
`graph.nodes.has(edge.to)`. If not → error per missing reference.

`conditionSyntaxRule`: For every edge with non-empty `condition`, attempt to parse it
(Phase 3 provides the parser; for now, stub this rule to always pass, or implement
a basic syntax check: must contain `=` or `!=`, must have a key and value).

Note: This rule depends on the condition parser from Phase 3. For Phase 2,
implement a minimal check: the condition string must be non-empty and contain
at least one `=` or `!=`. The full parser integration happens in Phase 3.

`stylesheetSyntaxRule`: Same situation. For Phase 2, check that the string is
non-empty and contains `{` and `}`. Full integration in Phase 3.

`typeKnownRule`: If `node.type` is non-empty, check against the known set:
`["start", "exit", "codergen", "conditional", "wait.human", "parallel", "parallel.fan_in", "tool"]`.
If not → warning.

`fidelityValidRule`: If `node.fidelity` is non-empty, check against:
`["full", "truncate", "compact", "summary:low", "summary:medium", "summary:high"]`.
If not → warning.

`retryTargetExistsRule`: If `node.retryTarget` is non-empty, check `graph.nodes.has(node.retryTarget)`.
Same for `fallbackRetryTarget`. If not → warning.

`goalGateHasRetryRule`: For nodes with `goalGate === true`, check that at least one
retry target exists (node-level, or graph-level). If not → warning.

`promptOnLlmNodesRule`: For nodes that would resolve to the codergen handler
(shape `"box"` or no explicit type), if `prompt` and `label` are both empty → warning.

### validation/validator.ts

```typescript
function validate(graph: Graph, extraRules?: LintRule[]): Diagnostic[] {
  const rules = [...BUILT_IN_RULES, ...(extraRules ?? [])];
  const diagnostics: Diagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule(graph));
  }
  return diagnostics;
}

function validateOrThrow(graph: Graph, extraRules?: LintRule[]): Diagnostic[] {
  const diagnostics = validate(graph, extraRules);
  const errors = diagnostics.filter(d => d.severity === "error");
  if (errors.length > 0) {
    const messages = errors.map(d => `[${d.rule}] ${d.message}`).join("\n");
    throw new Error(`Validation failed:\n${messages}`);
  }
  return diagnostics; // warnings and info only
}
```

---

## Test Fixtures

### test/validation/validator.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser";
import { validate, validateOrThrow } from "../../src/validation/validator";

describe("validation", () => {
  describe("startNodeRule", () => {
    it("passes with exactly one start node", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e
        }
      `);
      const diags = validate(graph);
      expect(diags.filter(d => d.rule === "start_node")).toHaveLength(0);
    });

    it("errors when no start node", () => {
      const graph = parse(`
        digraph G {
          a [shape=box]
          e [shape=Msquare]
          a -> e
        }
      `);
      const diags = validate(graph);
      const startErrors = diags.filter(d => d.rule === "start_node" && d.severity === "error");
      expect(startErrors.length).toBeGreaterThan(0);
    });

    it("accepts id=start as fallback start node", () => {
      const graph = parse(`
        digraph G {
          start [shape=box]
          exit  [shape=Msquare]
          start -> exit
        }
      `);
      // This should NOT error — "start" id is accepted
      const diags = validate(graph);
      const startErrors = diags.filter(d => d.rule === "start_node" && d.severity === "error");
      expect(startErrors).toHaveLength(0);
    });
  });

  describe("terminalNodeRule", () => {
    it("errors when no exit node", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          a [shape=box]
          s -> a
        }
      `);
      const diags = validate(graph);
      const exitErrors = diags.filter(d => d.rule === "terminal_node" && d.severity === "error");
      expect(exitErrors.length).toBeGreaterThan(0);
    });
  });

  describe("startNoIncomingRule", () => {
    it("errors when start node has incoming edges", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          s -> a -> e
          a -> s
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "start_no_incoming" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
    });
  });

  describe("exitNoOutgoingRule", () => {
    it("errors when exit node has outgoing edges", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          s -> a -> e
          e -> a
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "exit_no_outgoing" && d.severity === "error");
      expect(rule.length).toBeGreaterThan(0);
    });
  });

  describe("reachabilityRule", () => {
    it("errors on unreachable nodes", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          orphan [shape=box, label="Orphan"]
          s -> e
        }
      `);
      const diags = validate(graph);
      const reach = diags.filter(d => d.rule === "reachability" && d.severity === "error");
      expect(reach.length).toBeGreaterThan(0);
      expect(reach[0].nodeId).toBe("orphan");
    });

    it("passes when all nodes reachable", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          a [shape=box]
          e [shape=Msquare]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const reach = diags.filter(d => d.rule === "reachability");
      expect(reach).toHaveLength(0);
    });
  });

  describe("edgeTargetExistsRule", () => {
    // Hard to trigger with the parser since it creates implicit nodes.
    // This rule protects against programmatic graph construction.
    it("catches edges to nonexistent nodes in manually constructed graphs", () => {
      // Construct a graph manually with a bad edge
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          s -> e
        }
      `);
      // Add a bad edge manually
      graph.edges.push({ from: "s", to: "nonexistent", label: "", condition: "", weight: 0, fidelity: "", threadId: "", loopRestart: false });
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "edge_target_exists");
      expect(rule.length).toBeGreaterThan(0);
    });
  });

  describe("typeKnownRule", () => {
    it("warns on unknown type", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [type="unknown_type"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "type_known" && d.severity === "warning");
      expect(rule.length).toBeGreaterThan(0);
    });

    it("does not warn on known types", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [type="wait.human"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "type_known");
      expect(rule).toHaveLength(0);
    });
  });

  describe("fidelityValidRule", () => {
    it("warns on invalid fidelity mode", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [fidelity="invalid"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "fidelity_valid");
      expect(rule.length).toBeGreaterThan(0);
    });
  });

  describe("goalGateHasRetryRule", () => {
    it("warns when goal gate node has no retry target", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [goal_gate=true]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "goal_gate_has_retry" && d.severity === "warning");
      expect(rule.length).toBeGreaterThan(0);
    });

    it("does not warn when graph has retry_target", () => {
      const graph = parse(`
        digraph G {
          graph [retry_target="a"]
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [goal_gate=true]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "goal_gate_has_retry");
      expect(rule).toHaveLength(0);
    });
  });

  describe("promptOnLlmNodesRule", () => {
    it("warns when a box node has no prompt or label", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const rule = diags.filter(d => d.rule === "prompt_on_llm_nodes");
      // "a" has label defaulting to "a" (the node ID), which is non-empty.
      // This should NOT warn — the label default is the ID.
      expect(rule).toHaveLength(0);
    });
  });

  describe("validateOrThrow", () => {
    it("throws on error-severity diagnostics", () => {
      const graph = parse(`
        digraph G {
          a [shape=box]
          b [shape=box]
          a -> b
        }
      `);
      // No start or exit node
      expect(() => validateOrThrow(graph)).toThrow(/Validation failed/);
    });

    it("returns warnings without throwing", () => {
      const graph = parse(`
        digraph G {
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [type="weird"]
          s -> a -> e
        }
      `);
      const warnings = validateOrThrow(graph);
      expect(warnings.some(d => d.severity === "warning")).toBe(true);
    });
  });

  describe("valid pipelines pass cleanly", () => {
    it("three-node linear pipeline has no errors", () => {
      const graph = parse(`
        digraph G {
          graph [goal="Test"]
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box, prompt="Do something"]
          s -> a -> e
        }
      `);
      const diags = validate(graph);
      const errors = diags.filter(d => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("branching pipeline with conditions has no errors", () => {
      const graph = parse(`
        digraph G {
          graph [goal="Test"]
          s [shape=Mdiamond]
          e [shape=Msquare]
          a [shape=box, prompt="Do A"]
          b [shape=box, prompt="Do B"]
          gate [shape=diamond]
          s -> a -> gate
          gate -> b [condition="outcome=success"]
          gate -> a [condition="outcome=fail"]
          b -> e
        }
      `);
      const diags = validate(graph);
      const errors = diags.filter(d => d.severity === "error");
      expect(errors).toHaveLength(0);
    });
  });
});
```

---

## Completion Criteria

- [ ] All 13 built-in rules implemented
- [ ] `validate()` returns correct diagnostics for each rule
- [ ] `validateOrThrow()` throws on errors, returns warnings
- [ ] Valid pipelines produce zero error-severity diagnostics
- [ ] Each error rule has at least one test that triggers it
- [ ] Each warning rule has at least one test that triggers it
- [ ] All Phase 1 tests still pass
- [ ] All tests pass: `npx vitest run test/validation/`
