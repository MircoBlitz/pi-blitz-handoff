import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AgentSettledEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  MessageEndEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { defaultConfig, handoffPaths, type HandoffConfig } from "../extensions/pi-simple-handoff/config.ts";
import { activateHandoffExtension } from "../extensions/pi-simple-handoff/index.ts";

interface RuntimeState {
  idle: boolean;
  pending: boolean;
  sessionFile?: string;
  percent?: number | null;
}

interface Notification {
  message: string;
  type?: "info" | "warning" | "error";
}

interface SentMessage {
  message: { customType: string; content: string; display: boolean };
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" };
}

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type InputHandler = (event: InputEvent, ctx: ExtensionContext) => InputEventResult | void | Promise<InputEventResult | void>;
type SettledHandler = (event: AgentSettledEvent, ctx: ExtensionContext) => void | Promise<void>;
type MessageEndHandler = (event: MessageEndEvent, ctx: ExtensionContext) => void | Promise<void>;
type SessionStartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => void | Promise<void>;
type SessionShutdownHandler = (event: SessionShutdownEvent, ctx: ExtensionContext) => void | Promise<void>;
type SelectHandler = (
  title: string,
  options: string[],
  opts?: { signal?: AbortSignal },
) => Promise<string | undefined>;
type ToolExecute = (
  toolCallId: string,
  params: { action: "status" | "start" },
  signal: AbortSignal | undefined,
  onUpdate: undefined,
  ctx: ExtensionContext,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

function createRig(
  configChanges: Partial<HandoffConfig> = {},
  stateChanges: Partial<RuntimeState> = {},
  agentDirectory = "/tmp/pi-simple-handoff-test-agent",
) {
  const state: RuntimeState = {
    idle: true,
    pending: false,
    sessionFile: "/sessions/source.jsonl",
    percent: 10,
    ...stateChanges,
  };
  const notifications: Notification[] = [];
  const statuses: Array<string | undefined> = [];
  const sentMessages: SentMessage[] = [];
  const commands = new Map<string, CommandHandler>();
  const handlers: {
    input?: InputHandler;
    agent_settled?: SettledHandler;
    message_end?: MessageEndHandler;
    session_start?: SessionStartHandler;
    session_shutdown?: SessionShutdownHandler;
  } = {};
  let toolExecute: ToolExecute | undefined;
  let selectHandler: SelectHandler = async () => undefined;

  const context = {
    mode: "tui",
    hasUI: true,
    isIdle: () => state.idle,
    hasPendingMessages: () => state.pending,
    getContextUsage: () => ({
      tokens: state.percent === null || state.percent === undefined ? null : state.percent * 1000,
      contextWindow: 100_000,
      percent: state.percent ?? null,
    }),
    sessionManager: { getSessionFile: () => state.sessionFile },
    ui: {
      select(title: string, options: string[], opts?: { signal?: AbortSignal }) {
        return selectHandler(title, options, opts);
      },
      async input() {
        return undefined;
      },
      async confirm() {
        return false;
      },
      notify(message: string, type?: "info" | "warning" | "error") {
        notifications.push({ message, type });
      },
      setStatus(_key: string, text: string | undefined) {
        statuses.push(text);
      },
    },
  } as unknown as ExtensionCommandContext;

  const api = {
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
    registerTool(tool: { execute: ToolExecute }) {
      toolExecute = tool.execute;
    },
    on(event: string, handler: unknown) {
      if (event === "input") handlers.input = handler as InputHandler;
      if (event === "agent_settled") handlers.agent_settled = handler as SettledHandler;
      if (event === "message_end") handlers.message_end = handler as MessageEndHandler;
      if (event === "session_start") handlers.session_start = handler as SessionStartHandler;
      if (event === "session_shutdown") handlers.session_shutdown = handler as SessionShutdownHandler;
    },
    sendMessage(message: SentMessage["message"], options?: SentMessage["options"]) {
      sentMessages.push({ message, options });
    },
  } as unknown as ExtensionAPI;

  const config = { ...defaultConfig(agentDirectory), ...configChanges };
  const flow = activateHandoffExtension(api, config, handoffPaths(agentDirectory));
  return {
    state,
    notifications,
    statuses,
    sentMessages,
    commands,
    handlers,
    context,
    flow,
    setSelectHandler(handler: SelectHandler) {
      selectHandler = handler;
    },
    getToolExecute: () => {
      if (toolExecute === undefined) throw new Error("tool was not registered");
      return toolExecute;
    },
  };
}

function assistantMessage(text: string): MessageEndEvent {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
  } as MessageEndEvent;
}

