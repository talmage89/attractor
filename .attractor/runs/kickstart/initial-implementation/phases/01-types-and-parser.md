# Phase 1: Types + DOT Parser

## Scope

All foundational types and a complete DOT parser. After this phase, you can
read any valid Attractor DOT file and produce an in-memory `Graph`.

### Files to Create

```
src/
  model/
    graph.ts          # Graph, GraphNode, Edge, GraphAttributes
    outcome.ts        # Outcome, StageStatus
    events.ts         # PipelineEvent union type (types only, no emitter logic)
    fidelity.ts       # FidelityMode type literal
    context.ts        # Context class (no dependencies, needed by Phase 3+)
  parser/
    tokens.ts         # TokenKind, Token
    lexer.ts          # lex(source) → Token[]
    parser.ts         # parse(source) → Graph

test/
  parser/
    lexer.test.ts
    parser.test.ts
    fixtures.ts       # Shared DOT strings for tests
  model/
    context.test.ts
```

### Dependencies

None. This is the foundation.

---

## Implementation Notes

### model/graph.ts

Define all types as interfaces (not classes) for the graph model. The `Graph`
uses a `Map<string, GraphNode>` for nodes keyed by ID.

```typescript
interface Graph {
  name: string;
  attributes: GraphAttributes;
  nodes: Map<string, GraphNode>;
  edges: Edge[];
}

interface GraphAttributes {
  goal: string;                    // default: ""
  label: string;                   // default: ""
  modelStylesheet: string;         // default: ""
  defaultMaxRetry: number;         // default: 50
  retryTarget: string;             // default: ""
  fallbackRetryTarget: string;     // default: ""
  defaultFidelity: string;         // default: ""
  raw: Map<string, string>;
}

interface GraphNode {
  id: string;
  label: string;                   // default: node ID
  shape: string;                   // default: "box"
  type: string;                    // default: ""
  prompt: string;                  // default: ""
  maxRetries: number;              // default: 0
  goalGate: boolean;               // default: false
  retryTarget: string;             // default: ""
  fallbackRetryTarget: string;     // default: ""
  fidelity: string;                // default: ""
  threadId: string;                // default: ""
  className: string;               // default: ""
  timeout: number | null;          // default: null
  llmModel: string;                // default: ""
  llmProvider: string;             // default: ""
  reasoningEffort: string;         // default: "high"
  autoStatus: boolean;             // default: false
  allowPartial: boolean;           // default: false
  raw: Map<string, string>;
}

interface Edge {
  from: string;
  to: string;
  label: string;                   // default: ""
  condition: string;               // default: ""
  weight: number;                  // default: 0
  fidelity: string;                // default: ""
  threadId: string;                // default: ""
  loopRestart: boolean;            // default: false
}
```

Also export query helper functions:

```typescript
function outgoingEdges(graph: Graph, nodeId: string): Edge[]
function incomingEdges(graph: Graph, nodeId: string): Edge[]
function findStartNode(graph: Graph): GraphNode | null
function findExitNode(graph: Graph): GraphNode | null
function isTerminal(node: GraphNode): boolean
function reachableFrom(graph: Graph, nodeId: string): Set<string>
```

`reachableFrom`: BFS/DFS from the given node, returning a `Set<string>` of all
reachable node IDs (not including the start node itself unless it's reachable
via a cycle). Phase 2's `reachabilityRule` uses this instead of inline BFS.

`findStartNode`: returns the node with `shape === "Mdiamond"`. If none,
check for `id === "start"` or `id === "Start"`. Return null if neither found.

`findExitNode`: returns the node with `shape === "Msquare"`. If none,
check for `id === "exit"` or `id === "end"`. Return null if neither found.

`isTerminal`: `shape === "Msquare"` or `type === "exit"`.

### model/context.ts

Context is placed in Phase 1 because it has no dependencies and is needed by
Phase 3's condition evaluator tests.

