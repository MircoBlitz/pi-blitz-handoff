import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import { handoffPaths, loadConfig, type HandoffConfig, type HandoffPaths } from "./config.ts";
import { ensureDirectory, requireDirectory } from "./filesystem.ts";
import { HandoffFlow, shouldStartAutomaticHandoff, type HandoffStartSource } from "./flow.ts";
import { registerPublicHandoffTool } from "./public-tool.ts";
import { registerSubmissionTool, SUBMIT_SESSION_HANDOFF_TOOL } from "./submission-tool.ts";
import { contextWarning, formatPublicStatus, persistentHandoffStatus, warningMessage } from "./status.ts";
import { resolveTemplate, shippedDefaultPath, synchronizeManagedDefault } from "./templates.ts";
import { HandoffWriter, type WriterRuntime } from "./writer.ts";

export * from "./config.ts";
export * from "./filesystem.ts";
export * from "./flow.ts";
export * from "./public-tool.ts";
export * from "./readiness.ts";
export * from "./status.ts";
export * from "./submission-tool.ts";
export * from "./templates.ts";
export * from "./writer.ts";

const STATUS_KEY = "pi-simple-handoff";
const READINESS_MESSAGE_TYPE = "pi-simple-handoff-readiness";

export interface InitializedHandoffStorage {
  config: HandoffConfig;
  paths: HandoffPaths;
}

export async function initializeHandoffStorage(
  agentDirectory: string,
  packageDefault = shippedDefaultPath(),
): Promise<InitializedHandoffStorage> {
  const paths = handoffPaths(agentDirectory);
  await ensureDirectory(paths.baseDirectory);
  await ensureDirectory(paths.recoveryDirectory);
  await ensureDirectory(paths.templateDirectory);
  await synchronizeManagedDefault(paths.templateDirectory, packageDefault);

  const config = await loadConfig(agentDirectory);
  await requireDirectory(config.recoveryDirectory);
  if (config.templateDirectory !== null) {
    await requireDirectory(config.templateDirectory);
  }

  return { config, paths };
}

export function activateHandoffExtension(
  pi: ExtensionAPI,
  config: HandoffConfig,
  paths: HandoffPaths = handoffPaths(getAgentDir()),
): HandoffFlow {
  let advisoryWarningShown = false;
  let flow: HandoffFlow;

  const writerRuntime = writerRuntimeFrom(pi);
  const writer = writerRuntime === undefined
    ? undefined
    : new HandoffWriter({
        writerAttempts: config.writerAttempts,
        writerRetryDelaySeconds: config.writerRetryDelaySeconds,
        runtime: writerRuntime,
        resolveTemplate: () =>
          resolveTemplate(config.handoffTemplate, {
            managedDirectory: paths.templateDirectory,
            addendumDirectory: config.templateDirectory,
          }),
        onTemplateFailure(failure, attempt, ctx) {
          ctx.ui.notify(
            `Writer attempt ${attempt} could not use template ${failure.path}: ${failure.reason}`,
            "warning",
          );
        },
        onPhaseChange(phase, _attempt, ctx) {
          if (phase === "resolving" || phase === "writing" || phase === "retry-delay") {
            ctx.ui.setStatus(STATUS_KEY, "Writing Session Handoff");
          }
        },
        onSuccess(result, ctx) {
          ctx.ui.notify(`Session handoff dossier accepted on writer attempt ${result.attempt}.`, "info");
        },
        onTerminalFailure(reason, message, ctx) {
          flow.finish(ctx);
          if (reason !== "cancelled") {
            ctx.ui.notify(message, "error");
          }
        },
      });

  if (writer !== undefined) {
    registerSubmissionTool(pi, (submission) => writer.submit(submission));
    pi.setActiveTools(pi.getActiveTools().filter((name) => name !== SUBMIT_SESSION_HANDOFF_TOOL));
  }

  flow = new HandoffFlow({
    readinessRetrySeconds: config.readinessRetrySeconds,
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
    onReady(handoff, ctx) {
      ctx.ui.notify("Session handoff readiness confirmed.", "info");
      writer?.start(handoff, ctx);
    },
    onPhaseChange(handoff, ctx) {
      ctx.ui.setStatus(STATUS_KEY, persistentHandoffStatus(handoff?.phase ?? "inactive"));
    },
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

    const message = "Session handoff requested. Waiting for readiness.";
    ctx.ui.notify(message, "info");
    return message;
  };

  pi.registerCommand("sh", {
    description: "Start or cancel a session handoff",
    handler: async (args, ctx) => {
      const action = args.trim();
      if (action === "") {
        requestStart(ctx, "command");
        return;
      }
      if (action === "cancel") {
        const writerCancelled = writer?.cancel(ctx) ?? false;
        const flowCancelled = flow.cancel(ctx);
        ctx.ui.notify(
          writerCancelled || flowCancelled
            ? "Session handoff cancelled."
            : "No active session handoff to cancel.",
          "info",
        );
        return;
      }
      ctx.ui.notify("Usage: /sh or /sh cancel", "warning");
    },
  });

  registerPublicHandoffTool(pi, {
    status(ctx) {
      const status = formatPublicStatus(flow.phase, ctx.getContextUsage(), config);
      return writer?.isActive
        ? status.replace(/^Waiting for Session Handoff\./, "Writing Session Handoff.")
        : status;
    },
    start(ctx) {
      return requestStart(ctx, "tool");
    },
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const answer = event.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    flow.handleAssistantAnswer(answer);
  });

  pi.on("input", (event, ctx) => {
    if (event.source === "interactive" || event.source === "rpc") {
      // Steering and follow-up input are deliberately equivalent here: both are
      // ordinary source-session work and invalidate current readiness IDs.
      flow.handleInput(event.source, ctx);
    }
    return { action: "continue" };
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

  pi.on("session_start", (_event, ctx) => {
    advisoryWarningShown = false;
    ctx.ui.setStatus(STATUS_KEY, persistentHandoffStatus(flow.phase));
  });

  pi.on("session_shutdown", (_event, ctx) => {
    writer?.invalidate();
    flow.invalidate();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  return flow;
}

export default async function piSimpleHandoff(pi: ExtensionAPI): Promise<void> {
  const { config, paths } = await initializeHandoffStorage(getAgentDir());
  if (typeof pi.registerCommand === "function") {
    activateHandoffExtension(pi, config, paths);
  }
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
