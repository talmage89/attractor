import { describe, it, expect } from "vitest";
import { StartHandler } from "../../src/handlers/start.js";
import { ExitHandler } from "../../src/handlers/exit.js";
import { ConditionalHandler } from "../../src/handlers/conditional.js";
import { Context } from "../../src/model/context.js";
import { parse } from "../../src/parser/parser.js";

describe("StartHandler", () => {
  it("returns success", async () => {
    const handler = new StartHandler();
    const outcome = await handler.execute(
      { id: "s" } as any,
      new Context(),
      {} as any,
      {} as any
    );
    expect(outcome.status).toBe("success");
  });
});

describe("ExitHandler", () => {
  it("returns success", async () => {
    const handler = new ExitHandler();
    const outcome = await handler.execute(
      { id: "e" } as any,
      new Context(),
      {} as any,
      {} as any
    );
    expect(outcome.status).toBe("success");
  });
});

describe("ConditionalHandler", () => {
  it("returns success with node ID in notes", async () => {
    const handler = new ConditionalHandler();
    const outcome = await handler.execute(
      { id: "gate" } as any,
      new Context(),
      {} as any,
      {} as any
    );
    expect(outcome.status).toBe("success");
    expect(outcome.notes).toContain("gate");
  });
});
