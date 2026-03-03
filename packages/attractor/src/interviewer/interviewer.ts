import type { Question, Answer } from "../model/events.js";

export type { Question, Answer };

export interface Interviewer {
  ask(question: Question): Promise<Answer>;
  /** Notify the interviewer of a status message. Not called internally;
   *  intended for external consumer implementations (e.g. a custom UI). */
  inform(message: string, stage: string): void;
}
