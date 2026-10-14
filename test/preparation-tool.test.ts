import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { registerPreparationTool, speedModeReadiness } from "../extensions/preparation-tool.ts";

// Registration and context test doubles; no model or Pi session is started.
function register(prepare: (key: string) => Promise<string>, onReturn = () => {}): ToolDefinition {
  let tool: ToolDefinition | undefined;
  registerPreparationTool({ registerTool(value: ToolDefinition) { tool = value; } } as ExtensionAPI,
    async (key) => ({ text: await prepare(key), onReturn }));
  assert.ok(tool);
  return tool;
}

const ctx = {} as ExtensionContext;

test("GET is a continuing retrieval with an exact key-only schema", async () => {
  let returned = 0;
  const tool = register(async (key) => `prepared ${key}`, () => { returned += 1; });
  assert.equal(tool.name, "session_handoff_get_template");
  assert.deepEqual(tool.parameters, {
    type: "object",
    properties: { key: { type: "string", description: "Exact correlation key supplied by the current readiness instruction" } },
    required: ["key"],
    additionalProperties: false,
  });
  const result = await tool.execute("get", { key: "current" }, undefined, undefined, ctx);
  assert.deepEqual(result.content, [{ type: "text", text: "prepared current" }]);
  assert.equal(result.terminate, undefined);
  assert.equal(returned, 1);
});

test("GET observes native abort before starting preparation", async () => {
  let calls = 0;
  const tool = register(async () => { calls += 1; return "unused"; });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(tool.execute("get", { key: "current" }, controller.signal, undefined, ctx), { name: "AbortError" });
  assert.equal(calls, 0);
});

test("GET observes native abort after awaited preparation without returning stale guidance", async () => {
  const controller = new AbortController();
  let returned = 0;
  const tool = register(async () => { controller.abort(); return "prepared"; }, () => { returned += 1; });
  await assert.rejects(tool.execute("get", { key: "current" }, controller.signal, undefined, ctx), { name: "AbortError" });
  assert.equal(returned, 0);
});

test("Speed Mode guidance preserves the source policy and distinct optional GET, GO and DONE", () => {
  const prompt = speedModeReadiness("CUSTOM READINESS");
  assert.match(prompt, /^CUSTOM READINESS\n/);
  assert.match(prompt, /Preparation is optional; do not delay required in-flight work/);
  assert.match(prompt, /do not delay required in-flight work or call GET and GO concurrently/);
  assert.match(prompt, /GO still means the safe work boundary, not a completed file/);
  assert.match(prompt, /update every relevant fact, result and permission/);
  assert.match(prompt, /it will not be resent after GO/);
  assert.match(prompt, /If you skipped early retrieval, the normal writer receives it after GO/);
});
