import type { Interviewer, Question, Answer } from "./interviewer.js";

export class AutoApproveInterviewer implements Interviewer {
  async ask(question: Question): Promise<Answer> {
    switch (question.type) {
      case "yes_no":
      case "confirmation":
        return { value: "YES" };
      case "multiple_choice": {
        const first = question.options?.[0];
        if (first) {
          return { value: first.key, selectedOption: first };
        }
        return { value: "auto-approved" };
      }
      case "freeform":
      default:
        return { value: "auto-approved" };
    }
  }

  inform(_message: string, _stage: string): void {
    // no-op
  }
}
