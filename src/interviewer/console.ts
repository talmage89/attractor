import * as readline from "node:readline/promises";
import type { Interviewer, Question, Answer } from "./interviewer.js";

export class ConsoleInterviewer implements Interviewer {
  async ask(question: Question): Promise<Answer> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      let prompt = question.text;
      if (question.type === "multiple_choice" && question.options) {
        for (const opt of question.options) {
          prompt += `\n  [${opt.key}] ${opt.label}`;
        }
        prompt += "\nChoice: ";
      } else {
        prompt += " ";
      }

      const response = await rl.question(prompt);

      if (question.type === "multiple_choice" && question.options) {
        const match = question.options.find(
          (opt) =>
            opt.key.toLowerCase() === response.trim().toLowerCase() ||
            opt.label.toLowerCase() === response.trim().toLowerCase()
        );
        if (match) {
          return { value: match.key, selectedOption: match };
        }
      }

      return { value: response.trim() };
    } finally {
      rl.close();
    }
  }

  inform(message: string, _stage: string): void {
    console.log(message);
  }
}
