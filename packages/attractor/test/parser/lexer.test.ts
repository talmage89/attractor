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
    const tokens = lex(`human.default_choice`);
    expect(tokens[0].kind).toBe("IDENTIFIER");
    expect(tokens[0].value).toBe("human.default_choice");
  });

  it("handles negative numbers before identifiers", () => {
    const tokens = lex(`-1 abc`);
    expect(tokens[0]).toMatchObject({ kind: "INTEGER", value: "-1" });
    expect(tokens[1]).toMatchObject({ kind: "IDENTIFIER", value: "abc" });
  });

  it("preserves // inside a quoted string (does not treat as comment)", () => {
    const tokens = lex(`"use // to comment code"`);
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe("use // to comment code");
  });

  it("preserves URL with // inside a quoted string", () => {
    const tokens = lex(`"See https://example.com for docs"`);
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe("See https://example.com for docs");
  });

  it("preserves /* */ inside a quoted string (does not strip content)", () => {
    const tokens = lex(`"Read /* important.md */ and report"`);
    expect(tokens[0].kind).toBe("STRING");
    expect(tokens[0].value).toBe("Read /* important.md */ and report");
  });

  it("preserves // inside quoted string but strips // outside quoted string on same line", () => {
    const tokens = lex(`a = "url: http://x.com" // end comment\nb`);
    const strings = tokens.filter(t => t.kind === "STRING");
    expect(strings[0].value).toBe("url: http://x.com");
    const ids = tokens.filter(t => t.kind === "IDENTIFIER");
    expect(ids.map(t => t.value)).toEqual(["a", "b"]);
  });
});
