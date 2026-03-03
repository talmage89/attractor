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
});
