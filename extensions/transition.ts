import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
  MessageStartEvent,
  TurnEndEvent,
  SessionHeader,
} from "@earendil-works/pi-coding-agent";

import type { DeferredPromptSnapshot } from "./deferred.ts";
import { finalizeHandoffFile, handoffStartPrompt } from "./handoff-file.ts";
import { deleteRecoveryFile, recoveryFileName } from "./recovery-store.ts";

const PRIVATE_TRANSITION_COMMAND = "__pi_blitz_handoff_transition";

export type NativeTransitionPhase = "inactive" | "pending" | "replacing";

export interface NativeTransitionRequest {
  handoffId: string;
  sourceSessionPath: string;
  handoffFile: string;
  deleteHandoffAfterReading: boolean;
  startedAt?: number;
  handoffStartedAt?: number;
}

export interface NativeHandoffTransitionOptions {
  recoveryDirectory: string;
  getMaxSessionChainLength(): number;
  settleDeferredWrites?(): Promise<void>;
  getDeferredSnapshot(handoffId: string): DeferredPromptSnapshot | undefined;
  onFailure?(
    request: NativeTransitionRequest,
    message: string,
    ctx: ExtensionContext,
  ): void;
  createToken?: () => string;
}

interface ActiveTransition extends NativeTransitionRequest {
  token: string;
  phase: Exclude<NativeTransitionPhase, "inactive">;
  allowOwnSwitch: boolean;
}

export class NativeHandoffTransition {
  private active?: ActiveTransition;
  private recoveryDirectory: string;
  private readonly options: NativeHandoffTransitionOptions;
  private readonly createToken: () => string;

  constructor(options: NativeHandoffTransitionOptions) {
    this.options = options;
    this.recoveryDirectory = options.recoveryDirectory;
    this.createToken = options.createToken ?? (() => randomUUID());
  }

  get phase(): NativeTransitionPhase {
    return this.active?.phase ?? "inactive";
  }

  get isProtected(): boolean {
    return this.active !== undefined;
  }

