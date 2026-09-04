import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { DeferredPromptWindow, type DeferredPromptSnapshot } from "./deferred.ts";
import {
  classifyReadinessAnswer,
  createReadinessIdentifiers,
  readinessPrompt,
  type ReadinessIdentifiers,
} from "./readiness.ts";

export type HandoffStartSource = "command" | "tool" | "automatic";
export type HandoffFlowPhase = "inactive" | "waiting" | "checking" | "retry-delay" | "ready";

export interface ActiveHandoffSnapshot {
  id: string;
  source: HandoffStartSource;
  sourceSessionPath: string;
  phase: Exclude<HandoffFlowPhase, "inactive">;
  readinessIds?: ReadinessIdentifiers;
}

export type HandoffStartResult =
  | { accepted: true; handoff: ActiveHandoffSnapshot }
  | { accepted: false; reason: "active" | "unpersisted"; handoff?: ActiveHandoffSnapshot };

export type HandoffInputResult =
  | { action: "continue" }
  | { action: "deferred"; snapshot: DeferredPromptSnapshot };

export interface HandoffFlowOptions {
  readinessRetrySeconds: number;
  onReadinessPrompt(prompt: string, handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onReady(handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): void;
  onPhaseChange?(handoff: ActiveHandoffSnapshot | undefined, ctx: ExtensionContext): void;
  createHandoffId?: () => string;
  createIdentifiers?: () => ReadinessIdentifiers;
  setTimer?: (callback: () => void, delayMilliseconds: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  now?: () => Date;
}

interface ActiveHandoff {
  id: string;
  source: HandoffStartSource;
  sourceSessionPath: string;
  phase: Exclude<HandoffFlowPhase, "inactive">;
  readinessIds?: ReadinessIdentifiers;
  answer?: string;
  retryTimer?: unknown;
  deferred?: DeferredPromptWindow;
}

export class HandoffFlow {
  private active?: ActiveHandoff;
  private readonly options: HandoffFlowOptions;
  private readonly createHandoffId: () => string;
  private readonly createIdentifiers: () => ReadinessIdentifiers;
  private readonly setTimer: (callback: () => void, delayMilliseconds: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly now: () => Date;

  constructor(options: HandoffFlowOptions) {
    this.options = options;
    this.createHandoffId = options.createHandoffId ?? (() => createReadinessIdentifiers().go);
    this.createIdentifiers = options.createIdentifiers ?? createReadinessIdentifiers;
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
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

  start(ctx: ExtensionContext, source: HandoffStartSource): HandoffStartResult {
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
    };
    this.changed(ctx);

    if (ctx.isIdle() && !ctx.hasPendingMessages()) {
      this.dispatchReadiness(this.active, ctx);
    }

    return { accepted: true, handoff: snapshot(this.active) };
  }

  handleAssistantAnswer(answer: string | undefined): void {
    if (this.active?.phase === "checking") {
      this.active.answer = answer;
    }
  }

  handleInput(
    text: string,
    source: "interactive" | "rpc" | "extension",
    ctx: ExtensionContext,
  ): HandoffInputResult {
    if (source === "extension" || this.active === undefined) {
      return { action: "continue" };
    }

    if (this.active.phase === "ready") {
      const deferred = this.active.deferred;
      if (deferred === undefined) {
        throw new Error("Deferred-prompt window is unavailable after accepted readiness");
      }
      return { action: "deferred", snapshot: deferred.capture(text) };
    }

    this.clearRetryTimer(this.active);
    this.active.readinessIds = undefined;
    this.active.answer = undefined;
    this.active.phase = "waiting";
    this.changed(ctx);
    return { action: "continue" };
  }

  handleSettled(ctx: ExtensionContext): void {
    const active = this.active;
    if (active === undefined || active.phase === "ready" || active.phase === "retry-delay") return;
    if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

    if (active.phase === "waiting") {
      this.dispatchReadiness(active, ctx);
      return;
    }

    const ids = active.readinessIds;
    if (ids !== undefined && classifyReadinessAnswer(active.answer, ids) === "go") {
      active.readinessIds = undefined;
      active.answer = undefined;
      active.deferred = new DeferredPromptWindow(this.now(), active.sourceSessionPath);
      active.phase = "ready";
      this.changed(ctx);
      this.options.onReady(snapshot(active), ctx);
      return;
    }

    active.readinessIds = undefined;
    active.answer = undefined;
    active.phase = "retry-delay";
    this.changed(ctx);
    this.replaceRetryTimer(active, ctx);
  }

  cancel(ctx: ExtensionContext): boolean {
    return this.finish(ctx);
  }

  finish(ctx: ExtensionContext, handoffId?: string): boolean {
    if (this.active === undefined || (handoffId !== undefined && this.active.id !== handoffId)) return false;
    this.clearRetryTimer(this.active);
    this.active = undefined;
    this.options.onPhaseChange?.(undefined, ctx);
    return true;
  }

  invalidate(): void {
    if (this.active !== undefined) this.clearRetryTimer(this.active);
    this.active = undefined;
  }

  private dispatchReadiness(active: ActiveHandoff, ctx: ExtensionContext): void {
    if (this.active !== active || ctx.hasPendingMessages()) return;
    const ids = this.createIdentifiers();
    active.readinessIds = ids;
    active.answer = undefined;
    active.phase = "checking";
    this.changed(ctx);
    this.options.onReadinessPrompt(readinessPrompt(ids), snapshot(active), ctx);
  }

  private replaceRetryTimer(active: ActiveHandoff, ctx: ExtensionContext): void {
    this.clearRetryTimer(active);
    const handoffId = active.id;
    const timer = this.setTimer(() => {
      if (this.active !== active || active.id !== handoffId || active.retryTimer !== timer) return;
      active.retryTimer = undefined;
      if (ctx.isIdle() && !ctx.hasPendingMessages()) {
        this.dispatchReadiness(active, ctx);
      } else {
        active.phase = "waiting";
        this.changed(ctx);
      }
    }, this.options.readinessRetrySeconds * 1000);
    active.retryTimer = timer;
  }

  private clearRetryTimer(active: ActiveHandoff): void {
    if (active.retryTimer === undefined) return;
    this.clearTimer(active.retryTimer);
    active.retryTimer = undefined;
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
    ...(active.readinessIds === undefined ? {} : { readinessIds: { ...active.readinessIds } }),
  };
}
