import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ActiveHandoffSnapshot } from "./flow.ts";
import { createHandoffFile } from "./handoff-file.ts";
import { validateSubmission, type SessionHandoffSubmission } from "./submission-tool.ts";
import type { ResolvedTemplate, TemplateFailure } from "./templates.ts";

export interface WriterRuntime { getActiveTools(): string[]; }
export interface WriterSuccess {
  handoff: ActiveHandoffSnapshot;
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
  runtime: WriterRuntime;
  resolveTemplate(selectedFilename?: string): Promise<ResolvedTemplate>;
  onTemplateFailure?(failure: TemplateFailure, ctx: ExtensionContext): void;
  onSuccess?(result: WriterSuccess, ctx: ExtensionContext): void;
  onCancellationComplete?(succeeded: boolean, ctx: ExtensionContext): void;
  createSubmissionId?: () => string;
}
interface Retrieval {
  handoff: ActiveHandoffSnapshot;
  result: Promise<PreparedHandoff>;
  prepared?: PreparedHandoff;
  accepted?: SessionHandoffSubmission;
  dispatched: boolean;
}

// Owns only retrieval correlation and the exact reservation. Drafting is the
// source model's work with its unchanged tools, not a separate model round.
export class HandoffWriter {
  private retrieval?: Retrieval;
  private reservedFile?: string;
  private cancellation?: { ctx: ExtensionContext };
  private readonly options: HandoffWriterOptions;
  constructor(options: HandoffWriterOptions) { this.options = options; }
  get isActive(): boolean { return this.retrieval !== undefined || this.cancellation !== undefined; }
  get cancellationPending(): boolean { return this.cancellation !== undefined; }

  prepare(handoff: ActiveHandoffSnapshot, ctx: ExtensionContext, filename?: string): Promise<PreparedHandoff> {
    if (this.cancellation !== undefined) throw new Error("Handoff cancellation cleanup is pending");
    if (this.retrieval?.handoff.id === handoff.id) {
      if (this.retrieval.accepted !== undefined) throw new Error("Finish has already been accepted");
      return this.retrieval.result;
    }
    if (this.retrieval !== undefined) throw new Error("Another handoff retrieval is active");
    if (!this.options.runtime.getActiveTools().includes("write")) throw new Error("File handoff requires Pi's native write tool");
    const retrieval: Retrieval = { handoff, result: undefined!, dispatched: false };
    this.retrieval = retrieval;
    retrieval.result = this.options.resolveTemplate(filename).then((template) => {
      if (this.retrieval !== retrieval || this.cancellation !== undefined) throw new Error("Handoff template retrieval was cancelled");
      for (const failure of template.failures) this.options.onTemplateFailure?.(failure, ctx);
      // No async gap between the invalidation check and exclusive reservation.
      const handoffFile = this.reservedFile ?? createHandoffFile(ctx.cwd, ctx.sessionManager.getSessionId());
      this.reservedFile = handoffFile;
      const prepared = {
        submissionId: this.options.createSubmissionId?.() ?? `handoff-finish-${randomUUID()}`,
        handoffFile, template, templateReturned: false,
      };
      retrieval.prepared = prepared;
      return prepared;
    }).catch((error: unknown) => {
      if (this.retrieval === retrieval) this.retrieval = undefined;
      throw error;
    });
    return retrieval.result;
  }
  returned(prepared: PreparedHandoff): void {
    if (this.cancellation !== undefined || this.retrieval?.prepared !== prepared || this.retrieval.accepted !== undefined) {
      throw new Error("Handoff template request is no longer current");
    }
    prepared.templateReturned = true;
  }
  submit(submission: SessionHandoffSubmission): void {
    const retrieval = this.retrieval;
    if (this.cancellation !== undefined || !retrieval?.prepared?.templateReturned) throw new Error("Finish requires successful template retrieval for the current handoff");
    if (retrieval.accepted !== undefined) throw new Error("Finish has already been accepted");
    const invalid = validateSubmission(submission, retrieval.prepared.submissionId);
    if (invalid !== undefined) throw new Error(invalid);
    retrieval.accepted = { ...submission };
  }
  handleSettled(ctx: ExtensionContext): void {
    if (this.cancellation !== undefined) { this.finalizeCancellation(ctx); return; }
    const retrieval = this.retrieval;
    if (retrieval?.accepted === undefined || retrieval.prepared === undefined || retrieval.dispatched || !ctx.isIdle() || ctx.hasPendingMessages()) return;
    retrieval.dispatched = true;
    this.options.onSuccess?.({ handoff: retrieval.handoff, submission: retrieval.accepted, handoffFile: retrieval.prepared.handoffFile }, ctx);
  }
  beginCancellation(ctx: ExtensionContext): boolean {
    if (this.cancellation !== undefined) return true;
    if (this.retrieval === undefined && this.reservedFile === undefined) return false;
    this.cancellation = { ctx };
    this.retrieval = undefined; // Invalidate async retrieval and Finish before waiting.
    return true; // Never abort unrelated source work.
  }
  finalizeCancellation(ctx: ExtensionContext): boolean {
    const cancellation = this.cancellation;
    if (cancellation === undefined || !ctx.isIdle()) return false;
    let succeeded = true;
    if (this.reservedFile !== undefined) {
      try { rmSync(this.reservedFile, { force: true }); }
      catch (error) {
        succeeded = false;
        cancellation.ctx.ui.notify(`Could not remove reserved handoff file ${this.reservedFile}: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    }
    this.reservedFile = undefined;
    this.cancellation = undefined;
    this.options.onCancellationComplete?.(succeeded, cancellation.ctx);
    return true;
  }
  cancel(ctx: ExtensionContext): boolean { const cancelled = this.beginCancellation(ctx); this.finalizeCancellation(ctx); return cancelled; }
  invalidate(): void { this.retrieval = undefined; this.reservedFile = undefined; this.cancellation = undefined; }
}
export function preparationPrompt(prepared: PreparedHandoff, sourceSessionPath: string): string {
  return [
    `Use this exact Finish ID: ${prepared.submissionId}`,
    `The persisted source-session transcript path is exactly: ${sourceSessionPath}`,
    `Write the complete handoff Markdown to this exact file: ${JSON.stringify(prepared.handoffFile)}`,
    "Draft early if useful, using your existing tools. At the next safe checkpoint, refresh all consequential facts, results, permissions and the precise next action, then call session_handoff_finish({id}) once with the exact Finish ID. Send no content or path. Safe-checkpoint judgment and semantic completeness are your responsibility; the extension checks file metadata, not those semantics.",
    "--- BEGIN COMPLETE HANDOFF TEMPLATE ---", prepared.template.content, "--- END COMPLETE HANDOFF TEMPLATE ---",
  ].join("\n\n");
}
