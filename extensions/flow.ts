import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DeferredPromptWindow, type DeferredPromptSnapshot } from "./deferred.ts";
import { createReadinessKey, readinessPrompt, readinessReminder } from "./readiness.ts";

export type ExplicitHandoffStartSource = "command" | "tool";
export type HandoffStartSource = ExplicitHandoffStartSource | "automatic";
export type HandoffFlowPhase = "inactive" | "waiting" | "user-input-required" | "ready";

export interface ActiveHandoffSnapshot {
  id: string;
  source: HandoffStartSource;
  sourceSessionPath: string;
  phase: Exclude<HandoffFlowPhase, "inactive">;
  readinessKey: string;
  awaitingUserGo: boolean;
}

export type HandoffStartResult =
  | { accepted: true; handoff: ActiveHandoffSnapshot }
  | { accepted: false; reason: "active" | "unpersisted"; handoff?: ActiveHandoffSnapshot };

export type HandoffInputResult =
  | { action: "continue" }
  | { action: "deferred"; snapshot: DeferredPromptSnapshot };

export type HandoffGoResult = "accepted" | "stale" | "not-started";
export type HandoffDeferralResult = HandoffGoResult | "automatic" | "selection-open";
export type HandoffDeferralChoice = "Ready" | "Wait" | "Cancel";

