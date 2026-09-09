import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

import type {
  HandoffDeferralChoice,
  HandoffDeferralResult,
  HandoffGoResult,
} from "./flow.ts";
import {
  SESSION_HANDOFF_GO_TOOL,
  SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL,
} from "./readiness.ts";

export interface SessionHandoffGoInput {
  key: string;
}

export interface SessionHandoffGoWithUserDeferralInput extends SessionHandoffGoInput {
  reason: string;
}

export interface HandoffGoHandlers {
  accept(key: string, ctx: ExtensionContext): HandoffGoResult;
  beginUserDeferral(key: string, ctx: ExtensionContext): HandoffDeferralResult;
  resolveUserDeferral(key: string, choice: HandoffDeferralChoice, ctx: ExtensionContext): HandoffDeferralResult;
}

export function registerSessionHandoffGoTools(pi: ExtensionAPI, handlers: HandoffGoHandlers): void {
  pi.registerTool({
    name: SESSION_HANDOFF_GO_TOOL,
    label: "Session Handoff GO",
    description: "Accept the current session handoff immediately using its exact correlation key.",
    parameters: keyParameters(),
    async execute(
      _toolCallId: string,
      params: SessionHandoffGoInput,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      requireAccepted(handlers.accept(params.key, ctx));
      return toolResult("Session handoff GO accepted.", "ready");
    },
  } as unknown as ToolDefinition);

  pi.registerTool({
    name: SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL,
    label: "Session Handoff GO With User Deferral",
    description: "Open an extension-owned Ready / Wait / Cancel choice only when a concrete active user interaction may still matter before replacement.",
    parameters: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "Exact correlation key supplied by the current session handoff instruction",
        },
        reason: {
          type: "string",
          minLength: 1,
          description: "Short concrete explanation of the active collaboration or user interaction",
        },
      },
      required: ["key", "reason"],
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      params: SessionHandoffGoWithUserDeferralInput,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      if (!ctx.hasUI) throw new Error("Session handoff user deferral requires an interactive UI");
      requireAccepted(handlers.beginUserDeferral(params.key, ctx));

      let selected: string | undefined;
      try {
        selected = await ctx.ui.select(
          `Your LLM reports an active user interaction:\n${params.reason}`,
          ["Ready", "Wait", "Cancel"],
          { signal },
        );
      } catch (error) {
        handlers.resolveUserDeferral(params.key, "Cancel", ctx);
        throw error;
      }

      const choice: HandoffDeferralChoice = selected === "Ready" || selected === "Wait" ? selected : "Cancel";
      requireAccepted(handlers.resolveUserDeferral(params.key, choice, ctx));
      const message = choice === "Ready"
        ? "Session handoff GO accepted."
        : choice === "Wait"
          ? "Session handoff is awaiting user GO."
          : "Session handoff cancelled.";
      return toolResult(message, choice.toLowerCase());
    },
  } as unknown as ToolDefinition);
}

function keyParameters() {
  return {
    type: "object",
    properties: {
      key: {
        type: "string",
        description: "Exact correlation key supplied by the current session handoff instruction",
      },
    },
    required: ["key"],
    additionalProperties: false,
  };
}

function requireAccepted(result: HandoffGoResult | HandoffDeferralResult): void {
  if (result === "accepted") return;
  if (result === "not-started") throw new Error("No session handoff is waiting for GO");
  if (result === "automatic") throw new Error("User deferral is unavailable for an automatically initiated session handoff; use direct GO");
  if (result === "selection-open") throw new Error("A session handoff user choice is already open");
  throw new Error("Session handoff GO key is stale, invalid, or used at the wrong entry point");
}

function toolResult(message: string, outcome: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: { accepted: true as const, outcome },
    terminate: true as const,
  };
}
