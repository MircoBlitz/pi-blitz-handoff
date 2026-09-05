import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { assembleHandoffMarkdown, type DeferredPromptSnapshot } from "./deferred.ts";
import { deleteRecoveryFile, recoveryFileName } from "./recovery-store.ts";

const PRIVATE_TRANSITION_COMMAND = "__pi_simple_handoff_transition";

type NewSessionOptions = NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>;
type ReplacementContext = NonNullable<NewSessionOptions["withSession"]> extends (
  ctx: infer T,
) => Promise<void> ? T : never;

export type NativeTransitionPhase = "inactive" | "pending" | "replacing";

export interface NativeTransitionRequest {
  handoffId: string;
  sourceSessionPath: string;
  dossier: string;
  startedAt?: number;
}

export interface NativeHandoffTransitionOptions {
  recoveryDirectory: string;
  settleDeferredWrites?(): Promise<void>;
  getDeferredSnapshot(handoffId: string): DeferredPromptSnapshot | undefined;
  onReplacementStarted?(request: NativeTransitionRequest, ctx: ReplacementContext): void;
  onFinished?(request: NativeTransitionRequest, ctx: ReplacementContext): void;
  onFailure?(
    request: NativeTransitionRequest,
    message: string,
    ctx: ExtensionContext,
  ): void;
  createToken?: () => string;
  removeRecoveryFile?: (recoveryDirectory: string, fileName: string) => Promise<void>;
}

interface ActiveTransition extends NativeTransitionRequest {
  token: string;
  phase: Exclude<NativeTransitionPhase, "inactive">;
  allowOwnSwitch: boolean;
}

export class NativeHandoffTransition {
  private active?: ActiveTransition;
  private readonly options: NativeHandoffTransitionOptions;
  private readonly createToken: () => string;
  private readonly removeRecoveryFile: (recoveryDirectory: string, fileName: string) => Promise<void>;

  constructor(options: NativeHandoffTransitionOptions) {
    this.options = options;
    this.createToken = options.createToken ?? (() => randomUUID());
    this.removeRecoveryFile = options.removeRecoveryFile ?? deleteRecoveryFile;
  }

  get phase(): NativeTransitionPhase {
    return this.active?.phase ?? "inactive";
  }

  get isProtected(): boolean {
    return this.active !== undefined;
  }

  prepare(request: NativeTransitionRequest): string | undefined {
    if (this.active !== undefined) return undefined;
    const token = this.createToken();
    this.active = { ...request, token, phase: "pending", allowOwnSwitch: false };
    return token;
  }

  cancel(): "inactive" | "cancelled" | "committed" {
    if (this.active === undefined) return "inactive";
    if (this.active.phase === "replacing") return "committed";
    this.active = undefined;
    return "cancelled";
  }

  invalidate(): void {
    if (this.active?.phase !== "replacing") this.active = undefined;
  }

  allowNativeNewSession(reason: "new" | "resume"): boolean {
    const active = this.active;
    if (
      active === undefined ||
      active.phase !== "replacing" ||
      !active.allowOwnSwitch ||
      reason !== "new"
    ) {
      return false;
    }
    active.allowOwnSwitch = false;
    return true;
  }

  async execute(argumentsText: string, ctx: ExtensionCommandContext): Promise<boolean> {
    const active = this.active;
    if (
      active === undefined ||
      active.phase !== "pending" ||
      argumentsText.trim() !== active.token
    ) {
      ctx.ui.notify("Ignored a stale or uncorrelated session handoff transition request.", "warning");
      return false;
    }

    try {
      await this.options.settleDeferredWrites?.();
    } catch (error) {
      this.fail(
        active,
        `Session handoff replacement failed before native cutover: ${errorMessage(error)} Deferred-prompt recovery remains untouched.`,
        ctx,
      );
      return false;
    }
    if (this.active !== active || active.phase !== "pending") return false;

    const deferred = this.options.getDeferredSnapshot(active.handoffId);
    const prompts = deferred?.prompts ?? [];
    const markdown = assembleHandoffMarkdown(active.dossier, prompts);
    const recoveryFile = deferred !== undefined && prompts.length > 0
      ? recoveryFileName(deferred.handoffTimestamp, deferred.sourceSessionPath)
      : undefined;
    const recoveryPath = recoveryFile === undefined
      ? undefined
      : join(this.options.recoveryDirectory, recoveryFile);

    active.phase = "replacing";
    active.allowOwnSwitch = true;
    let replacementContext: ReplacementContext | undefined;

    try {
      const result = await ctx.newSession({
        parentSession: active.sourceSessionPath,
        withSession: async (freshCtx) => {
          replacementContext = freshCtx;
          this.options.onReplacementStarted?.(active, freshCtx);
          await freshCtx.sendUserMessage(markdown);
        },
      });

      if (result.cancelled) {
        this.fail(
          active,
          `Session handoff replacement was cancelled by a session guard. ${recoveryDisposition(recoveryPath)}`,
          replacementContext ?? ctx,
        );
        return false;
      }
      if (replacementContext === undefined) {
        this.fail(
          active,
          `Session handoff replacement failed: the replacement session context was unavailable. ${recoveryDisposition(recoveryPath)}`,
          ctx,
        );
        return false;
      }

      if (recoveryFile !== undefined) {
        try {
          await this.removeRecoveryFile(this.options.recoveryDirectory, recoveryFile);
        } catch (error) {
          replacementContext.ui.notify(
            `Session handoff succeeded, but the deferred-prompt recovery file could not be deleted at ${recoveryPath}: ${errorMessage(error)}`,
            "error",
          );
        }
      }

      if (this.active === active) this.active = undefined;
      this.options.onFinished?.(active, replacementContext);
      return true;
    } catch (error) {
      this.fail(active, replacementFailure(error, recoveryPath), replacementContext ?? ctx);
      return false;
    }
  }

  private fail(active: ActiveTransition, message: string, ctx: ExtensionContext): void {
    if (this.active === active) this.active = undefined;
    this.options.onFailure?.(active, message, ctx);
  }
}

export function registerNativeTransitionBridge(
  pi: Pick<ExtensionAPI, "registerCommand">,
  transition: NativeHandoffTransition,
): void {
  pi.registerCommand(PRIVATE_TRANSITION_COMMAND, {
    handler: async (args, ctx) => {
      await transition.execute(args, ctx);
    },
  });
}

export function nativeTransitionCommand(token: string): string {
  return `/${PRIVATE_TRANSITION_COMMAND} ${token}`;
}

function replacementFailure(error: unknown, recoveryPath: string | undefined): string {
  return `Session handoff replacement failed: ${errorMessage(error)} ${recoveryDisposition(recoveryPath)}`;
}

function recoveryDisposition(recoveryPath: string | undefined): string {
  return recoveryPath === undefined
    ? "No deferred-prompt recovery file was involved."
    : `Deferred-prompt recovery remains at ${recoveryPath}.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
