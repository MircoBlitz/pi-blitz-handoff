import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

export const SUBMIT_SESSION_HANDOFF_TOOL = "submit_session_handoff";

export interface SessionHandoffSubmission {
  id: string;
  content: string;
}

export type SubmissionHandler = (submission: SessionHandoffSubmission) => void;

export function validateSubmission(
  submission: SessionHandoffSubmission,
  currentSubmissionId: string,
): string | undefined {
  if (submission.id !== currentSubmissionId) {
    return "Submission ID does not match the current writer attempt";
  }
  if (submission.content.length === 0) {
    return "Session handoff content must not be empty";
  }
  if (submission.content.includes("\0")) {
    return "Session handoff content must not contain NUL";
  }
  return undefined;
}

export function registerSubmissionTool(pi: ExtensionAPI, submit: SubmissionHandler): void {
  const tool = {
    name: SUBMIT_SESSION_HANDOFF_TOOL,
    label: "Submit Session Handoff",
    description: "Submit the complete session handoff for the exact current writer attempt.",
    promptSnippet: "Submit the complete session handoff exactly once",
    promptGuidelines: [
      "Use submit_session_handoff exactly once with the current submission ID and the complete handoff content.",
    ],
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Exact submission ID supplied in the writer prompt",
        },
        content: {
          type: "string",
          description: "Complete handoff Markdown",
        },
      },
      required: ["id", "content"],
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
        content: [{ type: "text", text: "Session handoff submitted." }],
        details: { id: params.id },
        terminate: true,
      };
    },
  };

  // Pi consumes JSON Schema here. Keeping the strict schema literal local avoids
  // adding TypeBox as a runtime dependency solely for this two-field tool.
  pi.registerTool(tool as unknown as ToolDefinition);
}