  setRecoveryDirectory(directory: string): void {
    if (this.active !== undefined) {
      throw new Error("Recovery directory cannot change during a handoff transition");
    }
    this.recoveryDirectory = directory;
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

    let newMaster: boolean;
    try {
      newMaster = await sessionChainLimitReached(
        ctx.sessionManager.getHeader(),
        this.options.getMaxSessionChainLength(),
      );
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
    const recoveryFile = deferred !== undefined && prompts.length > 0
      ? recoveryFileName(deferred.handoffTimestamp, deferred.sourceSessionPath)
      : undefined;
    const recoveryPath = recoveryFile === undefined
      ? undefined
      : join(this.recoveryDirectory, recoveryFile);

    // Only plain data crosses runtime replacement. No old extension APIs or callbacks
    // are used after withSession starts; the recipient observes its own public events.
    let replacementStarted = false;
    try {
      finalizeHandoffFile(active.handoffFile, prompts);
      const operation: DeliveredOperation = {
        id: randomUUID(),
        kind: "handoff",
        request: {
          handoffId: active.handoffId,
          sourceSessionPath: active.sourceSessionPath,
          handoffFile: active.handoffFile,
          deleteHandoffAfterReading: active.deleteHandoffAfterReading,
          startedAt: active.startedAt,
          handoffStartedAt: active.handoffStartedAt,
        },
        ...(recoveryFile === undefined ? {} : {
          recovery: { directory: this.recoveryDirectory, fileName: recoveryFile },
        }),
      };
      const prompt = deliveredOperationPrompt(operation,
        handoffStartPrompt(active.handoffFile, active.deleteHandoffAfterReading));
      active.phase = "replacing";
      active.allowOwnSwitch = true;
      const result = await ctx.newSession({
        ...(newMaster ? {} : { parentSession: active.sourceSessionPath }),
        withSession: async (freshCtx) => {
          replacementStarted = true;
          try {
            await freshCtx.sendUserMessage(prompt);
          } catch (error) {
            // This helper waits for the whole run. Never change a recipient's
            // already observed terminal result from this late sender settlement.
            freshCtx.ui.notify(
              `Native session handoff dispatch/run reported an error: ${errorMessage(error)} Completion is determined only by the observed recipient turn.${recoveryPath === undefined ? "" : ` Associated recovery path: ${recoveryPath}.`}`,
              "error",
            );
            throw error;
          }
        },
      });

      if (replacementStarted) return !result.cancelled;
      if (result.cancelled) {
        this.fail(
          active,
          `Session handoff replacement was cancelled by a session guard. ${recoveryDisposition(recoveryPath)}`,
          ctx,
        );
        return false;
      }
      this.fail(
        active,
        `Session handoff replacement failed: the replacement session context was unavailable. ${recoveryDisposition(recoveryPath)}`,
        ctx,
      );
      return false;
    } catch (error) {
      if (!replacementStarted) this.fail(active, replacementFailure(error, recoveryPath), ctx);
      return false;
    }
  }

  private fail(active: ActiveTransition, message: string, ctx: ExtensionContext): void {
    if (this.active === active) this.active = undefined;
    this.options.onFailure?.(active, message, ctx);
  }
}

const DELIVERY_PROTOCOL = "pi-blitz-handoff/delivery-v1 ";

export type DeliveredOperation = {
  id: string;
  recovery?: { directory: string; fileName: string };
} & ({ kind: "handoff"; request: NativeTransitionRequest } | { kind: "recovery" });

export function deliveredOperationPrompt(operation: DeliveredOperation, prompt: string): string {
  return `${DELIVERY_PROTOCOL}${JSON.stringify(operation)}\n\n${prompt}`;
}

interface DeliveryCandidate {
  operation: DeliveredOperation;
  marker: string;
  sessionFile: string | undefined;
  bound?: { generation: number; turnIndex: number };
  messageEntryId?: string;
}

interface DeliveredTurnOptions {
  onStarted?(request: NativeTransitionRequest, ctx: ExtensionContext): void;
  onFinished?(request: NativeTransitionRequest, ctx: ExtensionContext): void;
  onFailure?(request: NativeTransitionRequest, message: string, ctx: ExtensionContext): void;
  removeRecoveryFile?: typeof deleteRecoveryFile;
}

// Owned by one receiving extension instance. Input is only a candidate; only
// the emitted user message establishes which native turn actually received it.
export class DeliveredTurnCompletion {
  private generation = 0;
  private turnIndex: number | undefined;
  private readonly candidates = new Map<string, DeliveryCandidate>();
  private readonly observed = new Set<string>();

  private readonly options: DeliveredTurnOptions;

  constructor(options: DeliveredTurnOptions = {}) {
    this.options = options;
  }

  input(event: InputEvent, ctx: ExtensionContext): boolean {
    if (event.source !== "extension") return false;
    const parsed = parseDelivery(event.text);
    if (parsed === undefined) return false;
    const { operation, marker } = parsed;
    if (!this.observed.has(operation.id)) {
      this.observed.add(operation.id);
      this.candidates.set(operation.id, {
        operation, marker, sessionFile: ctx.sessionManager.getSessionFile(),
      });
    }
    return true;
  }

  agentStart(): void {
    this.generation += 1;
    this.turnIndex = undefined;
  }

  turnStart(turnIndex: number): void {
    this.turnIndex = turnIndex;
  }

