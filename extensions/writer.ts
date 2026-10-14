import { randomUUID } from "node:crypto";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { ActiveHandoffSnapshot } from "./flow.ts";
import { createHandoffFile } from "./handoff-file.ts";
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
  handoffFile: string;
}

export interface PreparedHandoff {
  submissionId: string;
  handoffFile: string;
  template: ResolvedTemplate;
  templateReturned: boolean;
}

export interface HandoffWriterOptions {
  writerAttempts: number;
  writerRetryDelaySeconds: number;
  runtime: WriterRuntime;
  resolveTemplate(selectedFilename?: string): Promise<ResolvedTemplate>;
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
  handoffFile?: string;
  retryTimer?: unknown;
  attemptToken?: object;
  acceptingSubmission: boolean;
  templateFilename?: string;
  preparation?: Promise<PreparedHandoff>;
}

export class HandoffWriter {
  private active?: ActiveWriter;
  private preparation?: { handoffId: string; result: Promise<PreparedHandoff> };
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

  configure(writerAttempts: number, writerRetryDelaySeconds: number): void {
    if (this.active !== undefined) {
      throw new Error("Writer configuration cannot change while a handoff writer is active");
    }
    this.options.writerAttempts = writerAttempts;
    this.options.writerRetryDelaySeconds = writerRetryDelaySeconds;
  }

  prepare(handoff: ActiveHandoffSnapshot, ctx: ExtensionContext, templateFilename?: string): Promise<PreparedHandoff> {
    if (this.active !== undefined) throw new Error("Template preparation is available only before GO");
    if (this.preparation?.handoffId === handoff.id) return this.preparation.result;

    const result: Promise<PreparedHandoff> = this.options.resolveTemplate(templateFilename).then((template) => {
      if (this.preparation?.result !== result) throw new Error("Handoff preparation was cancelled");
      const submissionId = this.createSubmissionId();
      const handoffFile = createHandoffFile(ctx.cwd, ctx.sessionManager.getSessionId());
      for (const failure of template.failures) this.options.onTemplateFailure?.(failure, 0, ctx);
      return { submissionId, handoffFile, template, templateReturned: false };
    }).catch((error: unknown) => {
      if (this.preparation?.result === result) this.preparation = undefined;
      throw error;
    });
    this.preparation = { handoffId: handoff.id, result };
    return result;
  }

  start(
    handoff: ActiveHandoffSnapshot,
    ctx: ExtensionContext,
    templateFilename?: string,
  ): boolean {
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
      templateFilename,
      preparation: this.preparation?.handoffId === handoff.id ? this.preparation.result : undefined,
    };
    this.active = active;

