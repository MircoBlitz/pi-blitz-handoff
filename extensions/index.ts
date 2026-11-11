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
import {
  automaticHandoffEnabled,
  HandoffFlow,
  shouldStartAutomaticHandoff,
  type ExplicitHandoffStartSource,
  type HandoffStartResult,
} from "./flow.ts";
import { ProjectTemplateDialog } from "./project-template-dialog.ts";
import { documentDialog, selectDialog } from "./overlay-dialog.ts";
import {
  loadProjectTemplateAssignments,
  resolveProjectTemplateAssignment,
} from "./project-templates.ts";
import { RecoveryDialog } from "./recovery-dialog.ts";
import { persistDeferredPrompts } from "./recovery-store.ts";
import { registerPublicHandoffTool } from "./public-tool.ts";
import { registerPreparationTool } from "./preparation-tool.ts";
import { registerSubmissionTool } from "./submission-tool.ts";
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
  SHIPPED_TEMPLATE_FILENAMES,
  checkTemplateHealth,
  resolveTemplate,
  shippedTemplatePath,
  synchronizeManagedTemplate,
} from "./templates.ts";
import {
  DeliveredTurnCompletion,
  NativeHandoffTransition,
  type NativeTransitionRequest,
  nativeTransitionCommand,
  registerNativeTransitionBridge,
} from "./transition.ts";
import { HandoffWriter, preparationPrompt, type WriterRuntime } from "./writer.ts";

export * from "./config-dialog.ts";
export * from "./config.ts";
export * from "./deferred.ts";
export * from "./filesystem.ts";
export * from "./flow.ts";
export * from "./preparation-tool.ts";
export * from "./recovery-store.ts";
export * from "./public-tool.ts";
export * from "./project-template-dialog.ts";
export * from "./project-templates.ts";
export * from "./readiness.ts";
export * from "./recovery-dialog.ts";
export * from "./status.ts";
export * from "./submission-tool.ts";
export * from "./templates.ts";
export * from "./transition.ts";
export * from "./writer.ts";

