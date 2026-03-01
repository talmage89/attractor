import type { Interviewer, Answer } from "./interviewer.js";

export class QueueInterviewer implements Interviewer {
  private answers: Answer[];
  private index = 0;

  constructor(answers: Answer[]) {
    this.answers = answers;
  }

  async ask(): Promise<Answer> {
    if (this.index < this.answers.length) {
      return this.answers[this.index++];
    }
    return { value: "SKIPPED" };
  }

  inform(): void {
    // no-op
  }
}
