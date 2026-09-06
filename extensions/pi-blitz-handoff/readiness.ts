import { randomUUID } from "node:crypto";

export const SESSION_HANDOFF_GO_TOOL = "session_handoff_go";
export const SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL = "session_handoff_go_with_user_deferral";

export function createReadinessKey(): string {
  return `handoff-go-${randomUUID()}`;
}

export function readinessPrompt(callTemplate: string, key: string): string {
  return [
    callTemplate.trim(),
    "Choose semantically between the two correlated readiness tools; how this handoff was initiated does not choose for you.",
    `Call ${SESSION_HANDOFF_GO_TOOL} with key ${key} for direct GO. Prefer direct GO when uncertain rather than inventing user deferral.`,
    `Only when a concrete active collaboration or user interaction may still matter before replacement, call ${SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL} with key ${key} and a short concrete reason. The extension, not free-form text, will ask the user to choose Ready, Wait, or Cancel.`,
    "Do not call either tool while required model-owned work, tool execution, subagents, background work, or required output is still in flight. Do not print the key or claim that the handoff completed.",
  ].join("\n");
}

export function readinessReminder(key: string): string {
  return [
    "Session handoff reminder: silently re-evaluate readiness now.",
    `If ready, call ${SESSION_HANDOFF_GO_TOOL} with key ${key}, or call ${SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL} with that key and a short concrete reason only if active user collaboration may still matter.`,
    "If required work or output is still in flight, call neither tool and produce no normal text.",
  ].join(" ");
}
