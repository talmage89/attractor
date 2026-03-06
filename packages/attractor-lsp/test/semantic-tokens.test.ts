import { describe, it, expect } from "vitest";
import { computeSemanticTokens, TOKEN_LEGEND } from "../src/semantic-tokens.js";

// ─── Legend indices ───────────────────────────────────────────────────────────

const T = {
  keyword:   TOKEN_LEGEND.tokenTypes.indexOf("keyword"),
  namespace: TOKEN_LEGEND.tokenTypes.indexOf("namespace"),
  class:     TOKEN_LEGEND.tokenTypes.indexOf("class"),
  operator:  TOKEN_LEGEND.tokenTypes.indexOf("operator"),
  property:  TOKEN_LEGEND.tokenTypes.indexOf("property"),
  string:    TOKEN_LEGEND.tokenTypes.indexOf("string"),
  number:    TOKEN_LEGEND.tokenTypes.indexOf("number"),
} as const;

const M = {
  declaration: 1 << TOKEN_LEGEND.tokenModifiers.indexOf("declaration"),
  static:      1 << TOKEN_LEGEND.tokenModifiers.indexOf("static"),
  abstract:    1 << TOKEN_LEGEND.tokenModifiers.indexOf("abstract"),
  readonly:    1 << TOKEN_LEGEND.tokenModifiers.indexOf("readonly"),
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract the Nth semantic token (0-indexed) from encoded data. */
function token(data: number[], n: number) {
  const base = n * 5;
  return {
    deltaLine:  data[base],
    deltaCol:   data[base + 1],
    length:     data[base + 2],
    type:       data[base + 3],
    modifiers:  data[base + 4],
  };
}

/** Number of tokens in encoded data. */
function count(data: number[]): number {
  return data.length / 5;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeSemanticTokens", () => {
  describe("minimal DAG", () => {
    it("produces tokens for digraph G { a -> b }", () => {
      const data = computeSemanticTokens("digraph G { a -> b }");
      expect(count(data)).toBe(5);

      // Token 0: "digraph" at col 1 → 0-based (0,0), len 7, keyword + declaration
      expect(token(data, 0)).toEqual({ deltaLine: 0, deltaCol: 0, length: 7, type: T.keyword, modifiers: M.declaration });
      // Token 1: "G" at col 9 → 0-based (0,8), delta from (0,0) = (0,8), len 1, namespace + declaration
      expect(token(data, 1)).toEqual({ deltaLine: 0, deltaCol: 8, length: 1, type: T.namespace, modifiers: M.declaration });
      // Token 2: "a" at col 13 → 0-based (0,12), delta from (0,8) = (0,4), len 1, class (edge ref, no declaration)
      expect(token(data, 2)).toEqual({ deltaLine: 0, deltaCol: 4, length: 1, type: T.class, modifiers: 0 });
      // Token 3: "->" at col 15 → 0-based (0,14), delta from (0,12) = (0,2), len 2, operator
      expect(token(data, 3)).toEqual({ deltaLine: 0, deltaCol: 2, length: 2, type: T.operator, modifiers: 0 });
      // Token 4: "b" at col 18 → 0-based (0,17), delta from (0,14) = (0,3), len 1, class
      expect(token(data, 4)).toEqual({ deltaLine: 0, deltaCol: 3, length: 1, type: T.class, modifiers: 0 });
    });

    it("handles anonymous digraph (no name)", () => {
      const data = computeSemanticTokens("digraph { a -> b }");
      expect(count(data)).toBe(4);
      // Token 0: digraph keyword
      expect(token(data, 0)).toMatchObject({ type: T.keyword, modifiers: M.declaration, length: 7 });
      // Token 1: "a" — class, no modifier
      expect(token(data, 1)).toMatchObject({ type: T.class, modifiers: 0 });
      // Token 2: "->" — operator
      expect(token(data, 2)).toMatchObject({ type: T.operator });
      // Token 3: "b" — class, no modifier
      expect(token(data, 3)).toMatchObject({ type: T.class, modifiers: 0 });
    });
  });

  describe("node declarations vs edge references", () => {
    it("node declaration gets class + declaration modifier", () => {
      const data = computeSemanticTokens("digraph G { nodeA [shape = box] }");
      // Tokens: digraph(kw+decl), G(ns+decl), nodeA(class+decl), shape(prop+0), box(string)
      expect(count(data)).toBe(5);
      const nodeToken = token(data, 2);
      expect(nodeToken.type).toBe(T.class);
      expect(nodeToken.modifiers).toBe(M.declaration);
      expect(nodeToken.length).toBe(5); // "nodeA"
    });

    it("edge source and target get class with no declaration modifier", () => {
      const data = computeSemanticTokens("digraph G { a -> b }");
      // "a" — edge source
      expect(token(data, 2).type).toBe(T.class);
      expect(token(data, 2).modifiers).toBe(0);
      // "b" — edge target
      expect(token(data, 4).type).toBe(T.class);
      expect(token(data, 4).modifiers).toBe(0);
    });

    it("multi-hop edge chain: a -> b -> c", () => {
      const data = computeSemanticTokens("digraph G { a -> b -> c }");
      // digraph, G, a, ->, b, ->, c
      expect(count(data)).toBe(7);
      expect(token(data, 2)).toMatchObject({ type: T.class, modifiers: 0 }); // a
      expect(token(data, 3)).toMatchObject({ type: T.operator });             // ->
      expect(token(data, 4)).toMatchObject({ type: T.class, modifiers: 0 }); // b
      expect(token(data, 5)).toMatchObject({ type: T.operator });             // ->
      expect(token(data, 6)).toMatchObject({ type: T.class, modifiers: 0 }); // c
    });
  });

  describe("attribute keys per context", () => {
    it("graph-level attr key gets property + static modifier", () => {
      const data = computeSemanticTokens('digraph G { graph [goal = "run"] }');
      // digraph(kw+decl), G(ns+decl), graph(kw), goal(prop+static), "run"(string)
      const goalToken = token(data, 3);
      expect(goalToken.type).toBe(T.property);
      expect(goalToken.modifiers).toBe(M.static);
    });

    it("node attr key gets property with no modifier", () => {
      const data = computeSemanticTokens('digraph G { nodeA [shape = "box"] }');
      // digraph, G, nodeA(class+decl), shape(prop+0), "box"(string)
      const shapeToken = token(data, 3);
      expect(shapeToken.type).toBe(T.property);
      expect(shapeToken.modifiers).toBe(0);
    });

    it("edge attr key gets property + abstract modifier", () => {
      const data = computeSemanticTokens('digraph G { a -> b [label = "x"] }');
      // digraph, G, a(class), ->(op), b(class), label(prop+abstract), "x"(string)
      const labelToken = token(data, 5);
      expect(labelToken.type).toBe(T.property);
      expect(labelToken.modifiers).toBe(M.abstract);
    });

    it("node defaults attr key gets property with no modifier", () => {
      const data = computeSemanticTokens('digraph G { node [shape = "box"] }');
      // digraph, G, node(kw), shape(prop+0), "box"(string)
      expect(token(data, 2)).toMatchObject({ type: T.keyword, modifiers: 0 }); // node keyword
      const shapeToken = token(data, 3);
      expect(shapeToken.type).toBe(T.property);
      expect(shapeToken.modifiers).toBe(0);
    });

    it("edge defaults attr key gets property + abstract modifier", () => {
      const data = computeSemanticTokens('digraph G { edge [weight = 2] }');
      // digraph, G, edge(kw), weight(prop+abstract), 2(number)
      const weightToken = token(data, 3);
      expect(weightToken.type).toBe(T.property);
      expect(weightToken.modifiers).toBe(M.abstract);
    });
  });

  describe("value types", () => {
    it("string value gets string type", () => {
      const data = computeSemanticTokens('digraph G { a [label = "hello"] }');
      // digraph, G, a, label, "hello"
      const valToken = token(data, 4);
      expect(valToken.type).toBe(T.string);
      expect(valToken.modifiers).toBe(0);
      expect(valToken.length).toBe(7); // "hello" = 5 chars + 2 quotes
    });

    it("integer value gets number type", () => {
      const data = computeSemanticTokens("digraph G { a [max_retries = 3] }");
      // digraph, G, a, max_retries, 3
      const valToken = token(data, 4);
      expect(valToken.type).toBe(T.number);
      expect(valToken.modifiers).toBe(0);
      expect(valToken.length).toBe(1);
    });

    it("float value gets number type", () => {
      const data = computeSemanticTokens("digraph G { a [weight = 1.5] }");
      const valToken = token(data, 4);
      expect(valToken.type).toBe(T.number);
      expect(valToken.modifiers).toBe(0);
    });

    it("duration value gets number + readonly modifier", () => {
      const data = computeSemanticTokens("digraph G { a [timeout = 30s] }");
      // digraph, G, a, timeout, 30s
      const valToken = token(data, 4);
      expect(valToken.type).toBe(T.number);
      expect(valToken.modifiers).toBe(M.readonly);
      expect(valToken.length).toBe(3); // "30s"
    });

    it("boolean true value gets keyword type", () => {
      const data = computeSemanticTokens("digraph G { a [goal_gate = true] }");
      const valToken = token(data, 4);
      expect(valToken.type).toBe(T.keyword);
      expect(valToken.modifiers).toBe(0);
    });

    it("boolean false value gets keyword type", () => {
      const data = computeSemanticTokens("digraph G { a [auto_status = false] }");
      const valToken = token(data, 4);
      expect(valToken.type).toBe(T.keyword);
      expect(valToken.modifiers).toBe(0);
    });

    it("unquoted identifier value (e.g. shape=Mdiamond) gets string type", () => {
      const data = computeSemanticTokens("digraph G { a [shape = Mdiamond] }");
      const valToken = token(data, 4);
      expect(valToken.type).toBe(T.string);
      expect(valToken.length).toBe(8); // "Mdiamond"
    });
  });

  describe("condition values", () => {
    it("condition key value gets string + abstract regardless of type", () => {
      const data = computeSemanticTokens('digraph G { a -> b [condition = "foo == bar"] }');
      // digraph, G, a, ->, b, condition(prop+abstract), "foo == bar"(string+abstract)
      const condKeyToken = token(data, 5);
      expect(condKeyToken.type).toBe(T.property);
      expect(condKeyToken.modifiers).toBe(M.abstract);

      const condValToken = token(data, 6);
      expect(condValToken.type).toBe(T.string);
      expect(condValToken.modifiers).toBe(M.abstract);
    });

    it("condition with identifier value also gets string + abstract", () => {
      const data = computeSemanticTokens("digraph G { a -> b [condition = someIdent] }");
      const condValToken = token(data, 6);
      expect(condValToken.type).toBe(T.string);
      expect(condValToken.modifiers).toBe(M.abstract);
    });
  });

  describe("subgraph keyword", () => {
    it("subgraph keyword gets keyword type", () => {
      const data = computeSemanticTokens("digraph G { subgraph { a -> b } }");
      // digraph(kw+decl), G(ns+decl), subgraph(kw), a(class), ->(op), b(class)
      expect(count(data)).toBe(6);
      expect(token(data, 2)).toMatchObject({ type: T.keyword, modifiers: 0, length: 8 }); // "subgraph"
    });

    it("subgraph with named subgraph", () => {
      const data = computeSemanticTokens("digraph G { subgraph cluster1 { a -> b } }");
      // subgraph name "cluster1" is not emitted per spec
      // digraph(kw+decl), G(ns+decl), subgraph(kw), a(class), ->(op), b(class)
      expect(count(data)).toBe(6);
      expect(token(data, 2)).toMatchObject({ type: T.keyword, length: 8 });
    });
  });

  describe("delta encoding correctness", () => {
    it("multi-line input produces correct deltaLine values", () => {
      const src = "digraph G {\n  a -> b\n}";
      const data = computeSemanticTokens(src);
      // Tokens: digraph(L1), G(L1), a(L2), ->(L2), b(L2)
      expect(count(data)).toBe(5);
      // Token 0: digraph at line 1, col 1 → 0-based (0,0), delta = (0,0)
      expect(token(data, 0).deltaLine).toBe(0);
      expect(token(data, 0).deltaCol).toBe(0);
      // Token 1: G at line 1, col 9 → 0-based (0,8), delta from (0,0) = (0,8)
      expect(token(data, 1).deltaLine).toBe(0);
      expect(token(data, 1).deltaCol).toBe(8);
      // Token 2: a at line 2, col 3 → 0-based (1,2), delta from (0,8) = (1,2)
      expect(token(data, 2).deltaLine).toBe(1);
      expect(token(data, 2).deltaCol).toBe(2); // col from start of line (0-based)
      // Token 3: -> at line 2, col 5 → 0-based (1,4), delta from (1,2) = (0,2)
      expect(token(data, 3).deltaLine).toBe(0);
      expect(token(data, 3).deltaCol).toBe(2);
      // Token 4: b at line 2, col 8 → 0-based (1,7), delta from (1,4) = (0,3)
      expect(token(data, 4).deltaLine).toBe(0);
      expect(token(data, 4).deltaCol).toBe(3);
    });

    it("tokens spanning multiple lines all have correct deltas", () => {
      const src = "digraph G {\n  a [label = \"x\"]\n  b [label = \"y\"]\n}";
      const data = computeSemanticTokens(src);
      // digraph, G, a, label, "x", b, label, "y"
      expect(count(data)).toBe(8);
      // b is on line 3 (0-based line 2), a is on line 2 (0-based line 1)
      expect(token(data, 5).deltaLine).toBe(1); // b is one line after a's label token
    });
  });

  describe("error resilience", () => {
    it("malformed input (unclosed brace) returns partial tokens without throwing", () => {
      expect(() => computeSemanticTokens("digraph G {")).not.toThrow();
      const data = computeSemanticTokens("digraph G {");
      // Should at minimum get digraph and G tokens
      expect(count(data)).toBeGreaterThanOrEqual(2);
      expect(token(data, 0)).toMatchObject({ type: T.keyword });
      expect(token(data, 1)).toMatchObject({ type: T.namespace });
    });

    it("lexer error (invalid character) returns empty array without throwing", () => {
      expect(() => computeSemanticTokens("digraph G { $ }")).not.toThrow();
      // $ is invalid — lexer throws, we return []
      const data = computeSemanticTokens("digraph G { $ }");
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });

    it("empty string returns empty array", () => {
      const data = computeSemanticTokens("");
      expect(data).toEqual([]);
    });

    it("whitespace-only string returns empty array", () => {
      const data = computeSemanticTokens("   \n  \n  ");
      expect(data).toEqual([]);
    });
  });

  describe("bare attribute assignments before edge statements (BUG-001)", () => {
    // Bare key=value assignments at graph/subgraph body level (e.g. `label="Test"`,
    // `goal="test"`) are treated by the classifier as node declarations (class+declaration)
    // because there is no dedicated bare-assignment path. This is cosmetically imperfect
    // but harmless. The critical behaviour being tested here is that `hasArrowAhead()`
    // stops at EQUALS, so the EDGE SOURCE on the next line is NOT silently dropped.

    it("bare assignment in subgraph body — edge source n1 is not dropped", () => {
      const src = 'digraph G {\n  subgraph {\n    label="Test"\n    n1 -> n2\n  }\n}';
      const data = computeSemanticTokens(src);
      // Tokens: digraph(kw+decl), G(ns+decl), subgraph(kw),
      //         label(class+decl — bare assignment treated as node decl),
      //         n1(class), ->(op), n2(class)
      // Note: string value "Test" after = is consumed without being emitted.
      expect(count(data)).toBe(7);

      // "label" is NOT classified as an edge source (no modifiers); it gets declaration
      const labelTok = token(data, 3);
      expect(labelTok.type).toBe(T.class);
      expect(labelTok.modifiers).toBe(M.declaration);
      expect(labelTok.length).toBe(5); // "label"

      // "n1" must appear — the core bug was that it was silently dropped
      const n1Tok = token(data, 4);
      expect(n1Tok.type).toBe(T.class);
      expect(n1Tok.modifiers).toBe(0);
      expect(n1Tok.length).toBe(2); // "n1"

      // "->" operator
      expect(token(data, 5).type).toBe(T.operator);

      // "n2" target
      expect(token(data, 6).type).toBe(T.class);
    });

    it("bare assignment at top-level body — edge source a is not dropped", () => {
      const src = 'digraph G {\n  goal="test"\n  a -> b\n}';
      const data = computeSemanticTokens(src);
      // Tokens: digraph(kw+decl), G(ns+decl), goal(class+decl), a(class), ->(op), b(class)
      // Note: string value "test" after = is consumed without being emitted.
      expect(count(data)).toBe(6);

      // "goal" is NOT classified as an edge source
      const goalTok = token(data, 2);
      expect(goalTok.type).toBe(T.class);
      expect(goalTok.modifiers).toBe(M.declaration);
      expect(goalTok.length).toBe(4); // "goal"

      // "a" must appear — the core bug was that it was silently dropped
      const aTok = token(data, 3);
      expect(aTok.type).toBe(T.class);
      expect(aTok.modifiers).toBe(0);
      expect(aTok.length).toBe(1); // "a"

      expect(token(data, 4).type).toBe(T.operator); // "->"
      expect(token(data, 5).type).toBe(T.class);    // "b"
    });
  });

  describe("graph / node / edge keywords in body", () => {
    it("graph keyword in body gets keyword type with no modifier", () => {
      const data = computeSemanticTokens('digraph G { graph [goal = "x"] }');
      // Token 2: "graph" keyword
      expect(token(data, 2)).toMatchObject({ type: T.keyword, modifiers: 0, length: 5 });
    });

    it("node keyword in body gets keyword type with no modifier", () => {
      const data = computeSemanticTokens('digraph G { node [shape = "box"] }');
      expect(token(data, 2)).toMatchObject({ type: T.keyword, modifiers: 0, length: 4 });
    });

    it("edge keyword in body gets keyword type with no modifier", () => {
      const data = computeSemanticTokens("digraph G { edge [weight = 2] }");
      expect(token(data, 2)).toMatchObject({ type: T.keyword, modifiers: 0, length: 4 });
    });
  });
});
