import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerSessionHandoffGoTools } from "../extensions/go-tool.ts";
import { SESSION_HANDOFF_GO_TOOL, SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL } from "../extensions/readiness.ts";
import { createDialogHarness } from "./extension-harness.ts";

type Execute = (id: string, params: Record<string, string>, signal: AbortSignal | undefined, update: unknown, ctx: ExtensionContext) => Promise<{ content: Array<{ text: string }>; terminate: boolean }>;

function setup(choice: string | null = "Ready", mode: "rpc" | "tui" = "rpc") {
  const tools = new Map<string, { parameters: unknown; execute: Execute }>();
  const calls: string[] = [];
  let selection: { title: string; options: string[] } | undefined;
  const api = {
    registerTool(tool: { name: string; parameters: unknown; execute: Execute }) { tools.set(tool.name, tool); },
  } as unknown as ExtensionAPI;
  const dialogs = createDialogHarness({ select: async (title, options) => {
    selection = { title, options };
    return choice ?? undefined;
  } });
  const context = {
    mode,
    hasUI: true,
    ui: {
      custom: dialogs.custom,
      async select(title: string, options: string[]) {
        selection = { title, options };
        return choice ?? undefined;
      },
    },
  } as unknown as ExtensionContext;
  registerSessionHandoffGoTools(api, {
    accept(key) { calls.push(`direct:${key}`); return key === "current" ? "accepted" : "stale"; },
    beginUserDeferral(key) { calls.push(`begin:${key}`); return key === "current" ? "accepted" : "stale"; },
    resolveUserDeferral(key, result) { calls.push(`resolve:${key}:${result}`); return key === "current" ? "accepted" : "stale"; },
  });
  return { tools, calls, context, dialogs, getSelection: () => selection };
}

test("registers two strict correlated schemas", () => {
  const rig = setup();
  assert.deepEqual([...rig.tools.keys()], [SESSION_HANDOFF_GO_TOOL, SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL]);
  assert.deepEqual(rig.tools.get(SESSION_HANDOFF_GO_TOOL)?.parameters, {
    type: "object",
    properties: { key: { type: "string", description: "Exact correlation key supplied by the current session handoff instruction" } },
    required: ["key"],
    additionalProperties: false,
  });
  assert.deepEqual((rig.tools.get(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL)?.parameters as { required: string[] }).required, ["key", "reason"]);
});

test("direct GO rejects stale correlation and accepts the current key", async () => {
  const rig = setup();
  const execute = rig.tools.get(SESSION_HANDOFF_GO_TOOL)?.execute;
  assert.ok(execute);
  await assert.rejects(execute("1", { key: "stale" }, undefined, undefined, rig.context), /stale, invalid, or used at the wrong entry point/);
  const result = await execute("2", { key: "current" }, undefined, undefined, rig.context);
  assert.equal(result.terminate, true);
  assert.deepEqual(rig.calls, ["direct:stale", "direct:current"]);
});

for (const choice of ["Ready", "Wait", "Cancel", null] as const) {
  test(`deferral tool presents extension-owned choices and resolves ${String(choice)}`, async () => {
    const rig = setup(choice);
    const execute = rig.tools.get(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL)?.execute;
    assert.ok(execute);
    const result = await execute("1", { key: "current", reason: "Need the user's active review" }, undefined, undefined, rig.context);
    assert.deepEqual(rig.getSelection(), {
      title: "Your LLM reports an active user interaction:\nNeed the user's active review",
      options: ["Ready", "Wait", "Cancel"],
    });
    const resolved = choice === "Ready" || choice === "Wait" ? choice : "Cancel";
    assert.deepEqual(rig.calls, ["begin:current", `resolve:current:${resolved}`]);
    assert.equal(result.terminate, true);
  });
}

for (const choice of ["Ready", "Wait", "Cancel", null] as const) {
  test(`native readiness overlay resolves ${String(choice)} through actual SelectList keys`, async () => {
    const rig = setup(choice, "tui");
    const execute = rig.tools.get(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL)?.execute;
    assert.ok(execute);
    await execute("1", { key: "current", reason: "Active review" }, undefined, undefined, rig.context);
    const resolved = choice === "Ready" || choice === "Wait" ? choice : "Cancel";
    assert.deepEqual(rig.calls, ["begin:current", `resolve:current:${resolved}`]);
    assert.equal(rig.dialogs.options.length, 1);
    assert.equal((rig.dialogs.options[0] as { overlay?: boolean }).overlay, true);
    assert.ok(rig.dialogs.screens.flat().some((line) => line.includes("Ready / Wait / Cancel")));
  });
}

test("already-aborted readiness UI resolves Cancel without creating an overlay", async () => {
  const rig = setup("Ready", "tui");
  const controller = new AbortController();
  controller.abort();
  await rig.tools.get(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL)?.execute("1", { key: "current", reason: "Active review" }, controller.signal, undefined, rig.context);
  assert.deepEqual(rig.calls, ["begin:current", "resolve:current:Cancel"]);
  assert.equal(rig.dialogs.options.length, 0);
});

test("deferral rejects stale keys before opening UI", async () => {
  const rig = setup();
  const execute = rig.tools.get(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL)?.execute;
  assert.ok(execute);
  await assert.rejects(
    execute("1", { key: "stale", reason: "Active review" }, undefined, undefined, rig.context),
    /stale, invalid, or used at the wrong entry point/,
  );
  assert.equal(rig.getSelection(), undefined);
});
