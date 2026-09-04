import { randomUUID } from "node:crypto";

export interface ReadinessIdentifiers {
  go: string;
  notYet: string;
}

export type ReadinessAnswer = "go" | "not-yet" | "invalid";

export function createReadinessIdentifiers(): ReadinessIdentifiers {
  return {
    go: `handoff-go-${randomUUID()}`,
    notYet: `handoff-not-yet-${randomUUID()}`,
  };
}

export function readinessPrompt(ids: ReadinessIdentifiers): string {
  return [
    "Is any session-owned work still active?",
    `If no, reply with exactly ${ids.go}`,
    `If yes, reply with exactly ${ids.notYet}`,
    "Reply with exactly one current identifier and nothing else.",
  ].join("\n");
}

export function classifyReadinessAnswer(answer: string | undefined, ids: ReadinessIdentifiers): ReadinessAnswer {
  const finalLine = answer
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .at(-1);
  if (finalLine === ids.go) return "go";
  if (finalLine === ids.notYet) return "not-yet";
  return "invalid";
}
