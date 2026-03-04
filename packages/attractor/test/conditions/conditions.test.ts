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

  it("parses greater-than operator", () => {
    const clauses = parseCondition("context.x>5");
    expect(clauses).toEqual([{ key: "context.x", operator: ">", value: "5" }]);
  });

  it("parses greater-than-or-equal operator", () => {
    const clauses = parseCondition("context.x>=5");
    expect(clauses).toEqual([{ key: "context.x", operator: ">=", value: "5" }]);
  });

  it("parses less-than operator", () => {
    const clauses = parseCondition("context.x<5");
    expect(clauses).toEqual([{ key: "context.x", operator: "<", value: "5" }]);
  });

  it("parses less-than-or-equal operator", () => {
    const clauses = parseCondition("context.x<=5");
    expect(clauses).toEqual([{ key: "context.x", operator: "<=", value: "5" }]);
  });

  it("parses compound condition with >= and <", () => {
    const clauses = parseCondition("context.x>=5 && context.y<10");
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toEqual({ key: "context.x", operator: ">=", value: "5" });
    expect(clauses[1]).toEqual({ key: "context.y", operator: "<", value: "10" });
  });

  it("bare key fallback still works with new operators present", () => {
    const clauses = parseCondition("context.has_flag");
    expect(clauses).toEqual([{ key: "context.has_flag", operator: "!=", value: "" }]);
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

  it("trims trailing newline in resolved context value (BUG-005)", () => {
    // Tool stdout stored with trailing newline (e.g. `echo linux` → "linux\n")
    const ctx = makeContext({ "tool.output": "linux\n" });
    expect(evaluateCondition(
      "context.tool.output=linux",
      { status: "success" },
      ctx
    )).toBe(true);
  });

  it("trims whitespace on both sides of resolved value", () => {
    const ctx = makeContext({ "result": "  yes  " });
    expect(evaluateCondition(
      "context.result=yes",
      { status: "success" },
      ctx
    )).toBe(true);
  });

  it("resolveKey does not fall through when context.key is explicitly empty string", () => {
    // When the full key "context.flag" exists with value "", it should return ""
    // not fall through to look up "flag" which might have a different value
    const ctx = makeContext({ "context.flag": "", "flag": "yes" });
    // "context.flag" resolves to "" (not "yes")
    expect(evaluateCondition("context.flag=yes", { status: "success" }, ctx)).toBe(false);
    expect(evaluateCondition("context.flag=", { status: "success" }, ctx)).toBe(true);
  });

  it("context.count>2 with count=3 → true", () => {
    const ctx = makeContext({ "count": "3" });
    expect(evaluateCondition("context.count>2", { status: "success" }, ctx)).toBe(true);
  });

  it("context.count>2 with count=2 → false", () => {
    const ctx = makeContext({ "count": "2" });
    expect(evaluateCondition("context.count>2", { status: "success" }, ctx)).toBe(false);
  });

  it("context.count>=2 with count=2 → true", () => {
    const ctx = makeContext({ "count": "2" });
    expect(evaluateCondition("context.count>=2", { status: "success" }, ctx)).toBe(true);
  });

  it("context.count<5 with count=3 → true", () => {
    const ctx = makeContext({ "count": "3" });
    expect(evaluateCondition("context.count<5", { status: "success" }, ctx)).toBe(true);
  });

  it("context.count<=3 with count=3 → true", () => {
    const ctx = makeContext({ "count": "3" });
    expect(evaluateCondition("context.count<=3", { status: "success" }, ctx)).toBe(true);
  });

  it("context.count>2 with count=abc → false (NaN guard)", () => {
    const ctx = makeContext({ "count": "abc" });
    expect(evaluateCondition("context.count>2", { status: "success" }, ctx)).toBe(false);
  });

  it("context.count>2 with count empty → false (NaN guard)", () => {
    expect(evaluateCondition("context.count>2", { status: "success" }, new Context())).toBe(false);
  });

  it("mixed >= with && and != both evaluated", () => {
    const ctx = makeContext({ "x": "1", "label": "good" });
    expect(evaluateCondition(
      "context.x>=1 && context.label!=bad",
      { status: "success" },
      ctx
    )).toBe(true);
  });
});
