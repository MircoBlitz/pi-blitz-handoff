import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

import { handoffPaths, loadConfig, type HandoffConfig, type HandoffPaths } from "./config.ts";
import { ensureDirectory, requireDirectory } from "./filesystem.ts";
import { HandoffFlow, shouldStartAutomaticHandoff, type HandoffStartSource } from "./flow.ts";
import { registerPublicHandoffTool } from "./public-tool.ts";
import { contextWarning, formatPublicStatus, persistentHandoffStatus, warningMessage } from "./status.ts";
import { shippedDefaultPath, synchronizeManagedDefault } from "./templates.ts";

export * from "./config.ts";
export * from "./filesystem.ts";
export * from "./flow.ts";
export * from "./public-tool.ts";
export * from "./readiness.ts";
export * from "./status.ts";
export * from "./templates.ts";

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

export function activateHandoffExtension(pi: ExtensionAPI, config: HandoffConfig): HandoffFlow {
  let advisoryWarningShown = false;

  const flow = new HandoffFlow({
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
    onReady(_handoff, ctx) {
      ctx.ui.notify("Session handoff readiness confirmed.", "info");
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
        ctx.ui.notify(
          flow.cancel(ctx) ? "Session handoff cancelled." : "No active session handoff to cancel.",
          "info",
        );
        return;
      }
      ctx.ui.notify("Usage: /sh or /sh cancel", "warning");
    },
  });

  registerPublicHandoffTool(pi, {
    status(ctx) {
      return formatPublicStatus(flow.phase, ctx.getContextUsage(), config);
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
    flow.invalidate();
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  return flow;
}

export default async function piSimpleHandoff(pi: ExtensionAPI): Promise<void> {
  const { config } = await initializeHandoffStorage(getAgentDir());
  if (typeof pi.registerCommand === "function") {
    activateHandoffExtension(pi, config);
  }
}
