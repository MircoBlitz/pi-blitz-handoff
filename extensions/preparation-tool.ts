import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

export const SESSION_HANDOFF_GET_TEMPLATE_TOOL = "session_handoff_get_template";

export function registerPreparationTool(
  pi: ExtensionAPI,
  prepare: (key: string, ctx: ExtensionContext) => Promise<{ text: string; onReturn(): void }>,
): void {
  pi.registerTool({
    name: SESSION_HANDOFF_GET_TEMPLATE_TOOL,
    label: "Get Handoff Template",
    description: "When Prepare while waiting is enabled, retrieve the current handoff template and file path before GO for optional early drafting. Does not accept GO or DONE.",
    parameters: {
      type: "object",
      properties: { key: { type: "string", description: "Exact correlation key supplied by the current readiness instruction" } },
      required: ["key"],
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      params: { key: string },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      signal?.throwIfAborted();
      const prepared = await prepare(params.key, ctx);
      signal?.throwIfAborted();
      prepared.onReturn();
      return {
        content: [{ type: "text", text: prepared.text }],
        details: { key: params.key },
      };
    },
  } as unknown as ToolDefinition);
}

export function prepareWhileWaitingReadiness(prompt: string): string {
  return [
    prompt,
    "Prepare while waiting is enabled. While genuinely waiting before the safe boundary, you may call session_handoff_get_template with the current readiness key and draft the supplied file using your existing tools. Preparation is optional; do not delay required in-flight work or call GET and GO concurrently.",
    "GO still means the safe work boundary, not a completed file. After GO, wait for the writer/finalization instruction, update every relevant fact, result and permission, then submit DONE with only the exact submission ID. If you retrieved the template early, it will not be resent after GO. If you skipped early retrieval, the normal writer receives it after GO.",
  ].join("\n\n");
}
