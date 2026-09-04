import { randomUUID } from "node:crypto";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { ActiveHandoffSnapshot } from "./flow.ts";
import {
  SUBMIT_SESSION_HANDOFF_TOOL,
  validateSubmission,
  type SessionHandoffSubmission,
} from "./submission-tool.ts";
import type { ResolvedTemplate, TemplateFailure } from "./templates.ts";

export type WriterPhase =
  | "inactive"
  | "resolving"
  | "writing"
  | "retry-delay"
  | "succeeded"
  | "cancelled"
  | "exhausted"
  | "failed";

export type WriterTerminalReason = "succeeded" | "cancelled" | "exhausted" | "failed";

export interface WriterRuntime {
  getActiveTools(): string[];
  setActiveTools(toolNames: string[]): void;
  sendUserMessage(content: string): void;
}

export interface WriterSuccess {
  handoff: ActiveHandoffSnapshot;
  attempt: number;
  submission: SessionHandoffSubmission;
}

export interface HandoffWriterOptions {
  writerAttempts: number;
  writerRetryDelaySeconds: number;
  runtime: WriterRuntime;
  resolveTemplate(): Promise<ResolvedTemplate>;
  onTemplateFailure?(failure: TemplateFailure, attempt: number, ctx: ExtensionContext): void;
  onPhaseChange?(phase: WriterPhase, attempt: number, ctx: ExtensionContext): void;
  onSuccess?(result: WriterSuccess, ctx: ExtensionContext): void;
  onTerminalFailure?(reason: Exclude<WriterTerminalReason, "succeeded">, message: string, ctx: ExtensionContext): void;
  createSubmissionId?: () => string;
  setTimer?: (callback: () => void, delayMilliseconds: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

interface ActiveWriter {
  handoff: ActiveHandoffSnapshot;
  ctx: ExtensionContext;
  savedTools: string[];
  attempt: number;
  submissionId?: string;
  submission?: SessionHandoffSubmission;
  retryTimer?: unknown;
  attemptToken?: object;
  acceptingSubmission: boolean;
}

export class HandoffWriter {
  private active?: ActiveWriter;
  private currentPhase: WriterPhase = "inactive";
  private readonly options: HandoffWriterOptions;
  private readonly createSubmissionId: () => string;
  private readonly setTimer: (callback: () => void, delayMilliseconds: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(options: HandoffWriterOptions) {
    this.options = options;
    this.createSubmissionId = options.createSubmissionId ?? (() => `handoff-submission-${randomUUID()}`);
    this.setTimer = options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  get phase(): WriterPhase {
    return this.currentPhase;
  }

  get isActive(): boolean {
    return this.active !== undefined;
  }

  get attempt(): number {
    return this.active?.attempt ?? 0;
  }

  start(handoff: ActiveHandoffSnapshot, ctx: ExtensionContext): boolean {
    if (this.active !== undefined) return false;

    let savedTools: string[];
    try {
      savedTools = [...this.options.runtime.getActiveTools()];
    } catch (error) {
      this.currentPhase = "failed";
      this.options.onTerminalFailure?.("failed", `Could not save the active tool list: ${errorMessage(error)}`, ctx);
      return false;
    }

    const active: ActiveWriter = {
      handoff,
      ctx,
      savedTools,
      attempt: 0,
      acceptingSubmission: false,
    };
    this.active = active;

    try {
      this.options.runtime.setActiveTools([SUBMIT_SESSION_HANDOFF_TOOL]);
    } catch (error) {
      this.terminate(active, "failed", `Could not isolate the writer tool: ${errorMessage(error)}`);
      return false;
    }

    this.beginAttempt(active);
    return true;
  }

  submit(submission: SessionHandoffSubmission): void {
    const active = this.active;
    if (!active?.acceptingSubmission || active.submissionId === undefined) {
      throw new Error("No current writer submission is being accepted");
    }
    if (active.submission !== undefined) {
      throw new Error("A session handoff has already been accepted for this writer attempt");
    }

    const invalid = validateSubmission(submission, active.submissionId);
    if (invalid !== undefined) throw new Error(invalid);
    active.submission = { ...submission };
  }

  handleSettled(ctx: ExtensionContext): void {
    const active = this.active;
    if (active === undefined || this.currentPhase !== "writing") return;
    if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

    active.acceptingSubmission = false;
    if (active.submission !== undefined) {
      const result: WriterSuccess = {
        handoff: active.handoff,
        attempt: active.attempt,
        submission: { ...active.submission },
      };
      this.terminate(active, "succeeded");
      this.options.onSuccess?.(result, ctx);
      return;
    }

    if (active.attempt >= this.options.writerAttempts) {
      this.terminate(
        active,
        "exhausted",
        `Session handoff writer exhausted ${this.options.writerAttempts} attempt${this.options.writerAttempts === 1 ? "" : "s"} without a valid submission.`,
      );
      return;
    }

    this.changePhase("retry-delay", active);
    this.replaceRetryTimer(active);
  }

  cancel(ctx: ExtensionContext): boolean {
    const active = this.active;
    if (active === undefined) return false;
    const shouldAbort = !ctx.isIdle();
    this.terminate(active, "cancelled", "Session handoff writer cancelled.");
    if (shouldAbort) ctx.abort();
    return true;
  }

  invalidate(): void {
    const active = this.active;
    if (active !== undefined) {
      this.terminate(active, "cancelled", "Session handoff writer invalidated.");
    }
  }

  private beginAttempt(active: ActiveWriter): void {
    if (this.active !== active) return;
    active.attempt += 1;
    try {
      active.submissionId = this.createSubmissionId();
    } catch (error) {
      this.terminate(active, "failed", `Could not create a writer submission ID: ${errorMessage(error)}`);
      return;
    }
    active.submission = undefined;
    active.acceptingSubmission = false;
    const attemptToken = {};
    active.attemptToken = attemptToken;
    this.changePhase("resolving", active);

    void this.resolveAndDispatch(active, attemptToken);
  }

  private async resolveAndDispatch(active: ActiveWriter, attemptToken: object): Promise<void> {
    let template: ResolvedTemplate;
    try {
      template = await this.options.resolveTemplate();
    } catch (error) {
      if (!this.isCurrentAttempt(active, attemptToken)) return;
      this.terminate(active, "failed", `Could not resolve a handoff template: ${errorMessage(error)}`);
      return;
    }

    if (!this.isCurrentAttempt(active, attemptToken)) return;
    for (const failure of template.failures) {
      this.options.onTemplateFailure?.(failure, active.attempt, active.ctx);
    }

    const submissionId = active.submissionId;
    if (submissionId === undefined) return;
    active.acceptingSubmission = true;
    this.changePhase("writing", active);
    try {
      this.options.runtime.sendUserMessage(
        writerPrompt(template.content, submissionId, active.handoff.sourceSessionPath),
      );
    } catch (error) {
      active.acceptingSubmission = false;
      if (!this.isCurrentAttempt(active, attemptToken)) return;
      this.terminate(active, "failed", `Could not start the handoff writer: ${errorMessage(error)}`);
    }
  }

  private replaceRetryTimer(active: ActiveWriter): void {
    this.clearRetryTimer(active);
    let timer: unknown;
    try {
      timer = this.setTimer(() => {
        if (this.active !== active || active.retryTimer !== timer) return;
        active.retryTimer = undefined;
        this.beginAttempt(active);
      }, this.options.writerRetryDelaySeconds * 1000);
      active.retryTimer = timer;
    } catch (error) {
      this.terminate(active, "failed", `Could not schedule the next writer attempt: ${errorMessage(error)}`);
    }
  }

  private terminate(active: ActiveWriter, reason: WriterTerminalReason, message?: string): void {
    if (this.active !== active) return;
    this.clearRetryTimer(active);
    active.acceptingSubmission = false;
    active.attemptToken = undefined;

    let restorationFailure: string | undefined;
    try {
      this.restoreTools(active);
    } catch (error) {
      restorationFailure = `Could not restore the active tool list: ${errorMessage(error)}`;
    }

    this.active = undefined;
    this.currentPhase = reason;
    this.options.onPhaseChange?.(reason, active.attempt, active.ctx);

    if (reason !== "succeeded") {
      const detail = [message, restorationFailure].filter((part): part is string => part !== undefined).join(" ");
      this.options.onTerminalFailure?.(reason, detail, active.ctx);
    }
  }

  private restoreTools(active: ActiveWriter): void {
    this.options.runtime.setActiveTools([...active.savedTools]);
  }

  private clearRetryTimer(active: ActiveWriter): void {
    if (active.retryTimer === undefined) return;
    this.clearTimer(active.retryTimer);
    active.retryTimer = undefined;
  }

  private changePhase(phase: WriterPhase, active: ActiveWriter): void {
    if (this.active !== active) return;
    this.currentPhase = phase;
    this.options.onPhaseChange?.(phase, active.attempt, active.ctx);
  }

  private isCurrentAttempt(active: ActiveWriter, attemptToken: object): boolean {
    return this.active === active && active.attemptToken === attemptToken;
  }
}

export function writerPrompt(template: string, submissionId: string, sourceSessionPath: string): string {
  return [
    "Stop all further task work. Write the session handoff now and submit it exactly once with submit_session_handoff.",
    `Use this exact submission ID: ${submissionId}`,
    `The persisted source-session transcript path is exactly: ${sourceSessionPath}`,
    "Use the complete template below as the writer instruction and dossier structure.",
    "--- BEGIN COMPLETE HANDOFF TEMPLATE ---",
    template,
    "--- END COMPLETE HANDOFF TEMPLATE ---",
  ].join("\n\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