```typescript
class Context {
  private values = new Map<string, unknown>();

  set(key: string, value: unknown): void
  get(key: string): unknown | undefined
  getString(key: string, defaultValue?: string): string
  has(key: string): boolean
  keys(): string[]
  snapshot(): Record<string, unknown>
  clone(): Context
  applyUpdates(updates: Record<string, unknown>): void
}
```

No locking needed. Single-threaded execution. The `clone()` method creates
a deep-enough copy for parallel branch isolation (shallow copy of the Map;
values are strings/numbers/booleans so shallow is sufficient).

> **Divergence note:** `has()` and `keys()` are convenience additions not in the
> source spec. The source spec's `append_log(entry)` is deferred — no phase
> implements it. If any source spec behavior depends on `append_log`, it will
> need to be added later.

### model/outcome.ts

```typescript
type StageStatus = "success" | "partial_success" | "retry" | "fail" | "skipped";

interface Outcome {
  status: StageStatus;
  preferredLabel?: string;
  suggestedNextIds?: string[];
  contextUpdates?: Record<string, unknown>;
  notes?: string;
  failureReason?: string;
}
```

### model/events.ts

Define the `PipelineEvent` discriminated union type from SPEC.md Section 16.
Types only — no emission logic in this phase.

### model/fidelity.ts

```typescript
type FidelityMode =
  | "full" | "truncate" | "compact"
  | "summary:low" | "summary:medium" | "summary:high";
```

### parser/tokens.ts

```typescript
type TokenKind =
  | "DIGRAPH" | "GRAPH" | "NODE" | "EDGE" | "SUBGRAPH"
  | "TRUE" | "FALSE"
  | "IDENTIFIER" | "STRING" | "INTEGER" | "FLOAT" | "DURATION"
  | "LBRACE" | "RBRACE" | "LBRACKET" | "RBRACKET"
  | "EQUALS" | "COMMA" | "SEMICOLON" | "ARROW"
  | "EOF";

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
}
```

### parser/lexer.ts

Export: `function lex(source: string): Token[]`

**Algorithm:**

1. Strip comments: replace `//...\n` and `/*...*/` with equivalent whitespace
   (preserve line numbers).
2. Scan left-to-right, skipping whitespace.
3. Match tokens in this priority order:
   - `->` → ARROW
   - `{` `}` `[` `]` `=` `,` `;` → single-char symbols
   - `"..."` → STRING (handle escape sequences: `\"`, `\\`, `\n`, `\t`)
   - Numeric: optional `-`, digits, optional `.` + digits, optional duration
     suffix (`ms`, `s`, `m`, `h`, `d`). Produce INTEGER, FLOAT, or DURATION.
   - Identifier/keyword: `[A-Za-z_][A-Za-z0-9_.]*`. Check against keyword map.

> **Simplification:** The source spec BNF treats dots as separators in
> `QualifiedId`, not part of `Identifier`. We allow dots in identifiers at
> the lexer level because node IDs never contain dots in practice, and
> qualified keys (like `human.default_choice`) always appear in attribute
> contexts. This avoids needing a separate `QualifiedId` parser production
> and is functionally equivalent.

On unrecognized character, throw: `Unexpected character '${char}' at line ${line}, column ${col}`.

**Edge case — duration vs identifier after integer:** `900s` is a DURATION.
`900` followed by whitespace or a symbol is an INTEGER. The `s` is consumed
greedily as part of the number token only if it matches a valid duration suffix.

### parser/parser.ts

Export: `function parse(source: string): Graph`

**Algorithm overview:**

1. `lex(source)` → tokens
2. Maintain a cursor into the token array.
3. Expect DIGRAPH → IDENTIFIER → LBRACE
4. Parse statements until RBRACE
5. Return constructed Graph

**Parser state:**
- `nodeDefaults: Map<string, string>` — current node default attributes
- `edgeDefaults: Map<string, string>` — current edge default attributes
- `defaultStack: { nodeDefaults, edgeDefaults }[]` — pushed/popped on subgraph
- `subgraphClassStack: string[]` — derived class names from enclosing subgraphs