  messageStart(event: MessageStartEvent, ctx: ExtensionContext): void {
    if (event.message.role !== "user" || this.turnIndex === undefined) return;
    const text = typeof event.message.content === "string"
      ? event.message.content
      : event.message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const parsed = parseDelivery(text);
    if (parsed === undefined) return;
    const candidate = this.candidates.get(parsed.operation.id);
    if (candidate === undefined || candidate.bound !== undefined ||
        candidate.marker !== parsed.marker || candidate.sessionFile !== ctx.sessionManager.getSessionFile()) return;
    candidate.bound = { generation: this.generation, turnIndex: this.turnIndex };
    if (candidate.operation.kind === "handoff") this.options.onStarted?.(candidate.operation.request, ctx);
  }

  async turnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void> {
    for (const [id, candidate] of this.candidates) {
      if (candidate.sessionFile !== ctx.sessionManager.getSessionFile() ||
          candidate.bound?.generation !== this.generation || candidate.bound.turnIndex !== event.turnIndex) continue;
      candidate.messageEntryId = event.messageEntryId;
      this.candidates.delete(id); // close before callbacks or asynchronous cleanup
      const { operation } = candidate;
      const recoveryPath = operation.recovery === undefined ? undefined
        : join(operation.recovery.directory, operation.recovery.fileName);
      if (event.outcome !== "completed") {
        const message = `Session handoff ${operation.kind === "recovery" ? "recovery" : "recipient"} turn ${event.outcome}. ${recoveryDisposition(recoveryPath)}`;
        if (operation.kind === "handoff") this.options.onFailure?.(operation.request, message, ctx);
        else ctx.ui.notify(message, "error");
        continue;
      }
      if (operation.kind === "handoff") this.options.onFinished?.(operation.request, ctx);
      if (operation.recovery !== undefined) {
        try {
          await (this.options.removeRecoveryFile ?? deleteRecoveryFile)(operation.recovery.directory, operation.recovery.fileName);
        } catch (error) {
          ctx.ui.notify(`The delivered turn completed, but recovery file ${recoveryPath} could not be deleted: ${errorMessage(error)}`, "error");
        }
      }
    }
  }

  discard(): void {
    this.candidates.clear();
    this.observed.clear();
    this.turnIndex = undefined;
  }
}

function parseDelivery(text: string): { operation: DeliveredOperation; marker: string } | undefined {
  const marker = text.split("\n").find((line) => line.startsWith(DELIVERY_PROTOCOL));
  if (marker === undefined) return undefined;
  try {
    const value = JSON.parse(marker.slice(DELIVERY_PROTOCOL.length)) as DeliveredOperation;
    if (typeof value.id !== "string" || !/^[0-9a-f-]{36}$/.test(value.id) ||
        (value.kind !== "handoff" && value.kind !== "recovery")) return undefined;
    if (value.recovery !== undefined && (typeof value.recovery.directory !== "string" ||
        !/^[A-Za-z0-9-]+\.md$/.test(value.recovery.fileName))) return undefined;
    if (value.kind === "recovery" && value.recovery === undefined) return undefined;
    if (value.kind === "handoff" && (typeof value.request?.handoffId !== "string" ||
        typeof value.request.handoffFile !== "string" || typeof value.request.sourceSessionPath !== "string" ||
        typeof value.request.deleteHandoffAfterReading !== "boolean")) return undefined;
    return { operation: value, marker };
  } catch {
    return undefined;
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

export async function sessionChainLimitReached(header: SessionHeader | null, limit: number): Promise<boolean> {
  if (header === null) throw new Error("The source session header is unavailable");
  let length = 1;
  let parent = header.parentSession;
  while (length < limit && parent !== undefined) {
    const file = await open(parent, "r");
    try {
      const lines = file.readLines();
      try {
        const first = await lines[Symbol.asyncIterator]().next();
        if (first.done) throw new Error(`Empty parent session: ${parent}`);
        const ancestor = JSON.parse(first.value) as SessionHeader;
        if (ancestor.type !== "session") throw new Error(`Missing parent session header: ${parent}`);
        parent = ancestor.parentSession;
        length += 1;
      } finally {
        lines.close();
      }
    } finally {
      await file.close();
    }
  }
  return length >= limit;
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
