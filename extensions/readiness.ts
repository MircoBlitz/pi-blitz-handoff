import { randomUUID } from "node:crypto";

export const SESSION_HANDOFF_GO_TOOL = "session_handoff_go";
export const SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL = "session_handoff_go_with_user_deferral";

export function createReadinessKey(): string {
  return `handoff-go-${randomUUID()}`;
}

export function readinessPrompt(
  callTemplate: string,
  key: string,
  allowUserDeferral: boolean,
): string {
  return [
    callTemplate.trim(),
    ...readinessProtocol(key, allowUserDeferral),
    "Do not print the key or claim that the handoff completed.",
  ].join("\n");
}

export function readinessReminder(
  callTemplate: string,
  key: string,
  allowUserDeferral: boolean,
): string {
  return [
    "One-time session handoff readiness reminder.",
    callTemplate.trim(),
    ...readinessProtocol(key, allowUserDeferral),
    "If you call no readiness tool, produce no normal text. Do not print the key or claim that the handoff completed.",
  ].join("\n");
}

export function readinessEmergency(key: string, percent: number): string {
  return [
    `Session handoff emergency: context usage is ${percent.toFixed(1)}%. The 90% emergency limit has been reached.`,
    "Stop all source-task work now. Do not postpone this handoff to finish a task, wait for subagents, gather more context, or answer ordinary source-task questions. Leave unfinished work for the replacement session.",
    `Call ${SESSION_HANDOFF_GO_TOOL} with key ${key} immediately. Do not request user deferral, start other tools or subagents, or produce normal task output. This emergency instruction overrides the normal readiness waiting guidance.`,
    "After GO, wait for the extension's writer/finalization instruction, then write the handoff and submit DONE. Preserve the remaining context for that transfer. Do not print the key or claim that the handoff completed.",
  ].join("\n");
}

function readinessProtocol(key: string, allowUserDeferral: boolean): string[] {
  if (!allowUserDeferral) {
    return [
      "This handoff was initiated automatically. User deferral is unavailable.",
      `When ready, call ${SESSION_HANDOFF_GO_TOOL} with key ${key}.`,
    ];
  }
  return [
    "Choose between the two correlated readiness tools according to the Call Template above.",
    `Call ${SESSION_HANDOFF_GO_TOOL} with key ${key} for direct GO.`,
    `Alternatively, call ${SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL} with key ${key} and a short concrete reason. The extension, not free-form text, will ask the user to choose Ready, Wait, or Cancel.`,
  ];
}
