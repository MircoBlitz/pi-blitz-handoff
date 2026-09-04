import type { ContextUsage } from "@earendil-works/pi-coding-agent";

import type { HandoffConfig } from "./config.ts";
import { automaticHandoffEnabled, type HandoffFlowPhase } from "./flow.ts";

export type ContextWarning = "advisory" | "critical" | undefined;

export function persistentHandoffStatus(phase: HandoffFlowPhase): string | undefined {
  if (phase === "inactive") return undefined;
  if (phase === "ready") return "Waiting for Session Handoff";
  return "Waiting for Session Handoff";
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
): string {
  const handoff = phase === "inactive" ? "No active session handoff." : `${persistentHandoffStatus(phase)}.`;
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
