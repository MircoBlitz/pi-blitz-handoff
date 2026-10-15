import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  registerSubmissionTool,
  SUBMIT_SESSION_HANDOFF_TOOL,
  validateSubmission,
  type SessionHandoffSubmission,
} from "../extensions/submission-tool.ts";

test("DONE submission validates only exact attempt correlation", () => {
  assert.equal(validateSubmission({ id: "current" }, "current"), undefined);
  assert.match(validateSubmission({ id: "stale" }, "current") ?? "", /does not match/);
});

test("submission tool accepts only an ID, no content or path, and terminates after acceptance", async () => {
  // Test double: captures the public Pi registration without executing a model.
  let definition: {
    name: string;
    parameters: {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    execute(toolCallId: string, params: SessionHandoffSubmission): Promise<{
      content: Array<{ type: "text"; text: string }>;
      details: { id: string };
      terminate: true;
    }>;
  } | undefined;
  const accepted: SessionHandoffSubmission[] = [];
  const pi = {
    registerTool(tool: typeof definition) {
      definition = tool;
    },
  } as unknown as ExtensionAPI;

  registerSubmissionTool(pi, (submission) => accepted.push(submission));
  assert.equal(definition?.name, SUBMIT_SESSION_HANDOFF_TOOL);
  assert.deepEqual(Object.keys(definition?.parameters.properties ?? {}), ["id"]);
  assert.deepEqual(definition?.parameters.required, ["id"]);
  assert.equal(definition?.parameters.additionalProperties, false);

  const result = await definition?.execute("call-1", { id: "id-1" });
  assert.deepEqual(accepted, [{ id: "id-1" }]);
  assert.equal(result?.terminate, true);
  assert.deepEqual(result?.details, { id: "id-1" });
});
