import { describe, it, expect } from "vitest";
import { AutoApproveInterviewer } from "../../src/interviewer/auto-approve.js";
import { QueueInterviewer } from "../../src/interviewer/queue.js";
import type { Question } from "../../src/interviewer/interviewer.js";

describe("AutoApproveInterviewer", () => {
  const interviewer = new AutoApproveInterviewer();

  it("approves yes_no questions", async () => {
    const q: Question = { text: "Continue?", type: "yes_no", stage: "test" };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("YES");
  });

  it("approves confirmation questions", async () => {
    const q: Question = { text: "Confirm?", type: "confirmation", stage: "test" };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("YES");
  });

  it("selects first option for multiple choice", async () => {
    const q: Question = {
      text: "Pick one",
      type: "multiple_choice",
      options: [
        { key: "A", label: "Alpha" },
        { key: "B", label: "Beta" },
      ],
      stage: "test",
    };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("A");
    expect(answer.selectedOption?.label).toBe("Alpha");
  });

  it("returns auto-approved for freeform", async () => {
    const q: Question = { text: "Describe:", type: "freeform", stage: "test" };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("auto-approved");
  });

  it("inform is a no-op", () => {
    // Should not throw
    interviewer.inform("message", "stage");
  });
});

describe("QueueInterviewer", () => {
  it("returns answers in order", async () => {
    const interviewer = new QueueInterviewer([
      { value: "first" },
      { value: "second" },
    ]);
    const q: Question = { text: "Q?", type: "freeform", stage: "test" };

    const a1 = await interviewer.ask(q);
    expect(a1.value).toBe("first");

    const a2 = await interviewer.ask(q);
    expect(a2.value).toBe("second");
  });

  it("returns SKIPPED when queue is exhausted", async () => {
    const interviewer = new QueueInterviewer([{ value: "only" }]);
    const q: Question = { text: "Q?", type: "freeform", stage: "test" };

    await interviewer.ask(q); // "only"
    const a2 = await interviewer.ask(q);
    expect(a2.value).toBe("SKIPPED");
  });

  it("returns SKIPPED when queue is empty", async () => {
    const interviewer = new QueueInterviewer([]);
    const q: Question = { text: "Q?", type: "freeform", stage: "test" };
    const answer = await interviewer.ask(q);
    expect(answer.value).toBe("SKIPPED");
  });

  it("inform is a no-op", () => {
    const interviewer = new QueueInterviewer([]);
    interviewer.inform("msg", "stage"); // should not throw
  });
});