const STATUS_KEY = "pi-blitz-handoff";
const AUTOMATIC_ATTEMPT_ENTRY = "pi-blitz-handoff-automatic-attempt";
const READINESS_MESSAGE_TYPE = "pi-blitz-handoff-readiness";
const CANCELLATION_MESSAGE_TYPE = "pi-blitz-handoff-cancelled";
const CANCELLATION_INSTRUCTION = "Session handoff cancelled. Disregard the previous handoff request and any Finish ID. Resume normal conversation and task work. Do not finish a session handoff.";
const HANDOFF_HELP = [
  "## Commands",
  "- `/sh` — Open the handoff menu",
  "- `/sh start` — Start a session handoff",
  "- `/sh cancel` — Cancel the active handoff before cutover",
  "- `/sh recover` — Inspect, execute or discard retained prompts",
  "- `/sh settings` — Configure global settings; each confirmed edit saves immediately",
  "- `/sh project-template` — Assign templates to the current directory",
  "- `/sh help` — Show this help",
  "",
  "## Dialog controls",
  "Use your Pi keybindings to select, confirm, cancel and scroll; each dialog shows its current keys.",
  "Content inspection also uses selection navigation and editor line-start / line-end bindings.",
  "",
  "## Handoff",
  "Request → retrieve template → write/update supplied file → Finish. Use /sh cancel to cancel before native cutover.",
  "",
  "Dialog answers stay outside model context. Closing Settings does not undo confirmed edits.",
  "Recovery never executes automatically. Inspecting a file never changes it.",
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
  for (const filename of SHIPPED_TEMPLATE_FILENAMES) {
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
  initialConfig: HandoffConfig,
  paths: HandoffPaths,
  callTemplate: string,
  startupTemplateWarnings: readonly string[] = [],
): HandoffFlow {
  let advisoryWarningShown = false;
  let automaticAttempts = 0;
  let pendingStartupTemplateWarnings = [...startupTemplateWarnings];
  let recoveryWrites: Promise<unknown> = Promise.resolve();
  let flow: HandoffFlow;
  let configDialog: ConfigDialog;
  let navigationDialog: AbortController | undefined;
  let cancellationStartedAt: number | undefined;
  const config = { ...initialConfig };
  const handoffTemplates = new Map<string, string>();
  const agentDirectory = dirname(paths.baseDirectory);
  const projectTemplateDialog = new ProjectTemplateDialog(agentDirectory);
  const recoveryDialog = new RecoveryDialog(
    config.recoveryDirectory,
    (content, options) => pi.sendUserMessage(content, options),
  );

  const transitionFailure = (request: NativeTransitionRequest, message: string, ctx: ExtensionContext): void => {
    flow.finish(ctx, request.handoffId);
    writer?.invalidate();
    const sessionFile = ctx.sessionManager.getSessionFile();
    unprotectReplacementSession(sessionFile);
    setHandoffTerminalState(sessionFile, "failed");
    updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive", "failed", false, request.startedAt);
    ctx.ui.notify(message, "error");
  };
  const completion = new DeliveredTurnCompletion({
    onStarted(_request, ctx) {
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
    onFailure: transitionFailure,
  });
  const transition = new NativeHandoffTransition({
    recoveryDirectory: config.recoveryDirectory,
    getMaxSessionChainLength: () => config.maxSessionChainLength,
    async settleDeferredWrites() {
      await recoveryWrites;
    },
    getDeferredSnapshot(handoffId) {
      return flow.snapshot?.id === handoffId ? flow.deferredSnapshot : undefined;
    },
    onFailure: transitionFailure,
  });
  registerNativeTransitionBridge(pi, transition);

  const writerRuntime = writerRuntimeFrom(pi);
  const writer = writerRuntime === undefined
    ? undefined
    : new HandoffWriter({
        runtime: writerRuntime,
        resolveTemplate: (selectedFilename) =>
          resolveTemplate(
            selectedFilename ?? config.handoffTemplate,
            {
              managedDirectory: paths.templateDirectory,
              addendumDirectory: config.templateDirectory,
            },
            HANDOFF_DEFAULT_TEMPLATE,
          ),
        onTemplateFailure(failure, ctx) {
          ctx.ui.notify(`Could not use handoff template ${failure.path}: ${failure.reason}`, "warning");
        },
        onSuccess(result, ctx) {
          const startedAt = getHandoffActivityStartedAt(STATUS_KEY);
          const token = transition.prepare({
            handoffId: result.handoff.id,
            sourceSessionPath: result.handoff.sourceSessionPath,
            handoffFile: result.handoffFile,
            deleteHandoffAfterReading: config.deleteHandoffAfterReading,
            startedAt,
            handoffStartedAt: getHandoffStartedAt(STATUS_KEY),
          });
          if (token === undefined) {
            writer?.invalidate();
            flow.finish(ctx, result.handoff.id);
            setHandoffTerminalState(ctx.sessionManager.getSessionFile(), "failed");
            updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive", "failed", false, startedAt);
            ctx.ui.notify("Could not start the correlated session handoff transition.", "error");
            return;
          }

          ctx.ui.notify("Session handoff file marked ready.", "info");
          try {
            pi.sendUserMessage(nativeTransitionCommand(token), {
              expandPromptTemplates: true,
            });
          } catch (error) {
            transition.cancel();
            writer?.invalidate();
            flow.finish(ctx, result.handoff.id);
            setHandoffTerminalState(ctx.sessionManager.getSessionFile(), "failed");
            updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive", "failed", false, startedAt);
            ctx.ui.notify(`Could not request native session replacement: ${errorMessage(error)}`, "error");
          }
        },
        onCancellationComplete(succeeded, ctx) {
          completeCancellation(succeeded, ctx);
        },
      });

  if (writer !== undefined) {
    registerSubmissionTool(pi, (submission, ctx) => {
      const handoff = flow.snapshot;
      if (handoff === undefined) throw new Error("No active handoff request");
      writer.submit(submission);
      flow.acceptFinish(handoff.id, ctx);
    });
    registerPreparationTool(pi, async (ctx) => {
      const handoff = flow.snapshot;
      if (handoff === undefined || handoff.phase === "ready") throw new Error("Template retrieval requires a current active handoff request");
      const prepared = await writer.prepare(handoff, ctx, handoffTemplates.get(handoff.id));
      if (flow.snapshot?.id !== handoff.id) throw new Error("Handoff template request is no longer current");
      const response = {
        text: preparationPrompt(prepared, handoff.sourceSessionPath),
        onReturn(): void {
          writer.returned(prepared);
          const initialInstruction = flow.templateReturned(handoff.id, ctx);
          if (initialInstruction !== undefined) response.text = `${initialInstruction}\n\n${response.text}`;
        },
      };
      return response;
    });
  }

  const completeCancellation = (succeeded: boolean, ctx: ExtensionContext): void => {
    const terminal = succeeded ? "cancelled" : "failed";
    setHandoffTerminalState(ctx.sessionManager.getSessionFile(), terminal);
    updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive", terminal, false, cancellationStartedAt);
    cancellationStartedAt = undefined;
    ctx.ui.notify(
      succeeded ? "Session handoff cancelled." : "Session handoff stopped, but cleanup failed. See the reported error.",
      succeeded ? "info" : "error",
    );
    sendCancellationInstruction(succeeded);
  };

  const sendCancellationInstruction = (succeeded: boolean): void => {
    pi.sendMessage(
      {
        customType: CANCELLATION_MESSAGE_TYPE,
        content: succeeded ? CANCELLATION_INSTRUCTION : CANCELLATION_INSTRUCTION.replace(
          "Session handoff cancelled.",
          "Session handoff stopped, but cleanup failed.",
        ),
        display: true,
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  flow = new HandoffFlow({
    readinessRetrySeconds: config.readinessRetrySeconds,
    deferPromptsFrom: config.deferPromptsFrom,
    callTemplate,
    onReadinessPrompt(prompt, handoff) {
      pi.sendMessage(
        {
          customType: READINESS_MESSAGE_TYPE,
          content: prompt,
          display: true,
        },
        {
          deliverAs: handoff.source === "automatic" ? "steer" : "followUp",
          triggerTurn: true,
        },
      );
    },
    onReadinessReminder(prompt, handoff) {
      pi.sendMessage(
        {
          customType: READINESS_MESSAGE_TYPE,
          content: prompt,
          display: true,
        },
        {
          deliverAs: handoff.source === "automatic" ? "steer" : "followUp",
          triggerTurn: true,
        },
      );
    },
    onReadinessEmergency(prompt) {
      pi.sendMessage(
        { customType: "pi-blitz-handoff-emergency", content: prompt, display: true },
        { deliverAs: "steer", triggerTurn: true },
      );
    },
    onReady(_handoff, ctx) { writer?.handleSettled(ctx); },
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
        flow.deferredSnapshot !== undefined,
      );
    },
  });
  configDialog = new ConfigDialog(agentDirectory, async (persisted, ctx) => {
    const templatesChanged =
      persisted.templateDirectory !== config.templateDirectory ||
      persisted.callTemplate !== config.callTemplate ||
      persisted.handoffTemplate !== config.handoffTemplate;
    Object.assign(config, persisted);
    flow.setReadinessRetrySeconds(config.readinessRetrySeconds);
    flow.setDeferPromptsFrom(config.deferPromptsFrom);
    recoveryDialog.setRecoveryDirectory(config.recoveryDirectory);
    transition.setRecoveryDirectory(config.recoveryDirectory);

    if (!templatesChanged) return;
    try {
      const health = await resolveHandoffTemplateHealth(config, paths);
      callTemplate = health.callTemplate;
      flow.setCallTemplate(callTemplate);
      for (const warning of health.warnings) ctx.ui.notify(warning, "warning");
    } catch (error) {
      ctx.ui.notify(
        `Configuration was saved, but current template resolution could not be refreshed: ${errorMessage(error)}`,
        "error",
      );
    }
  });

  const reportStart = (
    result: HandoffStartResult,
    ctx: ExtensionContext,
  ): string => {
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
    updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, flow.phase, undefined, false, undefined,
      flow.deferredSnapshot?.prompts.length ?? 0, undefined, flow.deferredSnapshot !== undefined);
    const message = "Session handoff requested. Waiting for readiness.";
    ctx.ui.notify(message, "info");
    return message;
  };

  const effectiveTemplates = async (ctx: ExtensionContext): Promise<{
    callTemplate: string;
    handoffTemplate: string;
  }> => {
    let assignments;
    try {
      assignments = await loadProjectTemplateAssignments(paths.projectTemplatesFile);
    } catch (error) {
      ctx.ui.notify(
        `Project settings file could not be loaded (${projectSettingsErrorCategory(error)}). Role defaults are active for this handoff. Ask Pi to inspect the file if desired.`,
        "warning",
      );
      const directories = {
        managedDirectory: paths.templateDirectory,
        addendumDirectory: config.templateDirectory,
      };
      const [callDefault] = await Promise.all([
        checkTemplateHealth("Call", CALL_DEFAULT_TEMPLATE, CALL_DEFAULT_TEMPLATE, directories),
        checkTemplateHealth("Handoff", HANDOFF_DEFAULT_TEMPLATE, HANDOFF_DEFAULT_TEMPLATE, directories),
      ]);
      return {
        callTemplate: callDefault.resolved.content,
        handoffTemplate: HANDOFF_DEFAULT_TEMPLATE,
      };
    }

    const selected = resolveProjectTemplateAssignment(assignments, ctx.cwd);
    let effectiveCallTemplate = callTemplate;
    if (selected.callTemplate !== null) {
      const health = await checkTemplateHealth(
        "Call",
        selected.callTemplate,
        CALL_DEFAULT_TEMPLATE,
        {
          managedDirectory: paths.templateDirectory,
          addendumDirectory: config.templateDirectory,
        },
      );
      if (health.warning !== undefined) ctx.ui.notify(health.warning, "warning");
      effectiveCallTemplate = health.resolved.content;
    }
    return {
      callTemplate: effectiveCallTemplate,
      handoffTemplate: selected.handoffTemplate ?? config.handoffTemplate,
    };
  };

  const requestStart = async (
    ctx: ExtensionContext,
    source: ExplicitHandoffStartSource,
  ): Promise<string> => {
    if (writer?.isActive || transition.isProtected) {
      const message = "A session handoff is already active.";
      ctx.ui.notify(message, "warning");
      return message;
    }
    if (configDialog.isActive) {
      const message = "Session handoff cannot start while configuration is active.";
      ctx.ui.notify(message, "warning");
      return message;
    }
    if (flow.phase !== "inactive" || ctx.sessionManager.getSessionFile() === undefined) {
      return reportStart(flow.start(ctx, source), ctx);
    }
    try {
      const templates = await effectiveTemplates(ctx);
      if (configDialog.isActive) {
        const message = "Session handoff cannot start while configuration is active.";
        ctx.ui.notify(message, "warning");
        return message;
      }
      if (writer?.isActive || transition.isProtected) {
        const message = "A session handoff is already active.";
        ctx.ui.notify(message, "warning");
        return message;
      }
      const result = flow.start(ctx, source, templates.callTemplate);
      if (result.accepted) handoffTemplates.set(result.handoff.id, templates.handoffTemplate);
      return reportStart(result, ctx);
    } catch (error) {
      const message = `Could not start session handoff: ${errorMessage(error)}`;
      ctx.ui.notify(message, "error");
      return message;
    }
  };

  const requestAutomaticStart = async (ctx: ExtensionContext): Promise<void> => {
    if (flow.phase !== "inactive" || configDialog.isActive || writer?.isActive || transition.isProtected) return;
    try {
      const templates = await effectiveTemplates(ctx);
      if (configDialog.isActive || writer?.isActive || transition.isProtected) return;
      const result = flow.startAutomaticAtTurnBoundary(ctx, templates.callTemplate);
      if (result.accepted) {
        handoffTemplates.set(result.handoff.id, templates.handoffTemplate);
        automaticAttempts += 1;
        pi.appendEntry(AUTOMATIC_ATTEMPT_ENTRY, { attempt: automaticAttempts });
      }
      reportStart(result, ctx);
    } catch (error) {
      ctx.ui.notify(`Could not start session handoff: ${errorMessage(error)}`, "error");
    }
  };

  const handleHandoffAction = async (action: string, ctx: ExtensionCommandContext): Promise<void> => {
    if (action === "" || action === "help" || action === "?") {
      if (!ctx.hasUI || (action !== "" && ctx.mode !== "tui")) {
        ctx.ui.notify(HANDOFF_HELP, "info");
        return;
      }
      if (navigationDialog !== undefined) {
        ctx.ui.notify("The handoff menu or help is already open.", "info");
        return;
      }
      const controller = new AbortController();
      navigationDialog = controller;
      let selected: string | undefined;
      try {
        if (action !== "") {
          await documentDialog(ctx, "Session handoff · Help", HANDOFF_HELP, { signal: controller.signal, markdown: true });
        } else {
          const active = flow.phase !== "inactive" || writer?.isActive || transition.isProtected;
          selected = await selectDialog(ctx,
            formatPublicStatus(flow.phase, ctx.getContextUsage(), config,
              getHandoffTerminalState(ctx.sessionManager.getSessionFile())),
            [
              { value: active ? "cancel" : "start", label: active ? "Cancel handoff" : "Start handoff", description: active ? "End the active transfer before cutover" : "Request a fresh linked session" },
              { value: "recover", label: "Recovery", description: "Inspect or replay retained prompts" },
              { value: "settings", label: "Settings", description: "Edit global settings; each edit saves immediately" },
              { value: "project-template", label: "Project templates", description: "Assign templates to the current directory" },
              { value: "help", label: "Help", description: "Commands and keyboard controls" },
            ], { signal: controller.signal, heading: "Session handoff" });
        }
      } finally {
        if (navigationDialog === controller) navigationDialog = undefined;
      }
      if (!controller.signal.aborted && selected !== undefined) await handleHandoffAction(selected, ctx);
      return;
    }
    if (action === "start") {
      await requestStart(ctx, "command");
      return;
    }
    if (action === "settings") {
      if (flow.phase !== "inactive" || writer?.isActive || transition.isProtected) {
        ctx.ui.notify("Configuration cannot be changed while a session handoff is active.", "warning");
        return;
      }
      if (recoveryDialog.isActive) {
        ctx.ui.notify("Configuration cannot be changed while recovery is active.", "warning");
        return;
      }
      try {
        const configured = await loadConfig(dirname(paths.baseDirectory));
        const templateHealth = await resolveHandoffTemplateHealth(configured, paths);
        for (const warning of templateHealth.warnings) ctx.ui.notify(warning, "warning");
      } catch (error) {
        ctx.ui.notify(`Template health check failed: ${errorMessage(error)}`, "error");
        return;
      }
      if (flow.phase !== "inactive" || writer?.isActive || transition.isProtected || recoveryDialog.isActive) {
        ctx.ui.notify("Configuration cannot be changed while another handoff operation is active.", "warning");
        return;
      }
      await configDialog.run(ctx);
      return;
    }
    if (action === "project-template") {
      await projectTemplateDialog.run(ctx);
      return;
    }
    if (action === "recover") {
      if (configDialog.isActive) {
        ctx.ui.notify("Recovery cannot start while configuration is active.", "warning");
        return;
      }
      await recoveryDialog.run(ctx);
      return;
    }
    if (action === "cancel") {
      const transitionCancellation = transition.cancel();
      if (transitionCancellation === "committed") {
        ctx.ui.notify("Session handoff cutover has started and can no longer be cancelled.", "warning");
        return;
      }
      cancellationStartedAt ??= getHandoffActivityStartedAt(STATUS_KEY);
      const activeHandoffId = flow.snapshot?.id;
      const flowCancelled = flow.cancel(ctx);
      if (activeHandoffId !== undefined) handoffTemplates.delete(activeHandoffId);
      const writerCancelled = writer?.beginCancellation(ctx) ?? false;
      if (writer?.cancellationPending) {
        try {
          // Let existing source work and native writes settle; do not abort them.
          await ctx.waitForIdle();
          writer.finalizeCancellation(ctx);
        } catch (error) {
          ctx.ui.notify(`Could not settle session handoff cancellation: ${errorMessage(error)}`, "error");
        }
        return;
      }
      if (transitionCancellation === "cancelled" || writerCancelled || flowCancelled) {
        completeCancellation(true, ctx);
      } else {
        ctx.ui.notify("No active session handoff to cancel.", "info");
      }
      return;
    }
    ctx.ui.notify("Usage: /sh, /sh start, /sh help, /sh recover, /sh settings, /sh project-template, or /sh cancel", "warning");
  };

  pi.registerCommand("sh", {
    description: "Open the session handoff menu (use /sh start to start directly)",
    getArgumentCompletions: (prefix) => [
      { value: "start", label: "start", description: "Start a session handoff" },
      { value: "cancel", label: "cancel", description: "Cancel the active handoff" },
      { value: "recover", label: "recover", description: "Inspect or replay deferred prompts" },
      { value: "settings", label: "settings", description: "Configure global handoff settings" },
      { value: "project-template", label: "project-template", description: "Configure templates for this directory" },
      { value: "help", label: "help", description: "Show commands and usage" },
    ].filter((item) => item.value.startsWith(prefix)),
    handler: async (args, ctx) => {
      await handleHandoffAction(args.trim(), ctx);
    },
  });

  registerPublicHandoffTool(pi, {
    status(ctx) {
      return formatPublicStatus(
        flow.phase,
        ctx.getContextUsage(),
        config,
        getHandoffTerminalState(ctx.sessionManager.getSessionFile()),
        false,
        flow.deferredSnapshot?.prompts.length,
      );
    },
    start(ctx) {
      return requestStart(ctx, "tool");
    },
  });

  pi.on("agent_start", (_event, ctx) => {
    completion.agentStart();
    if (flow.phase !== "inactive") return;
    clearHandoffTerminalState(ctx.sessionManager.getSessionFile());
    updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, "inactive");
  });

  pi.on("turn_start", (event) => completion.turnStart(event.turnIndex));
  pi.on("message_start", (event, ctx) => completion.messageStart(event, ctx));

  pi.on("input", async (event, ctx) => {
    if (completion.input(event, ctx)) return { action: "continue" };
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
      flow.phase === "writing" || flow.phase === "ready",
      undefined,
      result.snapshot.prompts.length,
      undefined,
      true,
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

  pi.on("turn_end", async (event, ctx) => {
    await completion.turnEnd(event, ctx);
    if (event.outcome !== "completed") return;
    const usage = ctx.getContextUsage();
    if (flow.phase !== "inactive") {
      flow.escalateReadiness(usage?.percent, ctx);
      return;
    }
    if (
      automaticAttempts >= 2 ||
      !automaticHandoffEnabled(
        config.automaticSessionHandoff,
        config.automaticSessionHandoffPercent,
      )
    ) return;

    const threshold = automaticAttempts === 0
      ? config.automaticSessionHandoffPercent
      : config.criticalWarningPercent;
    if (
      shouldStartAutomaticHandoff(
        config.automaticSessionHandoff,
        threshold,
        usage?.percent,
      )
    ) {
      await requestAutomaticStart(ctx);
      flow.escalateReadiness(usage?.percent, ctx);
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    const usage = ctx.getContextUsage();
    const warning = contextWarning(usage?.percent, config, advisoryWarningShown);
    if (warning !== undefined && usage?.percent !== null && usage?.percent !== undefined) {
      advisoryWarningShown = true;
      ctx.ui.notify(warningMessage(warning, usage.percent), "warning");
    }

    if (writer?.cancellationPending) {
      writer.handleSettled(ctx);
      return;
    }

    if (flow.phase !== "inactive") {
      flow.handleSettled(ctx);
    }
  });

  pi.on("session_compact", () => {
    if (automaticAttempts === 0) return;
    automaticAttempts = 0;
    pi.appendEntry(AUTOMATIC_ATTEMPT_ENTRY, { attempt: automaticAttempts });
  });

  pi.on("session_before_switch", (event, ctx) => {
    if (
      !writer?.cancellationPending &&
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
      !writer?.cancellationPending &&
      !flow.isTransferProtected &&
      !transition.isProtected &&
      !replacementSessionIsProtected(ctx.sessionManager.getSessionFile())
    ) return;
    ctx.ui.notify("Session fork is blocked while the session handoff transfer is active.", "warning");
    return { cancel: true };
  });

  pi.on("session_before_compact", (_event, ctx) => {
    if (
      !writer?.cancellationPending &&
      !flow.isTransferProtected &&
      !transition.isProtected &&
      !replacementSessionIsProtected(ctx.sessionManager.getSessionFile())
    ) return;
    ctx.ui.notify("Session compaction is blocked while the session handoff transfer is active.", "warning");
    return { cancel: true };
  });

  pi.on("session_before_tree", (_event, ctx) => {
    if (!writer?.cancellationPending) return;
    ctx.ui.notify("Session navigation is blocked while session handoff cancellation is being cleaned up.", "warning");
    return { cancel: true };
  });

  pi.on("session_start", (_event, ctx) => {
    automaticAttempts = restoredAutomaticAttempts(ctx);
    for (const warning of pendingStartupTemplateWarnings) ctx.ui.notify(warning, "warning");
    pendingStartupTemplateWarnings = [];
    navigationDialog?.abort();
    configDialog.discard();
    projectTemplateDialog.discard();
    recoveryDialog.discard();
    advisoryWarningShown = false;
    if (ctx.mode === "tui") registerPersistentHandoffStatus(ctx.ui, STATUS_KEY);
    const terminal = getHandoffTerminalState(ctx.sessionManager.getSessionFile());
    updatePersistentHandoffStatus(ctx.ui, STATUS_KEY, flow.phase, terminal);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    navigationDialog?.abort();
    configDialog.discard();
    projectTemplateDialog.discard();
    recoveryDialog.discard();
    handoffTemplates.clear();
    cancellationStartedAt = undefined;
    writer?.invalidate();
    flow.invalidate();
    transition.invalidate();
    completion.discard();
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

function restoredAutomaticAttempts(ctx: ExtensionContext): number {
  let attempts = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "custom" || entry.customType !== AUTOMATIC_ATTEMPT_ENTRY) continue;
    const attempt = (entry.data as { attempt?: unknown } | undefined)?.attempt;
    if (attempt === 0 || attempt === 1 || attempt === 2) attempts = attempt;
  }
  return attempts;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectSettingsErrorCategory(error: unknown): string {
  if (error instanceof SyntaxError) return "invalid JSON";
  if (typeof error === "object" && error !== null && "code" in error) return "unreadable file";
  return "invalid settings";
}

function writerRuntimeFrom(pi: ExtensionAPI): WriterRuntime | undefined {
  if (
    typeof pi.getActiveTools !== "function"
  ) {
    return undefined;
  }
  return {
    getActiveTools: () => pi.getActiveTools(),
  };
}
