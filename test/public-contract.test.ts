import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import { defaultConfig, handoffPaths } from "../extensions/config.ts";
import { activateHandoffExtension } from "../extensions/index.ts";

interface RegisteredCommand {
  description?: string;
  getArgumentCompletions?: unknown;
  handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

interface RegisteredTool {
  name: string;
  parameters: {
    properties?: { action?: { enum?: string[] } };
    required?: string[];
    additionalProperties?: boolean;
  };
}

function captureRegistration() {
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, RegisteredTool>();
  const notifications: string[] = [];
  const userMessages: string[] = [];
  const activeTools = ["read", "bash", "submit_session_handoff"];
  let currentTools = [...activeTools];
  let nativeStarts = 0;
  let sessionStartHandler: ((event: unknown, ctx: unknown) => void | Promise<void>) | undefined;

  const context = {
    mode: "tui",
    hasUI: true,
    isIdle: () => true,
    hasPendingMessages: () => false,
    getContextUsage: () => ({ tokens: 1_000, contextWindow: 100_000, percent: 1 }),
    sessionManager: { getSessionFile: () => "/sessions/public-contract.jsonl", getEntries: () => [] },
    ui: {
      async select() {
        return undefined;
      },
      async input() {
        return undefined;
      },
      async confirm() {
        return false;
      },
      notify(message: string) {
        notifications.push(message);
      },
      setWidget() {},
    },
    async newSession() {
      nativeStarts += 1;
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext;

  const api = {
    registerCommand(name: string, command: RegisteredCommand) {
      commands.set(name, command);
    },
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool);
    },
    on(event: string, handler: unknown) {
      if (event === "session_start") {
        sessionStartHandler = handler as (event: unknown, ctx: unknown) => void | Promise<void>;
      }
    },
    getActiveTools() {
      return [...currentTools];
    },
    setActiveTools(names: string[]) {
      currentTools = [...names];
    },
    sendMessage() {},
    sendUserMessage(content: string) {
      userMessages.push(content);
    },
  } as unknown as ExtensionAPI;

  const agentDirectory = "/tmp/pi-blitz-handoff-public-contract";
  activateHandoffExtension(api, defaultConfig(agentDirectory), handoffPaths(agentDirectory), "CALL TEMPLATE");
  return {
    commands,
    tools,
    notifications,
    userMessages,
    context,
    getActiveTools: () => currentTools,
    getNativeStarts: () => nativeStarts,
    startSession: async () => {
      await sessionStartHandler?.({ type: "session_start", reason: "startup" }, context);
    },
  };
}

test("handoff commands expose the main command and separate documented helpers", async () => {
  const rig = captureRegistration();
  assert.deepEqual(
    [...rig.commands.keys()].sort(),
    ["__pi_blitz_handoff_transition", "sh", "sh-cancel", "sh-config", "sh-help", "sh-recover"],
  );

  const advertised = [...rig.commands.entries()]
    .filter(([, command]) => command.description !== undefined)
    .map(([name]) => name);
  assert.deepEqual(advertised, ["sh", "sh-help", "sh-cancel", "sh-recover", "sh-config"]);
  assert.match(rig.commands.get("sh")?.description ?? "", /Start a session handoff/);
  assert.equal(rig.commands.get("sh")?.getArgumentCompletions, undefined);
  assert.equal(rig.commands.get("__pi_blitz_handoff_transition")?.description, undefined);

  await rig.commands.get("sh")?.handler("retry", rig.context);
  assert.equal(rig.notifications.at(-1), "Usage: /sh, /sh-help, /sh-recover, /sh-config, or /sh-cancel");
  assert.deepEqual([...rig.commands.keys()].filter((name) => ["shconfig", "sh-retry", "sh-cleanup"].includes(name)), []);
});

test("blitz_handoff exposes only status and initializes the writer submission tool at session_start", async () => {
  const rig = captureRegistration();
  await rig.startSession();
  assert.deepEqual([...rig.tools.keys()].sort(), [
    "blitz_handoff",
    "session_handoff_go",
    "session_handoff_go_with_user_deferral",
    "submit_session_handoff",
  ]);

  const publicTool = rig.tools.get("blitz_handoff");
  assert.ok(publicTool);
  assert.deepEqual(publicTool.parameters.properties?.action?.enum, ["status", "start"]);
  assert.deepEqual(publicTool.parameters.required, ["action"]);
  assert.equal(publicTool.parameters.additionalProperties, false);
  assert.deepEqual(rig.getActiveTools(), ["read", "bash"]);
});

test("the private correlated transition rejects direct or stale invocation and is not an initiation path", async () => {
  const rig = captureRegistration();
  const privateCommand = rig.commands.get("__pi_blitz_handoff_transition");
  assert.ok(privateCommand);

  await privateCommand.handler("invented-token", rig.context);

  assert.equal(rig.getNativeStarts(), 0);
  assert.deepEqual(rig.userMessages, []);
  assert.match(rig.notifications.at(-1) ?? "", /stale or uncorrelated/);
});
