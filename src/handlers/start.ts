import type { Handler } from "./registry.js";
import type { Outcome } from "../model/outcome.js";

export class StartHandler implements Handler {
  async execute(): Promise<Outcome> {
    return { status: "success" };
  }
}
