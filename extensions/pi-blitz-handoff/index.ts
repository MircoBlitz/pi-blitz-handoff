import { dirname } from "node:path";

import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { ConfigDialog } from "./config-dialog.ts";
import { handoffPaths, loadConfig, type HandoffConfig, type HandoffPaths } from "./config.ts";
import { ensureDirectory, requireDirectory } from "./filesystem.ts";
import { HandoffFlow, shouldStartAutomaticHandoff, type HandoffStartSource } from "./flow.ts";
import { registerSessionHandoffGoTools } from "./go-tool.ts";
import { RecoveryDialog } from "./recovery-dialog.ts";
import { persistDeferredPrompts } from "./recovery-store.ts";
import { registerPublicHandoffTool } from "./public-tool.ts";
import { registerSubmissionTool, SUBMIT_SESSION_HANDOFF_TOOL } from "./submission-tool.ts";
import {
  clearHandoffTerminalState,
  contextWarning,
  disposePersistentHandoffStatus,
  formatPublicStatus,
  getHandoffActivityStartedAt,
  getHandoffStartedAt,
  getHandoffTerminalState,
  protectReplacementSession,
  registerPersistentHandoffStatus,
  replacementSessionIsProtected,
  setHandoffTerminalState,
  unprotectReplacementSession,
  updatePersistentHandoffStatus,
  warningMessage,
} from "./status.ts";
import {
  CALL_DEFAULT_TEMPLATE,
  HANDOFF_DEFAULT_TEMPLATE,
  checkTemplateHealth,
  resolveTemplate,
  shippedTemplatePath,
  synchronizeManagedTemplate,
} from "./templates.ts";
import {
  NativeHandoffTransition,
  nativeTransitionCommand,
  registerNativeTransitionBridge,
} from "./transition.ts";
import { HandoffWriter, type WriterRuntime } from "./writer.ts";

export * from "./config-dialog.ts";
export * from "./config.ts";
export * from "./deferred.ts";
export * from "./filesystem.ts";
export * from "./flow.ts";
export * from "./go-tool.ts";
export * from "./recovery-store.ts";
export * from "./public-tool.ts";
export * from "./readiness.ts";
export * from "./recovery-dialog.ts";
export * from "./status.ts";
export * from "./submission-tool.ts";
export * from "./templates.ts";
export * from "./transition.ts";
export * from "./writer.ts";

const STATUS_KEY = "pi-blitz-handoff";
const READINESS_MESSAGE_TYPE = "pi-blitz-handoff-readiness";
const HANDOFF_HELP = [
  "Session handoff commands:",
  "  /sh              Start a session handoff",
  "  /sh-cancel       Cancel the active handoff",
  "  /sh-recover      Inspect or replay deferred prompts",
  "  /sh-config       Configure handoff settings",
  "  /sh-help         Show this help",
].join("\n");

export interface HandoffTemplateHealth {
  callTemplate: string;
  warnings: string[];
}

export interface InitializedHandoffStorage extends HandoffTemplateHealth {
  config: HandoffConfig;
  paths: HandoffPaths;
}

export async function resolveHandoffTemplateHealth(
  config: Pick<HandoffConfig, "callTemplate" | "handoffTemplate" | "templateDirectory">,
  paths: Pick<HandoffPaths, "templateDirectory">,
): Promise<HandoffTemplateHealth> {
  const directories = {
    managedDirectory: paths.templateDirectory,
    addendumDirectory: config.templateDirectory,
  };
  const call = await checkTemplateHealth(
    "Call",
    config.callTemplate,
    CALL_DEFAULT_TEMPLATE,
    directories,
  );
  const handoff = await checkTemplateHealth(
    "Handoff",
    config.handoffTemplate,
    HANDOFF_DEFAULT_TEMPLATE,
    directories,
  );
  return {
    callTemplate: call.resolved.content,
    warnings: [call.warning, handoff.warning].filter((warning): warning is string => warning !== undefined),
  };
}

