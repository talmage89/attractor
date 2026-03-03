import * as readline from "node:readline/promises";
import type { Interviewer, Question, Answer } from "./interviewer.js";

export class ConsoleInterviewer implements Interviewer {
  async ask(question: Question): Promise<Answer> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      console.log(`\n[?] ${question.text}  (stage: ${question.stage})`);

      if (question.type === "multiple_choice" && question.options) {
        for (const opt of question.options) {
          console.log(`  [${opt.key}] ${opt.label}`);
        }
        const response = await rl.question("Select: ");
        const match = question.options.find(
          (opt) =>
            opt.key.toLowerCase() === response.trim().toLowerCase() ||
            opt.label.toLowerCase() === response.trim().toLowerCase()
        );
        if (match) {
          return { value: match.key, selectedOption: match };
        }
        return { value: response.trim() };
      } else if (question.type === "yes_no" || question.type === "confirmation") {
        const response = await rl.question("[Y/N]: ");
        const isYes = ["y", "yes"].includes(response.trim().toLowerCase());
        return { value: isYes ? "YES" : "NO" };
      } else {
        const response = await rl.question("> ");
        return { value: response, text: response };
      }
    } finally {
      rl.close();
    }
  }

  inform(message: string, stage: string): void {
    console.log(`[i] (${stage}) ${message}`);
  }
}