export interface HandoffFlowOptions {
  readinessRetrySeconds: number;
  callTemplate: string;
  onReadinessPrompt(prompt: string, handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onReadinessReminder(prompt: string, handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onReady(handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onPhaseChange?(handoff: ActiveHandoffSnapshot | undefined, ctx: ExtensionContext): void;
  createHandoffId?: () => string;
  createReadinessKey?: () => string;
  setTimer?: (callback: () => void, delayMilliseconds: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  now?: () => Date;
}

interface ActiveHandoff {
  id: string;
  source: HandoffStartSource;
  sourceSessionPath: string;
  phase: Exclude<HandoffFlowPhase, "inactive">;
  readinessKey: string;
  awaitingUserGo: boolean;
  callTemplate: string;
  instructionSent: boolean;
  writerDispatched: boolean;
  reminderTimer?: unknown;
  deferred?: DeferredPromptWindow;
}

export class HandoffFlow {
  private active?: ActiveHandoff;
  private readonly options: HandoffFlowOptions;
  private readonly createHandoffId: () => string;
  private readonly makeReadinessKey: () => string;
  private readonly setTimer: (callback: () => void, delayMilliseconds: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly now: () => Date;

  constructor(options: HandoffFlowOptions) {
    this.options = options;
    this.createHandoffId = options.createHandoffId ?? (() => randomHandoffId());
    this.makeReadinessKey = options.createReadinessKey ?? createReadinessKey;
    this.setTimer = options.setTimer ?? ((callback, delay) => {
      const timer = setTimeout(callback, delay);
      timer.unref();
      return timer;
    });
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.now = options.now ?? (() => new Date());
  }

  get phase(): HandoffFlowPhase {
    return this.active?.phase ?? "inactive";
  }

  get snapshot(): ActiveHandoffSnapshot | undefined {
    return this.active === undefined ? undefined : snapshot(this.active);
  }

  get deferredSnapshot(): DeferredPromptSnapshot | undefined {
    return this.active?.deferred?.snapshot;
  }

  get isTransferProtected(): boolean {
    return this.active?.phase === "ready";
  }

  start(
    ctx: ExtensionContext,
    source: ExplicitHandoffStartSource,
    callTemplate = this.options.callTemplate,
  ): HandoffStartResult {
    const result = this.createHandoff(ctx, source, callTemplate);
    if (result.accepted && this.active !== undefined && ctx.isIdle() && !ctx.hasPendingMessages()) {
      this.dispatchReadiness(this.active, ctx);
    }
    return result;
  }

  startAutomaticAtTurnBoundary(
    ctx: ExtensionContext,
    callTemplate = this.options.callTemplate,
  ): HandoffStartResult {
    const result = this.createHandoff(ctx, "automatic", callTemplate);
    if (result.accepted && this.active !== undefined) {
      this.dispatchReadiness(this.active, ctx, true);
    }
    return result;
  }

  private createHandoff(
    ctx: ExtensionContext,
    source: HandoffStartSource,
    callTemplate: string,
  ): HandoffStartResult {
    if (this.active !== undefined) {
      return { accepted: false, reason: "active", handoff: snapshot(this.active) };
    }

    const sourceSessionPath = ctx.sessionManager.getSessionFile();
    if (sourceSessionPath === undefined) {
      return { accepted: false, reason: "unpersisted" };
    }

    this.active = {
      id: this.createHandoffId(),
      source,
      sourceSessionPath,
      phase: "waiting",
      readinessKey: this.makeReadinessKey(),
      awaitingUserGo: false,
      callTemplate,
      instructionSent: false,
      writerDispatched: false,
    };
    this.changed(ctx);
    return { accepted: true, handoff: snapshot(this.active) };
  }

  acceptGo(key: string, ctx: ExtensionContext): HandoffGoResult {
    const active = this.correlated(key);
    if (active === undefined) return this.active === undefined ? "not-started" : "stale";
    if (!active.instructionSent || active.phase === "ready" || active.phase === "user-input-required") return "stale";

    this.accept(active, ctx);
    return "accepted";
  }

  beginUserDeferral(key: string, ctx: ExtensionContext): HandoffDeferralResult {
    const active = this.correlated(key);
    if (active === undefined) return this.active === undefined ? "not-started" : "stale";
    if (!active.instructionSent || active.phase === "ready" || active.awaitingUserGo) return "stale";
    if (active.source === "automatic") return "automatic";
    if (active.phase === "user-input-required") return "selection-open";

    this.clearReminderTimer(active);
    active.phase = "user-input-required";
    this.changed(ctx);
    return "accepted";
  }

  resolveUserDeferral(key: string, choice: HandoffDeferralChoice, ctx: ExtensionContext): HandoffDeferralResult {
    const active = this.correlated(key);
    if (active === undefined) return this.active === undefined ? "not-started" : "stale";
    if (active.phase !== "user-input-required") return "stale";

    if (choice === "Ready") {
      this.accept(active, ctx);
    } else if (choice === "Wait") {
      active.phase = "waiting";
      active.awaitingUserGo = true;
      this.changed(ctx);
    } else {
      this.finish(ctx, active.id);
    }
    return "accepted";
  }

  handleInput(
    text: string,
    source: "interactive" | "rpc" | "extension",
    _ctx: ExtensionContext,
  ): HandoffInputResult {
    if (source === "extension" || this.active === undefined || this.active.phase !== "ready") {
      return { action: "continue" };
    }

    const deferred = this.active.deferred;
    if (deferred === undefined) throw new Error("Deferred-prompt window is unavailable after accepted GO");
    return { action: "deferred", snapshot: deferred.capture(text) };
  }

  handleSettled(ctx: ExtensionContext): void {
    const active = this.active;
    if (active === undefined || !ctx.isIdle() || ctx.hasPendingMessages()) return;

    if (!active.instructionSent) {
      this.dispatchReadiness(active, ctx);
    } else if (active.phase === "ready" && !active.writerDispatched) {
      active.writerDispatched = true;
      this.options.onReady(snapshot(active), ctx);
    }
  }

  cancel(ctx: ExtensionContext): boolean {
    return this.finish(ctx);
  }

  finish(ctx: ExtensionContext, handoffId?: string): boolean {
    if (this.active === undefined || (handoffId !== undefined && this.active.id !== handoffId)) return false;
    this.clearReminderTimer(this.active);
    this.active = undefined;
    this.options.onPhaseChange?.(undefined, ctx);
    return true;
  }

  invalidate(): void {
    if (this.active !== undefined) this.clearReminderTimer(this.active);
    this.active = undefined;
  }

  private correlated(key: string): ActiveHandoff | undefined {
    return this.active?.readinessKey === key ? this.active : undefined;
  }

  private accept(active: ActiveHandoff, ctx: ExtensionContext): void {
    this.clearReminderTimer(active);
    active.deferred = new DeferredPromptWindow(this.now(), active.sourceSessionPath);
    active.phase = "ready";
    active.awaitingUserGo = false;
    this.changed(ctx);
  }

  private dispatchReadiness(
    active: ActiveHandoff,
    ctx: ExtensionContext,
    allowPendingMessages = false,
  ): void {
    if (this.active !== active || active.instructionSent || (!allowPendingMessages && ctx.hasPendingMessages())) return;
    active.instructionSent = true;
    this.changed(ctx);
    this.options.onReadinessPrompt(
      readinessPrompt(
        active.callTemplate,
        active.readinessKey,
        active.source !== "automatic",
      ),
      snapshot(active),
      ctx,
    );
    this.scheduleReminder(active, ctx);
  }

  private scheduleReminder(active: ActiveHandoff, ctx: ExtensionContext): void {
    const timer = this.setTimer(() => {
      if (this.active !== active || active.reminderTimer !== timer) return;
      active.reminderTimer = undefined;
      this.options.onReadinessReminder(
        readinessReminder(active.readinessKey, active.source !== "automatic"),
        snapshot(active),
        ctx,
      );
    }, this.options.readinessRetrySeconds * 1000);
    active.reminderTimer = timer;
  }

  private clearReminderTimer(active: ActiveHandoff): void {
    if (active.reminderTimer === undefined) return;
    this.clearTimer(active.reminderTimer);
    active.reminderTimer = undefined;
  }

  private changed(ctx: ExtensionContext): void {
    this.options.onPhaseChange?.(this.snapshot, ctx);
  }
}

export function automaticHandoffEnabled(
  automaticSessionHandoff: boolean,
  automaticSessionHandoffPercent: number,
): boolean {
  return automaticSessionHandoff && automaticSessionHandoffPercent > 0;
}

export function shouldStartAutomaticHandoff(
  automaticSessionHandoff: boolean,
  automaticSessionHandoffPercent: number,
  contextPercent: number | null | undefined,
): boolean {
  return (
    automaticHandoffEnabled(automaticSessionHandoff, automaticSessionHandoffPercent) &&
    contextPercent !== null &&
    contextPercent !== undefined &&
    contextPercent >= automaticSessionHandoffPercent
  );
}

function snapshot(active: ActiveHandoff): ActiveHandoffSnapshot {
  return {
    id: active.id,
    source: active.source,
    sourceSessionPath: active.sourceSessionPath,
    phase: active.phase,
    readinessKey: active.readinessKey,
    awaitingUserGo: active.awaitingUserGo,
  };
}

function randomHandoffId(): string {
  return createReadinessKey().replace(/^handoff-go-/, "handoff-");
}
