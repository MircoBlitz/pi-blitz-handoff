import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  registerSubmissionTool,
  SUBMIT_SESSION_HANDOFF_TOOL,
  validateSubmission,
  type SessionHandoffSubmission,
} from "../extensions/submission-tool.ts";

test("submission validation checks only exact correlation, nonempty content, and NUL absence", () => {
  assert.equal(validateSubmission({ id: "current", content: "# Handoff" }, "current"), undefined);
  assert.equal(validateSubmission({ id: "current", content: "   \n" }, "current"), undefined);
  assert.equal(validateSubmission({ id: "current", content: "not markdown" }, "current"), undefined);
  assert.equal(validateSubmission({ id: "current", content: "x".repeat(100_000) }, "current"), undefined);

  assert.match(validateSubmission({ id: "stale", content: "content" }, "current") ?? "", /does not match/);
  assert.match(validateSubmission({ id: "current", content: "" }, "current") ?? "", /must not be empty/);
  assert.match(validateSubmission({ id: "current", content: "before\0after" }, "current") ?? "", /NUL/);
});

test("registered submission tool exposes exactly id and content and terminates after acceptance", async () => {
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
  assert.deepEqual(Object.keys(definition?.parameters.properties ?? {}).sort(), ["content", "id"]);
  assert.deepEqual(definition?.parameters.required, ["id", "content"]);
  assert.equal(definition?.parameters.additionalProperties, false);

  const result = await definition?.execute("call-1", { id: "id-1", content: "# Exact dossier" });
  assert.deepEqual(accepted, [{ id: "id-1", content: "# Exact dossier" }]);
  assert.equal(result?.terminate, true);
  assert.deepEqual(result?.details, { id: "id-1" });
});