**Statement dispatch** (peek at current token):
- GRAPH → parse graph attribute block
- NODE → parse node defaults block
- EDGE → parse edge defaults block
- SUBGRAPH → push defaults, parse inner statements, pop
- IDENTIFIER → could be a node statement or an edge chain.
  Look ahead: if `ARROW` follows any identifier in the chain, it's an edge.
  Otherwise it's a node. If next is `EQUALS`, it's a top-level graph attribute.

**Parsing node statements:**

```
IDENTIFIER LBRACKET? → extract attrs → merge with nodeDefaults → create GraphNode
```

If the node has no `label`, default label to the node ID.
If inside a subgraph with a derived class, append it to the node's `className`.

**Parsing edge chains:**

```
IDENTIFIER (ARROW IDENTIFIER)+ LBRACKET? → extract attrs → for each pair, create Edge
```

Edge attributes from the `[...]` block apply to ALL edges in the chain.
Merge with edgeDefaults.

**Parsing attribute blocks:**

```
LBRACKET (key EQUALS value COMMA?)* RBRACKET
```

Keys can be qualified: `human.default_choice` is a single key string "human.default_choice".

**Duration conversion for `timeout`:** When assigning `timeout` to a GraphNode,
convert duration strings to milliseconds: `ms`=1, `s`=1000, `m`=60000,
`h`=3600000, `d`=86400000. Duration strings may appear as bare duration tokens
(`900s`) or quoted strings (`"900s"`). Both must be converted to milliseconds
when assigned to `timeout`.
Values are typed by token kind:
- STRING → strip quotes, process escapes
- INTEGER → string representation
- FLOAT → string representation
- DURATION → string representation (e.g., "900s")
- TRUE/FALSE → "true"/"false"
- IDENTIFIER → string value (for unquoted values like `box`, `Mdiamond`)

Commas between attributes are required by the spec but the parser should be
tolerant: accept missing commas between attributes (common DOT style).

**Implicit node creation:** After all statements are parsed, scan all edges.
If an edge references a node ID not in `graph.nodes`, create a default node
for that ID.

**Subgraph class derivation:** If a subgraph has `label = "Loop A"`, derive
class `loop-a` (lowercase, spaces→hyphens, strip non-alphanumeric except hyphens).

---

## Test Fixtures

### test/parser/fixtures.ts