    try {
      this.options.runtime.setActiveTools(["read", "write", "edit", SUBMIT_SESSION_HANDOFF_TOOL]);
      if (!this.options.runtime.getActiveTools().includes("write")) {
        throw new Error("File handoff requires Pi's native write tool");
      }
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
    if (active.submission !== undefined && active.handoffFile !== undefined) {
      const result: WriterSuccess = {
        handoff: active.handoff,
        attempt: active.attempt,
        submission: { ...active.submission },
        handoffFile: active.handoffFile,
      };
      if (this.terminate(active, "succeeded")) {
        this.options.onSuccess?.(result, ctx);
      }
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
    if (active === undefined) {
      this.preparation = undefined;
      return false;
    }
    const shouldAbort = !ctx.isIdle();
    this.terminate(active, "cancelled", "Session handoff writer cancelled.");
    if (shouldAbort) ctx.abort();
    return true;
  }

  invalidate(): void {
    this.preparation = undefined;
    const active = this.active;
    if (active !== undefined) {
      this.terminate(active, "cancelled", "Session handoff writer invalidated.");
    }
  }

  private beginAttempt(active: ActiveWriter): void {
    if (this.active !== active) return;
    active.attempt += 1;
    active.submissionId = undefined;
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
      const prepared = active.preparation === undefined ? undefined : await active.preparation;
      if (!this.isCurrentAttempt(active, attemptToken)) return;
      if (prepared?.templateReturned) {
        template = prepared.template;
        active.submissionId = active.attempt === 1 ? prepared.submissionId : this.createSubmissionId();
      } else {
        // A failed/aborted GET reserved a file but never returned its template.
        // Reuse that reservation while taking the normal fresh-template writer path.
        active.preparation = undefined;
        template = await this.options.resolveTemplate(active.templateFilename);
        if (!this.isCurrentAttempt(active, attemptToken)) return;
        active.submissionId = this.createSubmissionId();
      }
      active.handoffFile ??= prepared?.handoffFile ?? createHandoffFile(active.ctx.cwd, active.ctx.sessionManager.getSessionId());
    } catch (error) {
      if (!this.isCurrentAttempt(active, attemptToken)) return;
      this.terminate(active, "failed", `Could not prepare the handoff writer: ${errorMessage(error)}`);
      return;
    }

    if (!this.isCurrentAttempt(active, attemptToken)) return;
    if (active.preparation === undefined) {
      for (const failure of template.failures) this.options.onTemplateFailure?.(failure, active.attempt, active.ctx);
    }

    const submissionId = active.submissionId;
    if (submissionId === undefined) return;
    active.acceptingSubmission = true;
    this.changePhase("writing", active);
    try {
      this.options.runtime.sendUserMessage(
        writerPrompt(active.preparation === undefined ? template.content : undefined, submissionId, active.handoff.sourceSessionPath, active.handoffFile),
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

  private terminate(active: ActiveWriter, reason: WriterTerminalReason, message?: string): boolean {
    if (this.active !== active) return false;
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
    this.preparation = undefined;
    const terminalReason = reason === "succeeded" && restorationFailure !== undefined ? "failed" : reason;
    this.currentPhase = terminalReason;
    this.options.onPhaseChange?.(terminalReason, active.attempt, active.ctx);

    if (terminalReason !== "succeeded") {
      const detail = [message, restorationFailure].filter((part): part is string => part !== undefined).join(" ");
      this.options.onTerminalFailure?.(terminalReason, detail, active.ctx);
    }
    return terminalReason === "succeeded";
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

export function preparationPrompt(prepared: PreparedHandoff, sourceSessionPath: string): string {
  return [
    "Speed Mode preparation only: GO has not been accepted. Continue required source work and reach its genuine boundary; do not let drafting delay that work. Use real waiting time to draft if useful.",
    `Use this exact submission ID after GO: ${prepared.submissionId}`,
    `The persisted source-session transcript path is exactly: ${sourceSessionPath}`,
    `Write the complete handoff Markdown to this exact file: ${JSON.stringify(prepared.handoffFile)}`,
    "Keep the template and file path for this handoff. At the boundary call the correlated GO tool, then wait for the short finalization instruction. GO and DONE are separate: GO starts prompt deferral, DONE confirms the completed file. Never submit before GO.",
    "Before DONE, read and update your draft with all current results, facts, permissions and the precise next action. The extension does not check those semantics. Submit only the ID with submit_session_handoff; never send file content or a path to that tool.",
    "--- BEGIN COMPLETE HANDOFF TEMPLATE ---",
    prepared.template.content,
    "--- END COMPLETE HANDOFF TEMPLATE ---",
  ].join("\n\n");
}

export function writerPrompt(template: string | undefined, submissionId: string, sourceSessionPath: string, handoffFile: string): string {
  return [
    "This is an extension-owned writer turn. Perform no source-task work during this turn; only write the session handoff and submit it exactly once with submit_session_handoff. This writer-only control is not a user instruction or continuation constraint. Do not include or preserve it in the handoff.",
    `Use this exact submission ID: ${submissionId}`,
    `The persisted source-session transcript path is exactly: ${sourceSessionPath}`,
    `Write the complete handoff Markdown to this exact file: ${JSON.stringify(handoffFile)}`,
    template === undefined
      ? "GO has been accepted. Use your previously retrieved template: read and finalize the prepared file with all current results, facts, permissions and the precise next action. Preserve useful draft content and update it with Pi's native read/write/edit tools. No template is resent. Submit DONE only when the file is complete. Do not write other files or perform source-task work."
      : "GO has been accepted. Use Pi's native write tool, and read/edit for incremental writing if needed. Start this attempt by replacing any previous partial content; finish the complete file before submitting DONE. Do not write other files or perform source-task work.",
    "The file is the transport. Call submit_session_handoff with only the exact submission ID, never the dossier content or a file path. This file-based submission protocol replaces any older template instruction to submit the handoff content.",
    ...(template === undefined ? [] : [
      "Use the complete template below for the dossier semantics and structure.",
      "--- BEGIN COMPLETE HANDOFF TEMPLATE ---",
      template,
      "--- END COMPLETE HANDOFF TEMPLATE ---",
    ]),
  ].join("\n\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
