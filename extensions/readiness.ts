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
  const protocol = allowUserDeferral
    ? [
        "Choose semantically between the two correlated readiness tools.",
        `Call ${SESSION_HANDOFF_GO_TOOL} with key ${key} for direct GO. Prefer direct GO when uncertain rather than inventing user deferral.`,
        `Only when a concrete active collaboration or user interaction may still matter before replacement, call ${SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL} with key ${key} and a short concrete reason. The extension, not free-form text, will ask the user to choose Ready, Wait, or Cancel.`,
      ]
    : [
        "This handoff was initiated automatically. User deferral is unavailable because it would stop the autonomous run.",
        `When ready, call ${SESSION_HANDOFF_GO_TOOL} with key ${key}.`,
      ];
  return [
    callTemplate.trim(),
    ...protocol,
    `Do not call ${allowUserDeferral ? "either tool" : "the tool"} while required model-owned work, tool execution, subagents, background work, or required output is still in flight. Do not print the key or claim that the handoff completed.`,
  ].join("\n");
}

export function readinessReminder(key: string, allowUserDeferral: boolean): string {
  const readinessAction = allowUserDeferral
    ? `If ready, call ${SESSION_HANDOFF_GO_TOOL} with key ${key}, or call ${SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL} with that key and a short concrete reason only if active user collaboration may still matter.`
    : `This handoff was initiated automatically. If ready, call ${SESSION_HANDOFF_GO_TOOL} with key ${key}; user deferral is unavailable.`;
  return [
    "Session handoff reminder: silently re-evaluate readiness now.",
    readinessAction,
    `If required work or output is still in flight, call ${allowUserDeferral ? "neither tool" : "no tool"} and produce no normal text.`,
  ].join(" ");
}