```typescript
export const MINIMAL_LINEAR = `
digraph Simple {
  start [shape=Mdiamond]
  exit  [shape=Msquare]
  start -> exit
}
`;

export const THREE_NODE_LINEAR = `
digraph Pipeline {
  graph [goal="Run tests"]
  rankdir=LR

  start [shape=Mdiamond, label="Start"]
  exit  [shape=Msquare, label="Exit"]
  run_tests [label="Run Tests", prompt="Run the test suite"]

  start -> run_tests -> exit
}
`;

export const BRANCHING = `
digraph Branch {
  graph [goal="Implement feature"]
  node [shape=box, timeout="900s"]

  start     [shape=Mdiamond]
  exit      [shape=Msquare]
  plan      [label="Plan", prompt="Plan the implementation"]
  implement [label="Implement", prompt="Write code"]
  gate      [shape=diamond, label="Tests passing?"]

  start -> plan -> implement -> gate
  gate -> exit      [label="Yes", condition="outcome=success"]
  gate -> implement [label="No", condition="outcome!=success"]
}
`;

export const WITH_HUMAN_GATE = `
digraph Review {
  rankdir=LR
  start [shape=Mdiamond]
  exit  [shape=Msquare]

  review_gate [shape=hexagon, label="Review Changes"]

  start -> review_gate
  review_gate -> ship_it [label="[A] Approve"]
  review_gate -> fixes   [label="[F] Fix"]
  ship_it -> exit
  fixes -> review_gate
}
`;

export const WITH_ATTRIBUTES = `
digraph Full {
  graph [
    goal="Full attribute test",
    label="Test Pipeline",
    default_max_retry=3,
    model_stylesheet="* { llm_model: claude-sonnet-4-5; }"
  ]

  start [shape=Mdiamond]
  exit  [shape=Msquare]

  plan [
    label="Plan",
    shape=box,
    prompt="Plan for: $goal",
    max_retries=2,
    goal_gate=true,
    timeout="15m",
    reasoning_effort="high",
    class="planning,critical"
  ]

  start -> plan -> exit
}
`;

export const WITH_SUBGRAPH = `
digraph Sub {
  start [shape=Mdiamond]
  exit  [shape=Msquare]

  subgraph cluster_loop {
    label = "Main Loop"
    node [thread_id="main-loop", timeout="900s"]

    plan      [label="Plan"]
    implement [label="Implement", timeout="1800s"]
  }

  start -> plan -> implement -> exit
}
`;

export const WITH_COMMENTS = `
// This is a comment
digraph Commented {
  /* Block comment
     spanning lines */
  start [shape=Mdiamond] // inline comment
  exit  [shape=Msquare]
  start -> exit
}
`;

export const PARALLEL = `
digraph Par {
  start [shape=Mdiamond]
  exit  [shape=Msquare]

  fan_out  [shape=component, label="Fan Out"]
  fan_in   [shape=tripleoctagon, label="Fan In"]
  branch_a [label="Branch A", prompt="Do A"]
  branch_b [label="Branch B", prompt="Do B"]

  start -> fan_out
  fan_out -> branch_a
  fan_out -> branch_b
  branch_a -> fan_in
  branch_b -> fan_in
  fan_in -> exit
}
`;

export const EDGE_WEIGHTS = `
digraph Weights {
  start [shape=Mdiamond]
  exit  [shape=Msquare]
  node_a [label="A"]
  node_b [label="B"]
  node_c [label="C"]

  start -> node_a
  node_a -> node_b [weight=10]
  node_a -> node_c [weight=5]
  node_b -> exit
  node_c -> exit
}
`;

// --- Invalid DOT for error testing ---

export const INVALID_UNDIRECTED = `
graph Undirected {
  a -- b
}
`;

export const INVALID_NO_DIGRAPH = `
a -> b
`;

export const INVALID_UNCLOSED_STRING = `
digraph Bad {
  a [label="unclosed]
}
`;
```

### test/parser/lexer.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { lex } from "../../src/parser/lexer";

describe("lexer", () => {
  it("tokenizes a minimal digraph", () => {
    const tokens = lex(`digraph G { }`);
    expect(tokens.map(t => t.kind)).toEqual([
      "DIGRAPH", "IDENTIFIER", "LBRACE", "RBRACE", "EOF"
    ]);
    expect(tokens[1].value).toBe("G");
  });

  it("tokenizes the arrow operator", () => {
    const tokens = lex(`a -> b`);
    expect(tokens.map(t => t.kind)).toEqual([
      "IDENTIFIER", "ARROW", "IDENTIFIER", "EOF"
    ]);
  });

  it("tokenizes quoted strings with escapes", () => {
    const tokens = lex(`"hello \\"world\\""`);
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe(`hello "world"`);
  });

  it("tokenizes integers", () => {
    const tokens = lex(`42 -1 0`);
    expect(tokens.map(t => [t.kind, t.value])).toEqual([
      ["INTEGER", "42"],
      ["INTEGER", "-1"],
      ["INTEGER", "0"],
      ["EOF", ""],
    ]);
  });

  it("tokenizes floats", () => {
    const tokens = lex(`0.5 -3.14`);
    expect(tokens.map(t => [t.kind, t.value])).toEqual([
      ["FLOAT", "0.5"],
      ["FLOAT", "-3.14"],
      ["EOF", ""],
    ]);
  });

  it("tokenizes duration literals", () => {
    const tokens = lex(`900s 15m 2h 250ms 1d`);
    expect(tokens.filter(t => t.kind === "DURATION").map(t => t.value)).toEqual([
      "900s", "15m", "2h", "250ms", "1d"
    ]);
  });

  it("tokenizes boolean keywords", () => {
    const tokens = lex(`true false`);
    expect(tokens.map(t => t.kind)).toEqual(["TRUE", "FALSE", "EOF"]);
  });

  it("tokenizes all bracket types", () => {
    const tokens = lex(`{ } [ ]`);
    expect(tokens.map(t => t.kind)).toEqual([
      "LBRACE", "RBRACE", "LBRACKET", "RBRACKET", "EOF"
    ]);
  });

  it("recognizes keywords", () => {
    const tokens = lex(`digraph graph node edge subgraph`);
    expect(tokens.map(t => t.kind)).toEqual([
      "DIGRAPH", "GRAPH", "NODE", "EDGE", "SUBGRAPH", "EOF"
    ]);
  });

  it("strips line comments", () => {
    const tokens = lex(`a // comment\nb`);
    expect(tokens.map(t => t.kind)).toEqual([
      "IDENTIFIER", "IDENTIFIER", "EOF"
    ]);
  });

  it("strips block comments", () => {
    const tokens = lex(`a /* block */ b`);
    expect(tokens.map(t => t.kind)).toEqual([
      "IDENTIFIER", "IDENTIFIER", "EOF"
    ]);
  });

  it("tracks line and column numbers", () => {
    const tokens = lex(`digraph G {\n  a\n}`);
    const aToken = tokens.find(t => t.value === "a");
    expect(aToken?.line).toBe(2);
    expect(aToken?.column).toBe(3);
  });

  it("throws on unexpected character", () => {
    expect(() => lex(`digraph G { @ }`)).toThrow(/Unexpected character '@'/);
  });

  it("throws on unclosed string", () => {
    expect(() => lex(`"unclosed`)).toThrow(/Unterminated string/);
  });

  it("handles comma and semicolon", () => {
    const tokens = lex(`a = 1, b = 2;`);
    expect(tokens.filter(t => t.kind === "COMMA")).toHaveLength(1);
    expect(tokens.filter(t => t.kind === "SEMICOLON")).toHaveLength(1);
  });

  it("handles qualified identifiers as separate tokens", () => {
    // "human.default_choice" — the lexer produces IDENTIFIER tokens
    // and the parser handles dotted keys. The lexer just sees identifiers
    // separated by dots (which aren't a token — they're part of identifiers
    // if we allow dots in identifiers, OR we treat them as separate).
    //
    // Decision: the lexer treats dots in identifiers as part of the
    // identifier. human.default_choice is one IDENTIFIER token.
    const tokens = lex(`human.default_choice`);
    expect(tokens[0].kind).toBe("IDENTIFIER");
    expect(tokens[0].value).toBe("human.default_choice");
  });

  it("handles negative numbers before identifiers", () => {
    const tokens = lex(`-1 abc`);
    expect(tokens[0]).toMatchObject({ kind: "INTEGER", value: "-1" });
    expect(tokens[1]).toMatchObject({ kind: "IDENTIFIER", value: "abc" });
  });
});
```

### test/parser/parser.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { parse } from "../../src/parser/parser";
import * as fixtures from "./fixtures";

describe("parser", () => {
  describe("minimal graphs", () => {
    it("parses a minimal linear pipeline", () => {
      const graph = parse(fixtures.MINIMAL_LINEAR);
      expect(graph.name).toBe("Simple");
      expect(graph.nodes.size).toBe(2);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ from: "start", to: "exit" });
    });

    it("resolves start and exit nodes", () => {
      const graph = parse(fixtures.MINIMAL_LINEAR);
      const start = graph.nodes.get("start");
      const exit = graph.nodes.get("exit");
      expect(start?.shape).toBe("Mdiamond");
      expect(exit?.shape).toBe("Msquare");
    });
  });

  describe("three-node linear", () => {
    it("parses graph-level attributes", () => {
      const graph = parse(fixtures.THREE_NODE_LINEAR);
      expect(graph.attributes.goal).toBe("Run tests");
    });

    it("expands chained edges", () => {
      const graph = parse(fixtures.THREE_NODE_LINEAR);
      // start -> run_tests -> exit becomes two edges
      expect(graph.edges).toHaveLength(2);
      expect(graph.edges[0]).toMatchObject({ from: "start", to: "run_tests" });
      expect(graph.edges[1]).toMatchObject({ from: "run_tests", to: "exit" });
    });

    it("parses node labels and prompts", () => {
      const graph = parse(fixtures.THREE_NODE_LINEAR);
      const runTests = graph.nodes.get("run_tests");
      expect(runTests?.label).toBe("Run Tests");
      expect(runTests?.prompt).toBe("Run the test suite");
    });

    it("handles top-level key=value graph attributes", () => {
      const graph = parse(fixtures.THREE_NODE_LINEAR);
      // rankdir=LR is a graph attribute
      expect(graph.attributes.raw.get("rankdir")).toBe("LR");
    });
  });

  describe("branching", () => {
    it("parses node defaults", () => {
      const graph = parse(fixtures.BRANCHING);
      // node [shape=box, timeout="900s"] applies to plan, implement
      const plan = graph.nodes.get("plan");
      expect(plan?.shape).toBe("box");
      expect(plan?.timeout).toBe(900000); // 900s in ms
    });

    it("parses edge conditions", () => {
      const graph = parse(fixtures.BRANCHING);
      const yesEdge = graph.edges.find(e => e.label === "Yes");
      expect(yesEdge?.condition).toBe("outcome=success");
    });

    it("parses conditional node shape", () => {
      const graph = parse(fixtures.BRANCHING);
      const gate = graph.nodes.get("gate");
      expect(gate?.shape).toBe("diamond");
    });
  });

  describe("human gate", () => {
    it("creates implicit nodes from edges", () => {
      const graph = parse(fixtures.WITH_HUMAN_GATE);
      // ship_it and fixes are referenced in edges but not explicitly declared
      expect(graph.nodes.has("ship_it")).toBe(true);
      expect(graph.nodes.has("fixes")).toBe(true);
    });

    it("parses hexagon shape", () => {
      const graph = parse(fixtures.WITH_HUMAN_GATE);
      expect(graph.nodes.get("review_gate")?.shape).toBe("hexagon");
    });
  });

  describe("full attributes", () => {
    it("parses multi-line attribute blocks", () => {
      const graph = parse(fixtures.WITH_ATTRIBUTES);
      const plan = graph.nodes.get("plan");
      expect(plan?.maxRetries).toBe(2);
      expect(plan?.goalGate).toBe(true);
      expect(plan?.timeout).toBe(900000); // 15m in ms
      expect(plan?.reasoningEffort).toBe("high");
      expect(plan?.className).toBe("planning,critical");
    });

    it("parses graph-level model stylesheet", () => {
      const graph = parse(fixtures.WITH_ATTRIBUTES);
      expect(graph.attributes.modelStylesheet).toBe(
        "* { llm_model: claude-sonnet-4-5; }"
      );
    });

    it("parses default_max_retry as number", () => {
      const graph = parse(fixtures.WITH_ATTRIBUTES);
      expect(graph.attributes.defaultMaxRetry).toBe(3);
    });
  });

  describe("subgraphs", () => {
    it("applies subgraph node defaults", () => {
      const graph = parse(fixtures.WITH_SUBGRAPH);
      const plan = graph.nodes.get("plan");
      expect(plan?.threadId).toBe("main-loop");
      expect(plan?.timeout).toBe(900000);
    });

    it("allows explicit node attrs to override subgraph defaults", () => {
      const graph = parse(fixtures.WITH_SUBGRAPH);
      const implement = graph.nodes.get("implement");
      expect(implement?.threadId).toBe("main-loop");   // inherited
      expect(implement?.timeout).toBe(1800000);         // overridden (1800s)
    });

    it("derives class names from subgraph labels", () => {
      const graph = parse(fixtures.WITH_SUBGRAPH);
      const plan = graph.nodes.get("plan");
      // label "Main Loop" → class "main-loop"
      expect(plan?.className).toContain("main-loop");
    });
  });

  describe("comments", () => {
    it("strips all comment types", () => {
      const graph = parse(fixtures.WITH_COMMENTS);
      expect(graph.name).toBe("Commented");
      expect(graph.nodes.size).toBe(2);
      expect(graph.edges).toHaveLength(1);
    });
  });

  describe("parallel", () => {
    it("parses component and tripleoctagon shapes", () => {
      const graph = parse(fixtures.PARALLEL);
      expect(graph.nodes.get("fan_out")?.shape).toBe("component");
      expect(graph.nodes.get("fan_in")?.shape).toBe("tripleoctagon");
    });

    it("produces correct edge structure for fan-out", () => {
      const graph = parse(fixtures.PARALLEL);
      const fanOutEdges = graph.edges.filter(e => e.from === "fan_out");
      expect(fanOutEdges).toHaveLength(2);
      expect(fanOutEdges.map(e => e.to).sort()).toEqual(["branch_a", "branch_b"]);
    });
  });

  describe("edge weights", () => {
    it("parses weight as number", () => {
      const graph = parse(fixtures.EDGE_WEIGHTS);
      const toB = graph.edges.find(e => e.from === "node_a" && e.to === "node_b");
      const toC = graph.edges.find(e => e.from === "node_a" && e.to === "node_c");
      expect(toB?.weight).toBe(10);
      expect(toC?.weight).toBe(5);
    });
  });

  describe("graph query helpers", () => {
    it("outgoingEdges returns correct edges", async () => {
      const { outgoingEdges } = await import("../../src/model/graph");
      const graph = parse(fixtures.BRANCHING);
      const gateEdges = outgoingEdges(graph, "gate");
      expect(gateEdges).toHaveLength(2);
    });

    it("findStartNode finds Mdiamond", async () => {
      const { findStartNode } = await import("../../src/model/graph");
      const graph = parse(fixtures.MINIMAL_LINEAR);
      expect(findStartNode(graph)?.id).toBe("start");
    });

    it("findExitNode finds Msquare", async () => {
      const { findExitNode } = await import("../../src/model/graph");
      const graph = parse(fixtures.MINIMAL_LINEAR);
      expect(findExitNode(graph)?.id).toBe("exit");
    });

    it("isTerminal identifies exit nodes", async () => {
      const { isTerminal } = await import("../../src/model/graph");
      const graph = parse(fixtures.MINIMAL_LINEAR);
      expect(isTerminal(graph.nodes.get("exit")!)).toBe(true);
      expect(isTerminal(graph.nodes.get("start")!)).toBe(false);
    });

    it("reachableFrom returns all reachable nodes", async () => {
      const { reachableFrom } = await import("../../src/model/graph");
      const graph = parse(fixtures.BRANCHING);
      const reachable = reachableFrom(graph, "start");
      expect(reachable.has("plan")).toBe(true);
      expect(reachable.has("implement")).toBe(true);
      expect(reachable.has("gate")).toBe(true);
      expect(reachable.has("exit")).toBe(true);
    });
  });

  describe("error handling", () => {
    it("rejects undirected graphs", () => {
      expect(() => parse(fixtures.INVALID_UNDIRECTED)).toThrow(/digraph/i);
    });

    it("rejects missing digraph keyword", () => {
      expect(() => parse(fixtures.INVALID_NO_DIGRAPH)).toThrow();
    });

    it("rejects unclosed strings", () => {
      expect(() => parse(fixtures.INVALID_UNCLOSED_STRING)).toThrow(/string/i);
    });
  });

  describe("duration parsing", () => {
    it("converts duration strings to milliseconds for timeout", () => {
      const graph = parse(`
        digraph D {
          start [shape=Mdiamond]
          exit  [shape=Msquare]
          a [timeout="250ms"]
          b [timeout="10s"]
          c [timeout="5m"]
          d [timeout="2h"]
          e [timeout="1d"]
          start -> a -> b -> c -> d -> e -> exit
        }
      `);
      expect(graph.nodes.get("a")?.timeout).toBe(250);
      expect(graph.nodes.get("b")?.timeout).toBe(10000);
      expect(graph.nodes.get("c")?.timeout).toBe(300000);
      expect(graph.nodes.get("d")?.timeout).toBe(7200000);
      expect(graph.nodes.get("e")?.timeout).toBe(86400000);
    });
  });
});
```

---

### test/model/context.test.ts

```typescript
import { describe, it, expect } from "vitest";
import { Context } from "../../src/model/context";

describe("Context", () => {
  it("set and get", () => {
    const ctx = new Context();
    ctx.set("key", "value");
    expect(ctx.get("key")).toBe("value");
  });

  it("get returns undefined for missing key", () => {
    const ctx = new Context();
    expect(ctx.get("missing")).toBeUndefined();
  });

  it("getString returns default for missing key", () => {
    const ctx = new Context();
    expect(ctx.getString("missing", "default")).toBe("default");
  });

  it("getString returns empty string by default", () => {
    const ctx = new Context();
    expect(ctx.getString("missing")).toBe("");
  });

  it("getString coerces non-string values", () => {
    const ctx = new Context();
    ctx.set("num", 42);
    expect(ctx.getString("num")).toBe("42");
  });

  it("has checks existence", () => {
    const ctx = new Context();
    ctx.set("key", "value");
    expect(ctx.has("key")).toBe(true);
    expect(ctx.has("other")).toBe(false);
  });

  it("keys returns all keys", () => {
    const ctx = new Context();
    ctx.set("a", 1);
    ctx.set("b", 2);
    expect(ctx.keys().sort()).toEqual(["a", "b"]);
  });

  it("snapshot returns a plain object copy", () => {
    const ctx = new Context();
    ctx.set("a", 1);
    ctx.set("b", "two");
    const snap = ctx.snapshot();
    expect(snap).toEqual({ a: 1, b: "two" });
    snap.a = 999;
    expect(ctx.get("a")).toBe(1);
  });

  it("clone produces an independent copy", () => {
    const ctx = new Context();
    ctx.set("x", "original");
    const cloned = ctx.clone();
    cloned.set("x", "modified");
    cloned.set("y", "new");
    expect(ctx.get("x")).toBe("original");
    expect(ctx.has("y")).toBe(false);
  });

  it("applyUpdates merges key-value pairs", () => {
    const ctx = new Context();
    ctx.set("existing", "keep");
    ctx.applyUpdates({ new_key: "added", existing: "overwritten" });
    expect(ctx.get("new_key")).toBe("added");
    expect(ctx.get("existing")).toBe("overwritten");
  });
});
```

---

## Completion Criteria

- [ ] `lex()` tokenizes all fixtures without error
- [ ] `parse()` produces correct `Graph` for all valid fixtures
- [ ] `parse()` throws descriptive errors for all invalid fixtures
- [ ] Graph query helpers (`outgoingEdges`, `findStartNode`, etc.) work correctly
- [ ] All node attribute types are parsed: strings, integers, booleans, durations
- [ ] Chained edges expand correctly
- [ ] Subgraph defaults and class derivation work
- [ ] Comments are stripped
- [ ] Implicit nodes are created from edge references
- [ ] Duration strings are converted to milliseconds (both bare `900s` and quoted `"900s"`)
- [ ] `reachableFrom()` returns all nodes reachable via BFS from a given node
- [ ] Context: set/get/getString/has/keys/snapshot/clone/applyUpdates all work
- [ ] Context clone is independent (mutations don't propagate)
- [ ] All tests pass: `npx vitest run test/parser/ test/model/`
