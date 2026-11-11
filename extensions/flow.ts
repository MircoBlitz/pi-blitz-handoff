import { randomUUID } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DeferredPromptWindow, type DeferredPromptSnapshot } from "./deferred.ts";
import { readinessEmergency, readinessPrompt, readinessReminder } from "./readiness.ts";

export type ExplicitHandoffStartSource = "command" | "tool";
export type HandoffStartSource = ExplicitHandoffStartSource | "automatic";
export type HandoffFlowPhase = "inactive" | "waiting" | "writing" | "ready";
export interface ActiveHandoffSnapshot {
  id: string;
  source: HandoffStartSource;
  sourceSessionPath: string;
  phase: Exclude<HandoffFlowPhase, "inactive">;
  deferPromptsFrom: "request" | "writing";
}
export type HandoffStartResult =
  | { accepted: true; handoff: ActiveHandoffSnapshot }
  | { accepted: false; reason: "active" | "unpersisted"; handoff?: ActiveHandoffSnapshot };
export type HandoffInputResult = { action: "continue" } | { action: "deferred"; snapshot: DeferredPromptSnapshot };
export interface HandoffFlowOptions {
  readinessRetrySeconds: number;
  deferPromptsFrom?: "request" | "writing";
  callTemplate: string;
  onReadinessPrompt(prompt: string, handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onReadinessReminder(prompt: string, handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onReadinessEmergency(prompt: string, handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onReady(handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onPhaseChange?(handoff: ActiveHandoffSnapshot | undefined, ctx: ExtensionContext): void;
  createHandoffId?: () => string;
  setTimer?: (callback: () => void, delayMilliseconds: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  now?: () => Date;
}
interface ActiveHandoff extends ActiveHandoffSnapshot {
  callTemplate: string;
  instructionSent: boolean;
  emergencySent: boolean;
  transitionDispatched: boolean;
  reminderTimer?: unknown;
  deferred?: DeferredPromptWindow;
}
export class HandoffFlow {
  private active?: ActiveHandoff;
  private readonly options: HandoffFlowOptions;
  private readonly setTimer: (callback: () => void, delayMilliseconds: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  constructor(options: HandoffFlowOptions) {
    this.options = options;
    this.setTimer = options.setTimer ?? ((callback, delay) => { const timer = setTimeout(callback, delay); timer.unref(); return timer; });
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }
  get phase(): HandoffFlowPhase { return this.active?.phase ?? "inactive"; }
  get snapshot(): ActiveHandoffSnapshot | undefined { return this.active === undefined ? undefined : snapshot(this.active); }
  get deferredSnapshot(): DeferredPromptSnapshot | undefined { return this.active?.deferred?.snapshot; }
  get isTransferProtected(): boolean { return this.active?.deferred !== undefined || this.phase === "ready"; }
  setReadinessRetrySeconds(seconds: number): void { this.options.readinessRetrySeconds = seconds; }
  setCallTemplate(template: string): void { this.options.callTemplate = template; }
  setDeferPromptsFrom(mode: "request" | "writing"): void { this.options.deferPromptsFrom = mode; }
  start(ctx: ExtensionContext, source: ExplicitHandoffStartSource, callTemplate = this.options.callTemplate): HandoffStartResult {
    const result = this.createHandoff(ctx, source, callTemplate);
    if (result.accepted && this.active !== undefined && ctx.isIdle() && !ctx.hasPendingMessages()) this.dispatchReadiness(this.active, ctx);
    return result;
  }
  startAutomaticAtTurnBoundary(ctx: ExtensionContext, callTemplate = this.options.callTemplate): HandoffStartResult {
    const result = this.createHandoff(ctx, "automatic", callTemplate);
    if (result.accepted && this.active !== undefined) this.dispatchReadiness(this.active, ctx, true);
    return result;
  }
  private createHandoff(ctx: ExtensionContext, source: HandoffStartSource, callTemplate: string): HandoffStartResult {
    if (this.active !== undefined) return { accepted: false, reason: "active", handoff: snapshot(this.active) };
    const sourceSessionPath = ctx.sessionManager.getSessionFile();
    if (sourceSessionPath === undefined) return { accepted: false, reason: "unpersisted" };
    const active: ActiveHandoff = {
      id: this.options.createHandoffId?.() ?? `handoff-${randomUUID()}`, source, sourceSessionPath,
      phase: "waiting", deferPromptsFrom: this.options.deferPromptsFrom ?? "writing", callTemplate,
      instructionSent: false, emergencySent: false, transitionDispatched: false,
    };
    this.active = active;
    if (active.deferPromptsFrom === "request") this.beginDeferral(active);
    this.changed(ctx);
    return { accepted: true, handoff: snapshot(active) };
  }
  templateReturned(id: string, ctx: ExtensionContext): string | undefined {
    const active = this.active;
    if (active?.id !== id || active.phase === "ready") throw new Error("Handoff template request is no longer current");
    if (active.phase === "writing") return;
    // Early GET may precede the settled request message. Return that instruction
    // inline with GET, preserving its Call Template without another model run.
    const initialInstruction = this.takeReadinessInstruction(active, ctx);
    this.beginDeferral(active);
    active.phase = "writing";
    this.changed(ctx);
    return initialInstruction;
  }
  acceptFinish(id: string, ctx: ExtensionContext): void {
    const active = this.active;
    if (active?.id !== id || active.phase !== "writing") throw new Error("Finish requires successful template retrieval for the current handoff");
    this.clearReminderTimer(active);
    active.phase = "ready";
    this.changed(ctx);
  }
  handleInput(text: string, source: "interactive" | "rpc" | "extension", _ctx: ExtensionContext): HandoffInputResult {
    if (source === "extension" || this.active?.deferred === undefined) return { action: "continue" };
    return { action: "deferred", snapshot: this.active.deferred.capture(text) };
  }
  escalateReadiness(percent: number | null | undefined, ctx: ExtensionContext): void {
    const active = this.active;
    if (active === undefined || active.phase === "ready" || active.emergencySent || percent == null || percent < 90) return;
    this.clearReminderTimer(active);
    const pendingCallTemplate = active.instructionSent ? undefined : active.callTemplate;
    active.instructionSent = true;
    active.emergencySent = true;
    this.options.onReadinessEmergency(readinessEmergency(percent, pendingCallTemplate), snapshot(active), ctx);
  }
  handleSettled(ctx: ExtensionContext): void {
    const active = this.active;
    if (active === undefined || !ctx.isIdle() || ctx.hasPendingMessages()) return;
    if (active.phase === "ready" && !active.transitionDispatched) {
      active.transitionDispatched = true;
      this.options.onReady(snapshot(active), ctx);
    } else if (active.phase === "waiting" && !active.instructionSent) {
      this.dispatchReadiness(active, ctx);
    }
  }
  cancel(ctx: ExtensionContext): boolean { return this.finish(ctx); }
  finish(ctx: ExtensionContext, handoffId?: string): boolean {
    if (this.active === undefined || (handoffId !== undefined && this.active.id !== handoffId)) return false;
    this.clearReminderTimer(this.active);
    this.active = undefined;
    this.changed(ctx);
    return true;
  }
  invalidate(): void { if (this.active !== undefined) this.clearReminderTimer(this.active); this.active = undefined; }
  private beginDeferral(active: ActiveHandoff): void {
    active.deferred ??= new DeferredPromptWindow(this.options.now?.() ?? new Date(), active.sourceSessionPath);
  }
  private dispatchReadiness(active: ActiveHandoff, ctx: ExtensionContext, allowPending = false): void {
    if (this.active !== active || active.instructionSent || (!allowPending && ctx.hasPendingMessages())) return;
    const prompt = this.takeReadinessInstruction(active, ctx);
    if (prompt !== undefined) this.options.onReadinessPrompt(prompt, snapshot(active), ctx);
  }
  private takeReadinessInstruction(active: ActiveHandoff, ctx: ExtensionContext): string | undefined {
    if (active.instructionSent) return;
    active.instructionSent = true;
    const timer = this.setTimer(() => {
      if (this.active !== active || active.reminderTimer !== timer) return;
      active.reminderTimer = undefined;
      this.options.onReadinessReminder(readinessReminder(), snapshot(active), ctx);
    }, this.options.readinessRetrySeconds * 1000);
    active.reminderTimer = timer;
    return readinessPrompt(active.callTemplate);
  }
  private clearReminderTimer(active: ActiveHandoff): void {
    if (active.reminderTimer === undefined) return;
    this.clearTimer(active.reminderTimer);
    active.reminderTimer = undefined;
  }
  private changed(ctx: ExtensionContext): void { this.options.onPhaseChange?.(this.snapshot, ctx); }
}
export function automaticHandoffEnabled(enabled: boolean, percent: number): boolean { return enabled && percent > 0; }
export function shouldStartAutomaticHandoff(enabled: boolean, threshold: number, percent: number | null | undefined): boolean {
  return automaticHandoffEnabled(enabled, threshold) && percent != null && percent >= threshold;
}
function snapshot(active: ActiveHandoff): ActiveHandoffSnapshot {
  const { id, source, sourceSessionPath, phase, deferPromptsFrom } = active;
  return { id, source, sourceSessionPath, phase, deferPromptsFrom };
}
