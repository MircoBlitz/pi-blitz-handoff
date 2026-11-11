import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

export const SESSION_HANDOFF_FINISH_TOOL = "session_handoff_finish";

export interface SessionHandoffSubmission {
  id: string;
}

export type SubmissionHandler = (submission: SessionHandoffSubmission, ctx: ExtensionContext) => void;

export function validateSubmission(
  submission: SessionHandoffSubmission,
  currentSubmissionId: string,
): string | undefined {
  if (submission.id !== currentSubmissionId) {
    return "Finish ID does not match the current handoff";
  }
  return undefined;
}

export function registerSubmissionTool(pi: ExtensionAPI, submit: SubmissionHandler): void {
  const tool = {
    name: SESSION_HANDOFF_FINISH_TOOL,
    executionMode: "sequential",
    label: "Finish Session Handoff",
    description: "At the safe checkpoint, mark the complete updated handoff file ready using the exact ID returned by successful template retrieval. Accepts no content or path.",
    promptSnippet: "Finish the retrieved handoff with its exact ID only",
    promptGuidelines: [
      "Use session_handoff_finish once after successful session_handoff_get_template retrieval and finalizing the supplied file at the safe checkpoint.",
    ],
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Exact Finish ID returned by session_handoff_get_template",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      params: SessionHandoffSubmission,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: { id: string };
      terminate: true;
    }> {
      signal?.throwIfAborted();
      submit(params, ctx);
      return {
        content: [{ type: "text", text: "Session handoff file marked ready." }],
        details: { id: params.id },
        terminate: true,
      };
    },
  };

  // Pi consumes JSON Schema here. Keeping the strict schema literal local avoids
  // adding TypeBox as a runtime dependency solely for this single-field tool.
  pi.registerTool(tool as unknown as ToolDefinition);
}
