import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

export const SUBMIT_SESSION_HANDOFF_TOOL = "submit_session_handoff";

export interface SessionHandoffSubmission {
  id: string;
}

export type SubmissionHandler = (submission: SessionHandoffSubmission) => void;

export function validateSubmission(
  submission: SessionHandoffSubmission,
  currentSubmissionId: string,
): string | undefined {
  if (submission.id !== currentSubmissionId) {
    return "Submission ID does not match the current writer attempt";
  }
  return undefined;
}

export function registerSubmissionTool(pi: ExtensionAPI, submit: SubmissionHandler): void {
  const tool = {
    name: SUBMIT_SESSION_HANDOFF_TOOL,
    label: "Session Handoff DONE",
    description: "Signal DONE after GO: the handoff file is complete and updated for the exact current writer attempt. Does not receive or save the file content.",
    promptSnippet: "Submit DONE after GO with only the exact submission ID",
    promptGuidelines: [
      "Only after GO and finalizing the complete current handoff file, use submit_session_handoff exactly once with only the current submission ID.",
    ],
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Exact submission ID supplied in the writer prompt",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    async execute(
      _toolCallId: string,
      params: SessionHandoffSubmission,
    ): Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: { id: string };
      terminate: true;
    }> {
      submit(params);
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