export async function initializeHandoffStorage(
  agentDirectory: string,
): Promise<InitializedHandoffStorage> {
  const paths = handoffPaths(agentDirectory);
  await ensureDirectory(paths.baseDirectory);
  await ensureDirectory(paths.recoveryDirectory);
  await ensureDirectory(paths.templateDirectory);
  for (const filename of [CALL_DEFAULT_TEMPLATE, HANDOFF_DEFAULT_TEMPLATE]) {
    await synchronizeManagedTemplate(paths.templateDirectory, filename, shippedTemplatePath(filename));
  }

  const config = await loadConfig(agentDirectory);
  await requireDirectory(config.recoveryDirectory);
  if (config.templateDirectory !== null) {
    await requireDirectory(config.templateDirectory);
  }

  const templateHealth = await resolveHandoffTemplateHealth(config, paths);
  return { config, paths, ...templateHealth };
}

export function activateHandoffExtension(
  pi: ExtensionAPI,
  config: HandoffConfig,
  paths: HandoffPaths,
  callTemplate: string,
  startupTemplateWarnings: readonly string[] = [],
): HandoffFlow {
  let advisoryWarningShown = false;
  let pendingStartupTemplateWarnings = [...startupTemplateWarnings];
  let recoveryWrites: Promise<unknown> = Promise.resolve();
  let flow: HandoffFlow;
  const configDialog = new ConfigDialog(dirname(paths.baseDirectory));
  const recoveryDialog = new RecoveryDialog(
    config.recoveryDirectory,
    (content, options) => pi.sendUserMessage(content, options),
  );

  const transition = new NativeHandoffTransition({
    recoveryDirectory: config.recoveryDirectory,
    async settleDeferredWrites() {
      await recoveryWrites;
    },
    getDeferredSnapshot(handoffId) {
      return flow.snapshot?.id === handoffId ? flow.deferredSnapshot : undefined;
    },
    onReplacementStarted(_request, ctx) {
      protectReplacementSession(ctx.sessionManager.getSessionFile());
    },
    onFinished(request, ctx) {
      const sessionFile = ctx.sessionManager.getSessionFile();
      unprotectReplacementSession(sessionFile);
      setHandoffTerminalState(sessionFile, "finished");
      updatePersistentHandoffStatus(
        ctx.ui,
        STATUS_KEY,
        "inactive",
        "finished",
        false,
        request.startedAt,
        0,
        request.handoffStartedAt,
      );
    },
    onFailure(request, message, ctx) {
      flow.finish(ctx, request.handoffId);
      const sessionFile = ctx.sessionManager.getSessionFile();
      unprotectReplacementSession(sessionFile);
      setHandoffTerminalState(sessionFile, "failed");
      updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive", "failed", false, request.startedAt);
      ctx.ui.notify(message, "error");
    },
  });
  registerNativeTransitionBridge(pi, transition);

  const writerRuntime = writerRuntimeFrom(pi);
  const writer = writerRuntime === undefined
    ? undefined
    : new HandoffWriter({
        writerAttempts: config.writerAttempts,
        writerRetryDelaySeconds: config.writerRetryDelaySeconds,
        runtime: writerRuntime,
        resolveTemplate: () =>
          resolveTemplate(
            config.handoffTemplate,
            {
              managedDirectory: paths.templateDirectory,
              addendumDirectory: config.templateDirectory,
            },
            HANDOFF_DEFAULT_TEMPLATE,
          ),
        onTemplateFailure(failure, attempt, ctx) {
          ctx.ui.notify(
            `Writer attempt ${attempt} could not use template ${failure.path}: ${failure.reason}`,
            "warning",
          );
        },
        onPhaseChange(phase, _attempt, ctx) {
          const writing = phase === "resolving" || phase === "writing" || phase === "retry-delay";
          updatePersistentHandoffStatus(
            ctx.ui,
            STATUS_KEY,
            flow.phase,
            getHandoffTerminalState(ctx.sessionManager.getSessionFile()),
            writing,
            undefined,
            flow.deferredSnapshot?.prompts.length ?? 0,
          );
        },
        onSuccess(result, ctx) {
          const startedAt = getHandoffActivityStartedAt(STATUS_KEY);
          const token = transition.prepare({
            handoffId: result.handoff.id,
            sourceSessionPath: result.handoff.sourceSessionPath,
            dossier: result.submission.content,
            startedAt,
            handoffStartedAt: getHandoffStartedAt(STATUS_KEY),
          });
          if (token === undefined) {
            flow.finish(ctx, result.handoff.id);
            setHandoffTerminalState(ctx.sessionManager.getSessionFile(), "failed");
            updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive", "failed", false, startedAt);
            ctx.ui.notify("Could not start the correlated session handoff transition.", "error");
            return;
          }

          ctx.ui.notify(`Session handoff dossier accepted on writer attempt ${result.attempt}.`, "info");
          try {
            pi.sendUserMessage(nativeTransitionCommand(token), {
              deliverAs: "followUp",
              expandPromptTemplates: true,
            });
          } catch (error) {
            transition.cancel();
            flow.finish(ctx, result.handoff.id);
            setHandoffTerminalState(ctx.sessionManager.getSessionFile(), "failed");
            updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive", "failed", false, startedAt);
            ctx.ui.notify(`Could not request native session replacement: ${errorMessage(error)}`, "error");
          }
        },
        onTerminalFailure(reason, message, ctx) {
          const startedAt = getHandoffActivityStartedAt(STATUS_KEY);
          flow.finish(ctx);
          setHandoffTerminalState(
            ctx.sessionManager.getSessionFile(),
            reason === "cancelled" ? "cancelled" : "failed",
          );
          updatePersistentHandoffStatus(
            ctx.ui,
            STATUS_KEY,
            "inactive",
            reason === "cancelled" ? "cancelled" : "failed",
            false,
            startedAt,
          );
          if (reason !== "cancelled") {
            ctx.ui.notify(message, "error");
          }
        },
      });

  if (writer !== undefined) {
    registerSubmissionTool(pi, (submission) => writer.submit(submission));
  }

  const initializeWriterTools = (ctx: ExtensionContext): void => {
    if (writerRuntime === undefined || writer === undefined) return;
    try {
      writerRuntime.setActiveTools(
        writerRuntime.getActiveTools().filter((name) => name !== SUBMIT_SESSION_HANDOFF_TOOL),
      );
    } catch (error) {
      ctx.ui.notify(
        `Could not initialize session handoff writer tools: ${errorMessage(error)}`,
        "error",
      );
    }
  };

  flow = new HandoffFlow({
    readinessRetrySeconds: config.readinessRetrySeconds,
    callTemplate,
    onReadinessPrompt(prompt) {
      pi.sendMessage(
        {
          customType: READINESS_MESSAGE_TYPE,
          content: prompt,
          display: true,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
    onReadinessReminder(prompt) {
      pi.sendMessage(
        {
          customType: READINESS_MESSAGE_TYPE,
          content: prompt,
          display: true,
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    },
    onReady(handoff, ctx) {
      ctx.ui.notify("Session handoff readiness confirmed.", "info");
      writer?.start(handoff, ctx);
    },
    onPhaseChange(handoff, ctx) {
      updatePersistentHandoffStatus(
        ctx.ui,
        STATUS_KEY,
        handoff?.phase ?? "inactive",
        getHandoffTerminalState(ctx.sessionManager.getSessionFile()),
        false,
        undefined,
        flow.deferredSnapshot?.prompts.length ?? 0,
        undefined,
        handoff?.awaitingUserGo ?? false,
      );
    },
  });
  registerSessionHandoffGoTools(pi, {
    accept: (key, ctx) => flow.acceptGo(key, ctx),
    beginUserDeferral: (key, ctx) => flow.beginUserDeferral(key, ctx),
    resolveUserDeferral: (key, choice, ctx) => flow.resolveUserDeferral(key, choice, ctx),
  });

  const requestStart = (ctx: ExtensionContext, source: HandoffStartSource): string => {
    const result = flow.start(ctx, source);
    if (!result.accepted) {
      if (result.reason === "active") {
        const message = "A session handoff is already active.";
        ctx.ui.notify(message, "warning");
        return message;
      }
      const message = "A persisted source session is required; session handoff is unavailable with --no-session.";
      ctx.ui.notify(message, "error");
      return message;
    }

    clearHandoffTerminalState(ctx.sessionManager.getSessionFile());
    updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, flow.phase);
    const message = "Session handoff requested. Waiting for readiness.";
    ctx.ui.notify(message, "info");
    return message;
  };

  const handleHandoffAction = async (action: string, ctx: ExtensionCommandContext): Promise<void> => {
    if (action === "help" || action === "?") {
      ctx.ui.notify(HANDOFF_HELP, "info");
      return;
    }
    if (action === "") {
      requestStart(ctx, "command");
      return;
    }
    if (action === "config") {
      try {
        const configured = await loadConfig(dirname(paths.baseDirectory));
        const templateHealth = await resolveHandoffTemplateHealth(configured, paths);
        for (const warning of templateHealth.warnings) ctx.ui.notify(warning, "warning");
      } catch (error) {
        ctx.ui.notify(`Template health check failed: ${errorMessage(error)}`, "error");
        return;
      }
      await configDialog.run(ctx);
      return;
    }
    if (action === "recover") {
      await recoveryDialog.run(ctx);
      return;
    }
    if (action === "cancel") {
      const startedAt = getHandoffActivityStartedAt(STATUS_KEY);
      const transitionCancellation = transition.cancel();
      if (transitionCancellation === "committed") {
        ctx.ui.notify("Session handoff cutover has started and can no longer be cancelled.", "warning");
        return;
      }
      const writerCancelled = writer?.cancel(ctx) ?? false;
      const flowCancelled = flow.cancel(ctx);
      const cancelled = transitionCancellation === "cancelled" || writerCancelled || flowCancelled;
      if (cancelled) {
        setHandoffTerminalState(ctx.sessionManager.getSessionFile(), "cancelled");
        updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive", "cancelled", false, startedAt);
      }
      ctx.ui.notify(
        cancelled ? "Session handoff cancelled." : "No active session handoff to cancel.",
        "info",
      );
      return;
    }
    ctx.ui.notify("Usage: /sh, /sh-help, /sh-recover, /sh-config, or /sh-cancel", "warning");
  };

  pi.registerCommand("sh", {
    description: "Start a session handoff (use /sh-help for commands)",
    handler: async (args, ctx) => {
      await handleHandoffAction(args.trim(), ctx);
    },
  });

  for (const [command, action, description] of [
    ["sh-help", "help", "Show session handoff help"],
    ["sh-cancel", "cancel", "Cancel the active session handoff"],
    ["sh-recover", "recover", "Recover deferred session handoff prompts"],
    ["sh-config", "config", "Configure session handoff settings"],
  ] as const) {
    pi.registerCommand(command, {
      description,
      handler: async (_args, ctx) => {
        await handleHandoffAction(action, ctx);
      },
    });
  }

  registerPublicHandoffTool(pi, {
    status(ctx) {
      return formatPublicStatus(
        flow.phase,
        ctx.getContextUsage(),
        config,
        getHandoffTerminalState(ctx.sessionManager.getSessionFile()),
        writer?.isActive ?? false,
      );
    },
    start(ctx) {
      return requestStart(ctx, "tool");
    },
  });

  pi.on("input", async (event, ctx) => {
    if (event.source !== "extension" && flow.phase === "inactive") {
      clearHandoffTerminalState(ctx.sessionManager.getSessionFile());
      updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive");
    }
    const result = flow.handleInput(event.text, event.source, ctx);
    if (result.action === "continue") {
      return { action: "continue" };
    }

    updatePersistentHandoffStatus(
      ctx.ui,
      STATUS_KEY,
      flow.phase,
      getHandoffTerminalState(ctx.sessionManager.getSessionFile()),
      writer?.isActive ?? false,
      undefined,
      result.snapshot.prompts.length,
    );

    const recoveryWrite = recoveryWrites.then(() =>
      persistDeferredPrompts(config.recoveryDirectory, result.snapshot),
    );
    recoveryWrites = recoveryWrite.catch(() => undefined);
    try {
      await recoveryWrite;
    } catch (error) {
      ctx.ui.notify(
        `Deferred prompt was captured in memory, but its recovery file could not be updated: ${errorMessage(error)}`,
        "error",
      );
    }
    return { action: "handled" };
  });

  pi.on("agent_settled", (_event, ctx) => {
    const usage = ctx.getContextUsage();
    const warning = contextWarning(usage?.percent, config, advisoryWarningShown);
    if (warning !== undefined && usage?.percent !== null && usage?.percent !== undefined) {
      advisoryWarningShown = true;
      ctx.ui.notify(warningMessage(warning, usage.percent), "warning");
    }

    if (writer?.isActive) {
      writer.handleSettled(ctx);
      return;
    }

    if (flow.phase !== "inactive") {
      flow.handleSettled(ctx);
      return;
    }

    if (
      ctx.isIdle() &&
      !ctx.hasPendingMessages() &&
      shouldStartAutomaticHandoff(
        config.automaticSessionHandoff,
        config.automaticSessionHandoffPercent,
        usage?.percent,
      )
    ) {
      requestStart(ctx, "automatic");
    }
  });

  pi.on("session_before_switch", (event, ctx) => {
    if (
      !flow.isTransferProtected &&
      !transition.isProtected &&
      !replacementSessionIsProtected(ctx.sessionManager.getSessionFile())
    ) return;
    if (transition.allowNativeNewSession(event.reason)) return;
    ctx.ui.notify("Session replacement is blocked while the session handoff transfer is active.", "warning");
    return { cancel: true };
  });

  pi.on("session_before_fork", (_event, ctx) => {
    if (
      !flow.isTransferProtected &&
      !transition.isProtected &&
      !replacementSessionIsProtected(ctx.sessionManager.getSessionFile())
    ) return;
    ctx.ui.notify("Session fork is blocked while the session handoff transfer is active.", "warning");
    return { cancel: true };
  });

  pi.on("session_before_compact", (_event, ctx) => {
    if (
      !flow.isTransferProtected &&
      !transition.isProtected &&
      !replacementSessionIsProtected(ctx.sessionManager.getSessionFile())
    ) return;
    ctx.ui.notify("Session compaction is blocked while the session handoff transfer is active.", "warning");
    return { cancel: true };
  });

  pi.on("session_start", (_event, ctx) => {
    initializeWriterTools(ctx);
    for (const warning of pendingStartupTemplateWarnings) ctx.ui.notify(warning, "warning");
    pendingStartupTemplateWarnings = [];
    configDialog.discard();
    recoveryDialog.discard();
    advisoryWarningShown = false;
    if (ctx.mode === "tui") registerPersistentHandoffStatus(ctx.ui, STATUS_KEY);
    const terminal = getHandoffTerminalState(ctx.sessionManager.getSessionFile());
    updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, flow.phase, terminal);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    configDialog.discard();
    recoveryDialog.discard();
    writer?.invalidate();
    flow.invalidate();
    transition.invalidate();
    unprotectReplacementSession(ctx.sessionManager.getSessionFile());
    clearHandoffTerminalState(ctx.sessionManager.getSessionFile());
    disposePersistentHandoffStatus(ctx.ui, STATUS_KEY);
  });

  return flow;
}

export default async function piBlitzHandoff(pi: ExtensionAPI): Promise<void> {
  const { config, paths, callTemplate, warnings } = await initializeHandoffStorage(getAgentDir());
  if (typeof pi.registerCommand === "function") {
    activateHandoffExtension(pi, config, paths, callTemplate, warnings);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writerRuntimeFrom(pi: ExtensionAPI): WriterRuntime | undefined {
  if (
    typeof pi.getActiveTools !== "function" ||
    typeof pi.setActiveTools !== "function" ||
    typeof pi.sendUserMessage !== "function"
  ) {
    return undefined;
  }
  return {
    getActiveTools: () => pi.getActiveTools(),
    setActiveTools: (toolNames) => pi.setActiveTools(toolNames),
    sendUserMessage: (content) => pi.sendUserMessage(content),
  };
}
