import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

export type PublicHandoffAction = "status" | "start";

export interface PublicHandoffToolHandlers {
  status(ctx: ExtensionContext): string;
  start(ctx: ExtensionContext): string;
}

interface PublicToolParameters {
  action: PublicHandoffAction;
}

interface PublicToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: { action: PublicHandoffAction };
}

export function registerPublicHandoffTool(pi: ExtensionAPI, handlers: PublicHandoffToolHandlers): void {
  const tool = {
    name: "simple_handoff",
    label: "Simple Handoff",
    description:
      "Report simple session handoff status, or start one only when the user explicitly requested a handoff.",
    promptSnippet: "Report handoff status or start an explicitly requested session handoff",
    promptGuidelines: [
      "Use simple_handoff with action start only when the user explicitly requests a session handoff; discussion, questions, criticism, testing, and mentions are not start requests.",
    ],
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "start"],
          description: "Report current status or start an explicitly requested handoff",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      params: PublicToolParameters,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<PublicToolResult> {
      const text = handlers[params.action](ctx);
      return {
        content: [{ type: "text", text }],
        details: { action: params.action },
      };
    },
  };

  // Pi's public tool contract consumes JSON Schema. The package intentionally
  // has no direct TypeBox dependency, so keep the strict schema literal local.
  pi.registerTool(tool as unknown as ToolDefinition);
}
