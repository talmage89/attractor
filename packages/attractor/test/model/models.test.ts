import { describe, it, expect } from "vitest";
import { Models, resolveModel } from "../../src/model/models.js";

describe("resolveModel", () => {
  it('resolves "sonnet" to full model ID', () => {
    expect(resolveModel("sonnet")).toBe("claude-sonnet-4-6");
  });

  it('resolves "opus" to full model ID', () => {
    expect(resolveModel("opus")).toBe("claude-opus-4-6");
  });

  it('resolves "haiku" to full model ID', () => {
    expect(resolveModel("haiku")).toBe("claude-haiku-4-5-20251001");
  });

  it("is case-insensitive for sonnet", () => {
    expect(resolveModel("Sonnet")).toBe("claude-sonnet-4-6");
  });

  it("is case-insensitive for opus", () => {
    expect(resolveModel("OPUS")).toBe("claude-opus-4-6");
  });

  it("passes through full model ID unchanged", () => {
    expect(resolveModel("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("passes through unknown model name unchanged", () => {
    expect(resolveModel("gpt-5")).toBe("gpt-5");
  });

  it("passes through empty string unchanged", () => {
    expect(resolveModel("")).toBe("");
  });
});

describe("Models constant", () => {
  it("Models.OPUS is a string", () => {
    expect(typeof Models.OPUS).toBe("string");
  });

  it("Models.SONNET is a string", () => {
    expect(typeof Models.SONNET).toBe("string");
  });

  it("Models.HAIKU is a string", () => {
    expect(typeof Models.HAIKU).toBe("string");
  });

  it("all values contain claude- prefix", () => {
    expect(Models.OPUS).toMatch(/^claude-/);
    expect(Models.SONNET).toMatch(/^claude-/);
    expect(Models.HAIKU).toMatch(/^claude-/);
  });
});
