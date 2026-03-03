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