test("/sh starts immediately only at an idle, no-pending boundary and duplicate start is visible", async () => {
  const rig = createRig();
  const command = rig.commands.get("sh");
  assert.ok(command);

  await command("", rig.context);
  assert.equal(rig.sentMessages.length, 1);
  assert.deepEqual(rig.sentMessages[0]?.options, { deliverAs: "followUp", triggerTurn: true });
  const identity = rig.flow.snapshot;

  await command("", rig.context);
  assert.equal(rig.sentMessages.length, 1);
  assert.deepEqual(rig.flow.snapshot, identity);
  assert.equal(rig.notifications.at(-1)?.message, "A session handoff is already active.");
});

test("simple_handoff start records intent during a run while status remains factual", async () => {
  const rig = createRig({}, { idle: false, percent: 65 });
  const execute = rig.getToolExecute();

  const started = await execute("call-1", { action: "start" }, undefined, undefined, rig.context);
  assert.equal(started.content[0]?.text, "Session handoff requested. Waiting for readiness.");
  assert.equal(rig.sentMessages.length, 0);

  rig.state.idle = true;
  await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);
  assert.equal(rig.sentMessages.length, 1);

  const status = await execute("call-2", { action: "status" }, undefined, undefined, rig.context);
  assert.match(status.content[0]?.text ?? "", /Waiting for Session Handoff/);
  assert.match(status.content[0]?.text ?? "", /Context usage: 65%/);
});

test("persisted-session prerequisite is visible for command and tool starts", async () => {
  const commandRig = createRig({}, { sessionFile: undefined });
  await commandRig.commands.get("sh")?.("", commandRig.context);
  assert.equal(commandRig.sentMessages.length, 0);
  assert.equal(commandRig.notifications.at(-1)?.type, "error");
  assert.match(commandRig.notifications.at(-1)?.message ?? "", /persisted source session/);

  const toolRig = createRig({}, { sessionFile: undefined });
  const result = await toolRig.getToolExecute()("call", { action: "start" }, undefined, undefined, toolRig.context);
  assert.match(result.content[0]?.text ?? "", /--no-session/);
  assert.equal(toolRig.flow.phase, "inactive");
});

test("/sh config stays in extension UI and reload or session replacement discards its draft", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-simple-handoff-extension-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const reason of ["reload", "new"] as const) {
    const rig = createRig({}, {}, join(root, reason));
    let observedSignal: AbortSignal | undefined;
    let markPromptStarted: (() => void) | undefined;
    const promptStarted = new Promise<void>((resolve) => {
      markPromptStarted = resolve;
    });
    rig.setSelectHandler(async (title, options, opts) => {
      assert.equal(title, "Configure pi-simple-handoff");
      assert.equal(options.length, 12);
      observedSignal = opts?.signal;
      markPromptStarted?.();
      return new Promise<string | undefined>((resolve) => {
        opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
      });
    });

    const running = rig.commands.get("sh")?.("config", rig.context);
    assert.ok(running);
    await promptStarted;
    await rig.handlers.session_shutdown?.({ type: "session_shutdown", reason }, rig.context);
    await running;

    assert.equal(observedSignal?.aborted, true);
    assert.equal(rig.sentMessages.length, 0);
    assert.equal(rig.notifications.length, 0);
  }
});

test("automatic initiation occurs only when enabled, at threshold, settled, and without pending messages", async () => {
  const disabled = createRig({ automaticSessionHandoff: false }, { percent: 99 });
  await disabled.handlers.agent_settled?.({ type: "agent_settled" }, disabled.context);
  assert.equal(disabled.flow.phase, "inactive");

  const below = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70 },
    { percent: 69 },
  );
  await below.handlers.agent_settled?.({ type: "agent_settled" }, below.context);
  assert.equal(below.flow.phase, "inactive");

  const pending = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70 },
    { percent: 70, pending: true },
  );
  await pending.handlers.agent_settled?.({ type: "agent_settled" }, pending.context);
  assert.equal(pending.flow.phase, "inactive");

  const enabled = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70 },
    { percent: 70 },
  );
  await enabled.handlers.agent_settled?.({ type: "agent_settled" }, enabled.context);
  assert.equal(enabled.flow.snapshot?.source, "automatic");
  assert.equal(enabled.sentMessages.length, 1);
});

test("explicit command start ignores automatic and warning thresholds", async () => {
  const rig = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 100 },
    { percent: 1 },
  );
  await rig.commands.get("sh")?.("", rig.context);
  assert.equal(rig.flow.snapshot?.source, "command");
  assert.equal(rig.sentMessages.length, 1);
});

