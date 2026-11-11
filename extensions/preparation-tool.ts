import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

export const SESSION_HANDOFF_GET_TEMPLATE_TOOL = "session_handoff_get_template";

export function registerPreparationTool(
  pi: ExtensionAPI,
  prepare: (ctx: ExtensionContext) => Promise<{ text: string; onReturn(): void }>,
): void {
  pi.registerTool({
    name: SESSION_HANDOFF_GET_TEMPLATE_TOOL,
    executionMode: "sequential",
    label: "Get Handoff Template",
    description: "Retrieve the active handoff template, exact file path, source transcript locator and Finish ID before writing. Repeated retrieval shares the same snapshot.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      _params: Record<string, never>,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      signal?.throwIfAborted();
      const prepared = await prepare(ctx);
      signal?.throwIfAborted();
      prepared.onReturn();
      return {
        content: [{ type: "text", text: prepared.text }],
        details: {},
      };
    },
  } as unknown as ToolDefinition);
}
