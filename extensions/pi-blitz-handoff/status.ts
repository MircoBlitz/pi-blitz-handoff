import type { ContextUsage } from "@earendil-works/pi-coding-agent";

import type { HandoffConfig } from "./config.ts";
import { automaticHandoffEnabled, type HandoffFlowPhase } from "./flow.ts";

export type ContextWarning = "advisory" | "critical" | undefined;
export type HandoffTerminalState = "finished" | "failed" | "cancelled";

interface HandoffWidgetComponent {
  render(width: number): string[];
  invalidate(): void;
}

interface HandoffStatusUI {
  setWidget?(
    key: string,
    content: string[] | ((tui: { requestRender(): void }) => HandoffWidgetComponent) | undefined,
  ): void;
  setWorkingIndicator?(options?: { frames?: string[]; intervalMs?: number }): void;
  theme?: { fg(color: "success" | "warning" | "error", text: string): string };
}

class PersistentHandoffWidget implements HandoffWidgetComponent {
  private text: string | undefined;
  private readonly requestRender: () => void;

  constructor(text: string | undefined, requestRender: () => void) {
    this.text = text;
    this.requestRender = requestRender;
  }

  update(text: string | undefined): void {
    this.text = text;
    this.requestRender();
  }

  render(_width: number): string[] {
    return this.text === undefined ? [] : [this.text];
  }

  invalidate(): void {}
}

interface PersistentHandoffWidgetState {
  text: string | undefined;
  component?: PersistentHandoffWidget;
}

const WRITING_INDICATOR = {
  frames: ["·", "•", "●", "•"],
  intervalMs: 120,
};

const terminalStates = new Map<string, HandoffTerminalState>();
const handoffActivity = new Map<string, { startedAt: number }>();
const protectedReplacementSessions = new Set<string>();
const persistentWidgets = new WeakMap<HandoffStatusUI, Map<string, PersistentHandoffWidgetState>>();

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

export function registerPersistentHandoffStatus(ui: HandoffStatusUI, key: string): void {
  let widgets = persistentWidgets.get(ui);
  if (widgets === undefined) {
    widgets = new Map();
    persistentWidgets.set(ui, widgets);
  }
  if (widgets.has(key)) return;

  const state: PersistentHandoffWidgetState = { text: undefined };
  widgets.set(key, state);
  ui.setWidget?.(key, (tui) => {
    const component = new PersistentHandoffWidget(state.text, () => tui.requestRender());
    state.component = component;
    return component;
  });
}

export function disposePersistentHandoffStatus(ui: HandoffStatusUI, key: string): void {
  const widgets = persistentWidgets.get(ui);
  widgets?.delete(key);
  if (widgets?.size === 0) persistentWidgets.delete(ui);
  stopHandoffActivity(key);
  ui.setWorkingIndicator?.(undefined);
  ui.setWidget?.(key, undefined);
}

export function updatePersistentHandoffStatus(
  ui: HandoffStatusUI,
  key: string,
  phase: HandoffFlowPhase,
  terminalState?: HandoffTerminalState,
  writing = false,
  startedAtOverride?: number,
): void {
  const showWriting = writing && terminalState === undefined;
  const active = terminalState === undefined && phase !== "inactive";
  const activity = active ? getHandoffActivity(key) : handoffActivity.get(key);
  const elapsedSeconds = activity === undefined
    ? startedAtOverride === undefined ? undefined : elapsedSince(startedAtOverride)
    : elapsedSince(activity.startedAt);

  const text = terminalState === undefined && phase !== "inactive"
    ? colorizeActivity(ui, formatHandoffActivity(showWriting, phase), showWriting ? undefined : "warning")
    : terminalState === undefined
      ? undefined
      : colorizeTerminal(ui, terminalState, elapsedSeconds);
  const widget = persistentWidgets.get(ui)?.get(key);
  if (widget === undefined) {
    ui.setWidget?.(key, text === undefined ? undefined : [text]);
  } else {
    widget.text = text;
    widget.component?.update(text);
  }
  ui.setWorkingIndicator?.(showWriting ? WRITING_INDICATOR : undefined);

  if (!active) stopHandoffActivity(key);
}

export function getHandoffActivityStartedAt(key: string): number | undefined {
  return handoffActivity.get(key)?.startedAt;
}

function getHandoffActivity(key: string): { startedAt: number } {
  const existing = handoffActivity.get(key);
  if (existing !== undefined) return existing;
  const created = { startedAt: Date.now() };
  handoffActivity.set(key, created);
  return created;
}

function stopHandoffActivity(key: string): void {
  handoffActivity.delete(key);
}

function elapsedSince(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function colorizeActivity(
  ui: HandoffStatusUI,
  text: string,
  semanticColor: "warning" | undefined,
): string {
  if (ui.theme === undefined) return text;
  if (semanticColor !== undefined) return ui.theme.fg(semanticColor, text);
  return `\u001b[38;5;226m${text}\u001b[39m`;
}

function colorizeTerminal(ui: HandoffStatusUI, state: HandoffTerminalState, elapsedSeconds: number | undefined): string {
  const text = elapsedSeconds === undefined
    ? `Session Handoff · ${state}`
    : `Session Handoff · ${state} · ${elapsedSeconds} sec`;
  if (ui.theme === undefined) return text;
  return ui.theme.fg(state === "finished" ? "success" : state === "failed" ? "error" : "warning", text);
}

function formatHandoffActivity(writing: boolean, phase: HandoffFlowPhase): string {
  const activity = writing
    ? "starting session export"
    : phase === "retry-delay"
      ? "waiting before readiness retry"
      : "waiting for readiness";
  const input = phase === "ready" || writing ? "Input deferred" : "Input available";
  return `Session Handoff · ${activity} · ${input} · /sh cancel`;
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
