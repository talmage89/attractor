import type { Question, Answer } from "../model/events.js";

export type { Question, Answer };

export interface Interviewer {
  ask(question: Question): Promise<Answer>;
  inform(message: string, stage: string): void;
}