test("steering and follow-up input invalidate readiness IDs and pass unchanged", async () => {
  for (const streamingBehavior of ["steer", "followUp"] as const) {
    const rig = createRig();
    await rig.commands.get("sh")?.("", rig.context);
    const oldIds = rig.flow.snapshot?.readinessIds;
    const event: InputEvent = {
      type: "input",
      text: "Keep working on the source task",
      source: "interactive",
      streamingBehavior,
    };
    const unchanged = { ...event };

    const result = await rig.handlers.input?.(event, rig.context);
    assert.deepEqual(result, { action: "continue" });
    assert.deepEqual(event, unchanged);
    assert.equal(rig.flow.snapshot?.readinessIds, undefined);

    await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);
    assert.notDeepEqual(rig.flow.snapshot?.readinessIds, oldIds);
  }
});

test("post-GO interactive and RPC prompts are handled, preserved, and persisted in one file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-simple-handoff-extension-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recoveryDirectory = join(root, "recovery");
  await mkdir(recoveryDirectory);
  const rig = createRig({ recoveryDirectory }, { sessionFile: "/sessions/My source.jsonl" });
  await rig.commands.get("sh")?.("", rig.context);
  const go = rig.flow.snapshot?.readinessIds?.go;
  assert.ok(go);
  await rig.handlers.message_end?.(assistantMessage(go), rig.context);
  await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);

  const first: InputEvent = {
    type: "input",
    text: "  steer exactly\n",
    source: "interactive",
    streamingBehavior: "steer",
  };
  const second: InputEvent = {
    type: "input",
    text: "follow up  ",
    source: "rpc",
    streamingBehavior: "followUp",
  };
  const firstCopy = { ...first };
  const secondCopy = { ...second };
  const firstResult = rig.handlers.input?.(first, rig.context);
  const secondResult = rig.handlers.input?.(second, rig.context);
  assert.deepEqual(await firstResult, { action: "handled" });
  assert.deepEqual(await secondResult, { action: "handled" });
  assert.deepEqual(first, firstCopy);
  assert.deepEqual(second, secondCopy);
  assert.deepEqual(rig.flow.deferredSnapshot?.prompts, [first.text, second.text]);

  const extensionResult = await rig.handlers.input?.({
    type: "input",
    text: "writer-owned message",
    source: "extension",
  }, rig.context);
  assert.deepEqual(extensionResult, { action: "continue" });
  assert.deepEqual(rig.flow.deferredSnapshot?.prompts, [first.text, second.text]);

  const files = await readdir(recoveryDirectory);
  assert.equal(files.length, 1);
  assert.match(files[0] ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-My-source-jsonl\.md$/);
  assert.equal(
    await readFile(join(recoveryDirectory, files[0] ?? ""), "utf8"),
    `--- Deferred Prompt 1 of 2 ---\n${first.text}\n--- Deferred Prompt 2 of 2 ---\n${second.text}`,
  );
});

test("post-GO persistence failure is visible and still handles the captured prompt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-simple-handoff-extension-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const notDirectory = join(root, "not-a-directory");
  await writeFile(notDirectory, "occupied");
  const rig = createRig({ recoveryDirectory: notDirectory });
  await rig.commands.get("sh")?.("", rig.context);
  const go = rig.flow.snapshot?.readinessIds?.go;
  assert.ok(go);
  await rig.handlers.message_end?.(assistantMessage(go), rig.context);
  await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);

  const result = await rig.handlers.input?.({
    type: "input",
    text: "must not reach the writer",
    source: "interactive",
  }, rig.context);

  assert.deepEqual(result, { action: "handled" });
  assert.deepEqual(rig.flow.deferredSnapshot?.prompts, ["must not reach the writer"]);
  assert.equal(rig.notifications.at(-1)?.type, "error");
  assert.match(rig.notifications.at(-1)?.message ?? "", /recovery file could not be updated/);
});

test("only the current exact GO answer advances after the answering run settles", async () => {
  const rig = createRig();
  await rig.commands.get("sh")?.("", rig.context);
  const go = rig.flow.snapshot?.readinessIds?.go;
  assert.ok(go);

  await rig.handlers.message_end?.(assistantMessage(`${go}\n`), rig.context);
  await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);
  assert.equal(rig.flow.phase, "retry-delay");

  await rig.commands.get("sh")?.("cancel", rig.context);
  await rig.commands.get("sh")?.("", rig.context);
  const currentGo = rig.flow.snapshot?.readinessIds?.go;
  assert.ok(currentGo);
  await rig.handlers.message_end?.(assistantMessage(currentGo), rig.context);
  assert.equal(rig.flow.phase, "checking");
  await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);
  assert.equal(rig.flow.phase, "ready");
  assert.equal(rig.notifications.at(-1)?.message, "Session handoff readiness confirmed.");
});
