import type { ContextUsage } from "@earendil-works/pi-coding-agent";

import type { HandoffConfig } from "./config.ts";
import { automaticHandoffEnabled, type HandoffFlowPhase } from "./flow.ts";

export type ContextWarning = "advisory" | "critical" | undefined;
export type HandoffTerminalState = "finished" | "failed" | "cancelled";

interface HandoffStatusUI {
  setStatus(key: string, text: string | undefined): void;
  setWorkingIndicator?(options?: { frames?: string[]; intervalMs?: number }): void;
}

const WRITING_INDICATOR = {
  frames: ["·", "•", "●", "•"],
  intervalMs: 120,
};

const terminalStates = new Map<string, HandoffTerminalState>();
const protectedReplacementSessions = new Set<string>();

export function protectReplacementSession(sessionFile: string | undefined): void {
  if (sessionFile !== undefined) protectedReplacementSessions.add(sessionFile);
}

export function replacementSessionIsProtected(sessionFile: string | undefined): boolean {
  return sessionFile !== undefined && protectedReplacementSessions.has(sessionFile);
}

export function unprotectReplacementSession(sessionFile: string | undefined): void {
  if (sessionFile !== undefined) protectedReplacementSessions.delete(sessionFile);
}

export function setHandoffTerminalState(sessionFile: string | undefined, state: HandoffTerminalState): void {
  if (sessionFile !== undefined) terminalStates.set(sessionFile, state);
}

export function getHandoffTerminalState(sessionFile: string | undefined): HandoffTerminalState | undefined {
  return sessionFile === undefined ? undefined : terminalStates.get(sessionFile);
}

export function clearHandoffTerminalState(sessionFile: string | undefined): void {
  if (sessionFile !== undefined) terminalStates.delete(sessionFile);
}

export function persistentHandoffStatus(
  phase: HandoffFlowPhase,
  terminalState?: HandoffTerminalState,
  writing = false,
): string | undefined {
  if (terminalState === "finished") return "Session Handoff Finished";
  if (terminalState === "failed") return "Session Handoff Failed";
  if (terminalState === "cancelled") return "Session Handoff Cancelled";
  if (writing) return "Writing Session Handoff";
  if (phase === "inactive") return undefined;
  return "Waiting for Session Handoff";
}

export function updatePersistentHandoffStatus(
  ui: HandoffStatusUI,
  key: string,
  phase: HandoffFlowPhase,
  terminalState?: HandoffTerminalState,
  writing = false,
): void {
  const showWriting = writing && terminalState === undefined;
  ui.setStatus(key, persistentHandoffStatus(phase, terminalState, showWriting));
  ui.setWorkingIndicator?.(showWriting ? WRITING_INDICATOR : undefined);
}

export function contextWarning(
  percent: number | null | undefined,
  config: Pick<HandoffConfig, "contextWarningPercent" | "criticalWarningPercent">,
  advisoryAlreadyShown: boolean,
): ContextWarning {
  if (percent === null || percent === undefined) return undefined;
  if (percent >= config.criticalWarningPercent) return "critical";
  if (!advisoryAlreadyShown && percent >= config.contextWarningPercent) return "advisory";
  return undefined;
}

export function warningMessage(warning: Exclude<ContextWarning, undefined>, percent: number): string {
  const measured = formatPercent(percent);
  return warning === "critical"
    ? `Context usage is critical at ${measured}. A session handoff is recommended.`
    : `Context usage is ${measured}. Consider a session handoff.`;
}

export function formatPublicStatus(
  phase: HandoffFlowPhase,
  usage: ContextUsage | undefined,
  config: Pick<
    HandoffConfig,
    | "contextWarningPercent"
    | "criticalWarningPercent"
    | "automaticSessionHandoff"
    | "automaticSessionHandoffPercent"
    | "readinessRetrySeconds"
  >,
  terminalState?: HandoffTerminalState,
  writing = false,
): string {
  const persistent = persistentHandoffStatus(phase, terminalState, writing);
  const handoff = persistent === undefined ? "No active session handoff." : `${persistent}.`;
  const context = formatContextUsage(usage);
  const automatic = automaticHandoffEnabled(
    config.automaticSessionHandoff,
    config.automaticSessionHandoffPercent,
  )
    ? `enabled at ${formatPercent(config.automaticSessionHandoffPercent)}`
    : "disabled";

  return [
    handoff,
    `Context usage: ${context}.`,
    `Warning threshold: ${formatPercent(config.contextWarningPercent)}; critical threshold: ${formatPercent(config.criticalWarningPercent)}.`,
    `Automatic session handoff: ${automatic}.`,
    `Readiness retry delay: ${config.readinessRetrySeconds} seconds.`,
  ].join(" ");
}

function formatContextUsage(usage: ContextUsage | undefined): string {
  if (usage === undefined) return "unavailable";
  const percent = usage.percent === null ? "unknown" : formatPercent(usage.percent);
  const tokens = usage.tokens === null ? "unknown tokens" : `${usage.tokens} tokens`;
  return `${percent} (${tokens} of ${usage.contextWindow})`;
}

function formatPercent(percent: number): string {
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}
