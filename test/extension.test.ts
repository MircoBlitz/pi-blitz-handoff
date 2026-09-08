import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  AgentSettledEvent,
  AgentStartEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
  InputEventResult,
  SessionCompactEvent,
  SessionShutdownEvent,
  SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { defaultConfig, handoffPaths, saveConfig, type HandoffConfig } from "../extensions/config.ts";
import {
  activateHandoffExtension,
  resolveHandoffTemplateHealth,
} from "../extensions/index.ts";
import { setHandoffTerminalState } from "../extensions/status.ts";
import { SUBMIT_SESSION_HANDOFF_TOOL } from "../extensions/submission-tool.ts";

interface RuntimeState {
  idle: boolean;
  pending: boolean;
  sessionFile?: string;
  percent?: number | null;
  entries: Array<{ type: "custom"; customType: string; data?: unknown }>;
}

interface ToolRuntimeOptions {
  activeTools: string[];
  loading: boolean;
  setCalls: string[][];
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
type AgentStartHandler = (event: AgentStartEvent, ctx: ExtensionContext) => void | Promise<void>;
type TurnEndHandler = (event: unknown, ctx: ExtensionContext) => void | Promise<void>;
type SessionCompactHandler = (event: SessionCompactEvent, ctx: ExtensionContext) => void | Promise<void>;
type SessionStartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => void | Promise<void>;
type SessionShutdownHandler = (event: SessionShutdownEvent, ctx: ExtensionContext) => void | Promise<void>;
type WidgetComponent = { render(width: number): string[]; invalidate(): void };
type WidgetFactory = (tui: { requestRender(): void }) => WidgetComponent;
type SelectHandler = (
  title: string,
  options: string[],
  opts?: { signal?: AbortSignal },
) => Promise<string | undefined>;
type ToolExecute = (
  toolCallId: string,
  params: Record<string, string>,
  signal: AbortSignal | undefined,
  onUpdate: undefined,
  ctx: ExtensionContext,
) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

function compactEvent(reason: SessionCompactEvent["reason"]): SessionCompactEvent {
  return {
    type: "session_compact",
    compactionEntry: {
      type: "compaction",
      id: "compact1",
      parentId: "parent1",
      timestamp: new Date().toISOString(),
      summary: "compacted",
      firstKeptEntryId: "parent1",
      tokensBefore: 90_000,
    },
    fromExtension: false,
    reason,
    willRetry: reason === "overflow",
  };
}

function createRig(
  configChanges: Partial<HandoffConfig> = {},
  stateChanges: Partial<RuntimeState> = {},
  agentDirectory = "/tmp/pi-blitz-handoff-test-agent",
  toolRuntime?: ToolRuntimeOptions,
) {
  const state: RuntimeState = {
    idle: true,
    pending: false,
    sessionFile: "/sessions/source.jsonl",
    percent: 10,
    entries: [],
    ...stateChanges,
  };
  const notifications: Notification[] = [];
  const statuses: Array<string | undefined> = [];
  const widgetSetCalls: Array<string[] | WidgetFactory | undefined> = [];
  let widgetComponent: WidgetComponent | undefined;
  let renderRequests = 0;
  const sentMessages: SentMessage[] = [];
  const sentUserMessages: string[] = [];
  const commands = new Map<string, CommandHandler>();
  const registeredEvents = new Set<string>();
  const handlers: {
    input?: InputHandler;
    agent_start?: AgentStartHandler;
    agent_settled?: SettledHandler;
    turn_end?: TurnEndHandler;
    session_compact?: SessionCompactHandler;
    session_start?: SessionStartHandler;
    session_shutdown?: SessionShutdownHandler;
  } = {};
  const toolExecutions = new Map<string, ToolExecute>();
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
    sessionManager: {
      getSessionFile: () => state.sessionFile,
      getEntries: () => state.entries,
    },
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
      setWidget(_key: string, content: string[] | WidgetFactory | undefined) {
        widgetSetCalls.push(content);
        if (typeof content === "function") {
          widgetComponent = content({
            requestRender() {
              renderRequests += 1;
              const lines = widgetComponent?.render(120) ?? [];
              statuses.push(lines.length === 0 ? undefined : lines.join("\n"));
            },
          });
          return;
        }
        if (content === undefined) widgetComponent = undefined;
        statuses.push(content?.join("\n"));
      },
    },
  } as unknown as ExtensionCommandContext;

  const api = {
    registerCommand(name: string, options: { handler: CommandHandler }) {
      commands.set(name, options.handler);
    },
    registerTool(tool: { name: string; execute: ToolExecute }) {
      toolExecutions.set(tool.name, tool.execute);
    },
    on(event: string, handler: unknown) {
      registeredEvents.add(event);
      if (event === "input") handlers.input = handler as InputHandler;
      if (event === "agent_start") handlers.agent_start = handler as AgentStartHandler;
      if (event === "agent_settled") handlers.agent_settled = handler as SettledHandler;
      if (event === "turn_end") handlers.turn_end = handler as TurnEndHandler;
      if (event === "session_compact") handlers.session_compact = handler as SessionCompactHandler;
      if (event === "session_start") handlers.session_start = handler as SessionStartHandler;
      if (event === "session_shutdown") handlers.session_shutdown = handler as SessionShutdownHandler;
    },
    sendMessage(message: SentMessage["message"], options?: SentMessage["options"]) {
      sentMessages.push({ message, options });
    },
    sendUserMessage(content: string | Array<{ type: string; text?: string }>) {
      sentUserMessages.push(typeof content === "string" ? content : JSON.stringify(content));
    },
    appendEntry(customType: string, data?: unknown) {
      state.entries.push({ type: "custom", customType, data });
    },
    ...(toolRuntime === undefined
      ? {}
      : {
          getActiveTools() {
            return [...toolRuntime.activeTools];
          },
          setActiveTools(toolNames: string[]) {
            if (toolRuntime.loading) throw new Error("setActiveTools called during extension loading");
            toolRuntime.activeTools = [...toolNames];
            toolRuntime.setCalls.push([...toolNames]);
          },
        }),
  } as unknown as ExtensionAPI;

  const config = { ...defaultConfig(agentDirectory), ...configChanges };
  const flow = activateHandoffExtension(api, config, handoffPaths(agentDirectory), "CALL TEMPLATE");
  return {
    state,
    notifications,
    statuses,
    widgetSetCalls,
    sentMessages,
    sentUserMessages,
    commands,
    registeredEvents,
    handlers,
    context,
    flow,
    getRenderRequests: () => renderRequests,
    hasWidgetComponent: () => widgetComponent !== undefined,
    setSelectHandler(handler: SelectHandler) {
      selectHandler = handler;
    },
    getToolExecute: (name = "blitz_handoff") => {
      const execute = toolExecutions.get(name);
      if (execute === undefined) throw new Error(`tool was not registered: ${name}`);
      return execute;
    },
  };
}

test("TUI session startup reserves one widget that active and terminal updates render in place", async () => {
  const rig = createRig();
  assert.equal(rig.widgetSetCalls.length, 0);

  await rig.handlers.session_start?.({ type: "session_start", reason: "startup" }, rig.context);
  assert.equal(rig.widgetSetCalls.length, 1);
  assert.equal(typeof rig.widgetSetCalls[0], "function");
  assert.equal(rig.hasWidgetComponent(), true);
  assert.equal(rig.statuses.at(-1), undefined);

  await rig.commands.get("sh")?.("", rig.context);
  assert.equal(rig.widgetSetCalls.length, 1);
  assert.equal(rig.statuses.at(-1), "Waiting for Session Handoff · Input available · /sh-cancel");

  await rig.commands.get("sh")?.("cancel", rig.context);
  assert.equal(rig.widgetSetCalls.length, 1);
  assert.match(rig.statuses.at(-1) ?? "", /^Session Handoff Cancelled · \d+ sec$/);
  assert.match(rig.sentMessages.at(-1)?.message.content ?? "", /Disregard the previous handoff readiness or writer instruction/);
  assert.deepEqual(rig.sentMessages.at(-1)?.options, { deliverAs: "followUp", triggerTurn: true });
  assert.ok(rig.getRenderRequests() >= 3);

  await rig.handlers.session_shutdown?.({ type: "session_shutdown", reason: "reload" }, rig.context);
  assert.equal(rig.widgetSetCalls.length, 2);
  assert.equal(rig.widgetSetCalls.at(-1), undefined);
  assert.equal(rig.hasWidgetComponent(), false);
});

test("defers writer tool initialization until the first session_start", async () => {
  const toolRuntime: ToolRuntimeOptions = {
    activeTools: ["read", SUBMIT_SESSION_HANDOFF_TOOL, "bash"],
    loading: true,
    setCalls: [],
  };

  const rig = createRig({}, {}, "/tmp/pi-blitz-handoff-extension-tools", toolRuntime);
  assert.deepEqual(toolRuntime.setCalls, []);

  toolRuntime.loading = false;
  await rig.handlers.session_start?.({ type: "session_start", reason: "startup" }, rig.context);

  assert.deepEqual(toolRuntime.setCalls, [["read", "bash"]]);
  assert.deepEqual(toolRuntime.activeTools, ["read", "bash"]);
  assert.equal(rig.notifications.some((notification) => notification.type === "error"), false);
});

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

test("/sh help displays subcommands and usage", async () => {
  const rig = createRig();
  await rig.commands.get("sh")?.("help", rig.context);
  assert.equal(rig.notifications.at(-1)?.type, "info");
  assert.match(rig.notifications.at(-1)?.message ?? "", /\/sh-recover/);
  assert.match(rig.notifications.at(-1)?.message ?? "", /\/sh-config/);
  assert.doesNotMatch(rig.notifications.at(-1)?.message ?? "", /\\n/);
});

test("blitz_handoff start records intent during a run while status remains factual", async () => {
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

test("/sh recover routes through extension UI and executes one selected recovery file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-extension-recover-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recoveryDirectory = join(root, "recovery");
  await mkdir(recoveryDirectory);
  const fileName = "2026-02-03T04-05-06-007Z-source-jsonl.md";
  const content = "--- Deferred Prompt 1 of 1 ---\nrecover this";
  await writeFile(join(recoveryDirectory, fileName), content);
  const rig = createRig({ recoveryDirectory }, {}, root);
  const answers = [
    `2026-02-03T04:05:06.007Z — ${fileName}`,
    "Execute recovered prompts",
  ];
  rig.setSelectHandler(async () => answers.shift());

  await rig.commands.get("sh")?.("recover", rig.context);

  assert.equal(rig.sentUserMessages.length, 1);
  assert.match(rig.sentUserMessages[0] ?? "", /separate sequential user inputs/);
  assert.ok((rig.sentUserMessages[0] ?? "").endsWith(content));
  assert.deepEqual(await readdir(recoveryDirectory), []);
  assert.equal(rig.notifications.at(-1)?.type, "info");
});

test("/sh recover reports an empty recovery directory factually", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-extension-empty-recover-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recoveryDirectory = join(root, "recovery");
  await mkdir(recoveryDirectory);
  const rig = createRig({ recoveryDirectory }, {}, root);

  await rig.commands.get("sh")?.("recover", rig.context);

  assert.equal(rig.sentUserMessages.length, 0);
  assert.equal(rig.notifications.at(-1)?.message, "No session handoff recovery files remain.");
});

test("/sh config stays in extension UI and reload or session replacement discards its draft", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-extension-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  for (const reason of ["reload", "new"] as const) {
    const agentDirectory = join(root, reason);
    const templates = handoffPaths(agentDirectory).templateDirectory;
    await mkdir(templates, { recursive: true });
    await writeFile(join(templates, "call_default.cmpl"), "call default");
    await writeFile(join(templates, "handoff_default.cmpl"), "handoff default");
    const rig = createRig({}, {}, agentDirectory);
    let observedSignal: AbortSignal | undefined;
    let markPromptStarted: (() => void) | undefined;
    const promptStarted = new Promise<void>((resolve) => {
      markPromptStarted = resolve;
    });
    rig.setSelectHandler(async (title, options, opts) => {
      assert.equal(title, "Configure pi-blitz-handoff");
      assert.equal(options.length, 13);
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

test("template health checks both roles and config opening reports each non-default fallback", async (t) => {
  const agentDirectory = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-extension-health-"));
  t.after(() => rm(agentDirectory, { recursive: true, force: true }));
  const paths = handoffPaths(agentDirectory);
  await mkdir(paths.templateDirectory, { recursive: true });
  await mkdir(paths.recoveryDirectory, { recursive: true });
  await writeFile(join(paths.templateDirectory, "call_default.cmpl"), "call default");
  await writeFile(join(paths.templateDirectory, "handoff_default.cmpl"), "handoff default");
  const config = {
    ...defaultConfig(agentDirectory),
    callTemplate: "missing-call.cmpl",
    handoffTemplate: "missing-handoff.cmpl",
  };
  await saveConfig(agentDirectory, config);

  const health = await resolveHandoffTemplateHealth(config, paths);
  assert.equal(health.callTemplate, "call default");
  assert.equal(health.warnings.length, 2);
  assert.match(health.warnings[0] ?? "", /Call template "missing-call\.cmpl"/);
  assert.match(health.warnings[1] ?? "", /Handoff template "missing-handoff\.cmpl"/);

  const rig = createRig(config, {}, agentDirectory);
  await rig.commands.get("sh-config")?.("", rig.context);
  const warnings = rig.notifications.filter(({ type }) => type === "warning");
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]?.message ?? "", /Using fallback .*call_default\.cmpl/);
  assert.match(warnings[1]?.message ?? "", /Using fallback .*handoff_default\.cmpl/);
});

test("startup template warnings are shown once", async () => {
  const agentDirectory = "/tmp/pi-blitz-handoff-startup-health";
  const notifications: Notification[] = [];
  const handlers: { session_start?: SessionStartHandler } = {};
  const api = {
    registerCommand() {},
    registerTool() {},
    on(event: string, handler: unknown) {
      if (event === "session_start") handlers.session_start = handler as SessionStartHandler;
    },
    sendMessage() {},
  } as unknown as ExtensionAPI;
  const context = {
    mode: "tui",
    sessionManager: { getSessionFile: () => "/sessions/startup.jsonl", getEntries: () => [] },
    ui: {
      notify(message: string, type?: Notification["type"]) { notifications.push({ message, type }); },
      setWidget() {},
    },
  } as unknown as ExtensionContext;
  activateHandoffExtension(
    api,
    defaultConfig(agentDirectory),
    handoffPaths(agentDirectory),
    "call default",
    ["Call template fallback", "Handoff template fallback"],
  );

  await handlers.session_start?.({ type: "session_start", reason: "startup" }, context);
  await handlers.session_start?.({ type: "session_start", reason: "new" }, context);
  assert.deepEqual(notifications, [
    { message: "Call template fallback", type: "warning" },
    { message: "Handoff template fallback", type: "warning" },
  ]);
});

test("finished status clears when the next agent run starts, on ordinary input, or on a new handoff", async () => {
  const runSession = "/sessions/finished-agent-start.jsonl";
  const runRig = createRig({}, { sessionFile: runSession });
  setHandoffTerminalState(runSession, "finished");
  await runRig.handlers.session_start?.({ type: "session_start", reason: "startup" }, runRig.context);
  assert.match(runRig.statuses.at(-1) ?? "", /^Session Handoff Finished(?: · \d+ sec)?$/);
  await runRig.handlers.agent_start?.({ type: "agent_start" } as AgentStartEvent, runRig.context);
  assert.equal(runRig.statuses.at(-1), undefined);

  const inputSession = "/sessions/finished-input.jsonl";
  const inputRig = createRig({}, { sessionFile: inputSession });
  setHandoffTerminalState(inputSession, "finished");
  await inputRig.handlers.session_start?.({ type: "session_start", reason: "startup" }, inputRig.context);
  assert.match(inputRig.statuses.at(-1) ?? "", /^Session Handoff Finished(?: · \d+ sec)?$/);

  await inputRig.handlers.input?.({
    type: "input",
    text: "continue normally",
    source: "interactive",
  }, inputRig.context);
  assert.equal(inputRig.statuses.at(-1), undefined);

  const startSession = "/sessions/finished-new-handoff.jsonl";
  const startRig = createRig({}, { sessionFile: startSession });
  setHandoffTerminalState(startSession, "finished");
  await startRig.handlers.session_start?.({ type: "session_start", reason: "startup" }, startRig.context);
  await startRig.commands.get("sh")?.("", startRig.context);
  assert.equal(startRig.statuses.at(-1), "Waiting for Session Handoff · Input available · /sh-cancel");
});

test("automatic initiation enters autonomous work at turn end and retries once at critical", async () => {
  const disabled = createRig({ automaticSessionHandoff: false }, { percent: 99, idle: false, pending: true });
  await disabled.handlers.turn_end?.({ type: "turn_end" }, disabled.context);
  assert.equal(disabled.flow.phase, "inactive");

  const below = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70 },
    { percent: 69, idle: false, pending: true },
  );
  await below.handlers.turn_end?.({ type: "turn_end" }, below.context);
  assert.equal(below.flow.phase, "inactive");
  below.state.percent = 70;
  await below.handlers.agent_settled?.({ type: "agent_settled" }, below.context);
  assert.equal(below.flow.phase, "inactive");

  const enabled = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70, criticalWarningPercent: 90 },
    { percent: 70, idle: false, pending: true },
  );
  await enabled.handlers.turn_end?.({ type: "turn_end" }, enabled.context);
  assert.equal(enabled.flow.snapshot?.source, "automatic");
  assert.equal(enabled.sentMessages.length, 1);
  assert.equal(enabled.sentMessages[0]?.options?.deliverAs, "steer");

  await enabled.commands.get("sh-cancel")?.("", enabled.context);
  const afterFirstAttempt = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70, criticalWarningPercent: 90 },
    { percent: 89, idle: false, pending: true, entries: [...enabled.state.entries] },
  );
  await afterFirstAttempt.handlers.session_start?.(
    { type: "session_start", reason: "reload" },
    afterFirstAttempt.context,
  );
  await afterFirstAttempt.handlers.turn_end?.({ type: "turn_end" }, afterFirstAttempt.context);
  assert.equal(afterFirstAttempt.flow.phase, "inactive");

  afterFirstAttempt.state.percent = 90;
  await afterFirstAttempt.handlers.turn_end?.({ type: "turn_end" }, afterFirstAttempt.context);
  assert.equal(afterFirstAttempt.flow.snapshot?.source, "automatic");
  assert.equal(afterFirstAttempt.sentMessages.length, 1);

  const alreadyCritical = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70, criticalWarningPercent: 90 },
    { percent: 95, idle: false, pending: true, entries: [...enabled.state.entries] },
  );
  await alreadyCritical.handlers.session_start?.(
    { type: "session_start", reason: "reload" },
    alreadyCritical.context,
  );
  await alreadyCritical.handlers.turn_end?.({ type: "turn_end" }, alreadyCritical.context);
  assert.equal(alreadyCritical.flow.snapshot?.source, "automatic");
  assert.equal(alreadyCritical.sentMessages.length, 1);

  await afterFirstAttempt.commands.get("sh-cancel")?.("", afterFirstAttempt.context);
  const afterSecondAttempt = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70, criticalWarningPercent: 90 },
    { percent: 99, idle: false, pending: true, entries: [...afterFirstAttempt.state.entries] },
  );
  await afterSecondAttempt.handlers.session_start?.(
    { type: "session_start", reason: "reload" },
    afterSecondAttempt.context,
  );
  await afterSecondAttempt.handlers.turn_end?.({ type: "turn_end" }, afterSecondAttempt.context);
  assert.equal(afterSecondAttempt.flow.phase, "inactive");
  assert.equal(afterSecondAttempt.sentMessages.length, 0);

  const disabledAfterAttempt = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 0, criticalWarningPercent: 90 },
    { percent: 99, idle: false, pending: true, entries: [...enabled.state.entries] },
  );
  await disabledAfterAttempt.handlers.session_start?.(
    { type: "session_start", reason: "reload" },
    disabledAfterAttempt.context,
  );
  await disabledAfterAttempt.handlers.turn_end?.({ type: "turn_end" }, disabledAfterAttempt.context);
  assert.equal(disabledAfterAttempt.flow.phase, "inactive");

  for (const reason of ["manual", "threshold", "overflow"] as const) {
    const compacted = createRig(
      { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70, criticalWarningPercent: 90 },
      { percent: 70, idle: false, pending: true, entries: [...enabled.state.entries] },
    );
    await compacted.handlers.session_start?.(
      { type: "session_start", reason: "reload" },
      compacted.context,
    );
    await compacted.handlers.session_compact?.(compactEvent(reason), compacted.context);
    assert.equal(
      (compacted.state.entries.at(-1)?.data as { attempt?: unknown } | undefined)?.attempt,
      0,
    );

    const afterCompaction = createRig(
      { automaticSessionHandoff: true, automaticSessionHandoffPercent: 70, criticalWarningPercent: 90 },
      { percent: 70, idle: false, pending: true, entries: [...compacted.state.entries] },
    );
    await afterCompaction.handlers.session_start?.(
      { type: "session_start", reason: "reload" },
      afterCompaction.context,
    );
    await afterCompaction.handlers.turn_end?.({ type: "turn_end" }, afterCompaction.context);
    assert.equal(afterCompaction.flow.snapshot?.source, "automatic");
    assert.equal(
      (afterCompaction.state.entries.at(-1)?.data as { attempt?: unknown } | undefined)?.attempt,
      1,
    );
  }

  const beforeFailedCompaction = enabled.state.entries.length;
  assert.equal(enabled.registeredEvents.has("session_compact_failed"), false);
  assert.equal(enabled.state.entries.length, beforeFailedCompaction);
});

test("explicit command and tool starts ignore automatic thresholds and exhausted attempts", async () => {
  const exhaustedEntries = [
    { type: "custom" as const, customType: "pi-blitz-handoff-automatic-attempt", data: { attempt: 1 } },
    { type: "custom" as const, customType: "pi-blitz-handoff-automatic-attempt", data: { attempt: 2 } },
  ];

  const command = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 0 },
    { percent: 1, entries: [...exhaustedEntries] },
  );
  await command.handlers.session_start?.({ type: "session_start", reason: "reload" }, command.context);
  await command.commands.get("sh")?.("", command.context);
  assert.equal(command.flow.snapshot?.source, "command");
  assert.equal(command.sentMessages.length, 1);

  const tool = createRig(
    { automaticSessionHandoff: true, automaticSessionHandoffPercent: 0 },
    { percent: 1, entries: [...exhaustedEntries] },
  );
  await tool.handlers.session_start?.({ type: "session_start", reason: "reload" }, tool.context);
  const result = await tool.getToolExecute()(
    "explicit-tool",
    { action: "start" },
    undefined,
    undefined,
    tool.context,
  );
  assert.equal(result.content[0]?.text, "Session handoff requested. Waiting for readiness.");
  assert.equal(tool.flow.snapshot?.source, "tool");
  assert.equal(tool.sentMessages.length, 1);
});

test("steering and follow-up input pass unchanged before GO without changing correlation", async () => {
  for (const streamingBehavior of ["steer", "followUp"] as const) {
    const rig = createRig();
    await rig.commands.get("sh")?.("", rig.context);
    const key = rig.flow.snapshot?.readinessKey;
    const event: InputEvent = {
      type: "input",
      text: "Keep working on the source task",
      source: "interactive",
      streamingBehavior,
    };
    const unchanged = { ...event };

    assert.deepEqual(await rig.handlers.input?.(event, rig.context), { action: "continue" });
    assert.deepEqual(event, unchanged);
    assert.equal(rig.flow.snapshot?.readinessKey, key);
    await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);
    assert.equal(rig.sentMessages.length, 1);
  }
});

test("user deferral Wait uses extension selection, keeps input normal, and later direct GO works", async () => {
  const rig = createRig();
  rig.setSelectHandler(async (title, options) => {
    assert.equal(
      title,
      "Your LLM reports an active user interaction:\nThe user's active review may still matter",
    );
    assert.deepEqual(options, ["Ready", "Wait", "Cancel"]);
    assert.match(rig.statuses.at(-1) ?? "", /User Input Required/);
    return "Wait";
  });
  await rig.commands.get("sh")?.("", rig.context);
  const key = rig.flow.snapshot?.readinessKey;
  assert.ok(key);
  await rig.getToolExecute("session_handoff_go_with_user_deferral")(
    "defer",
    { key, reason: "The user's active review may still matter" },
    undefined,
    undefined,
    rig.context,
  );
  assert.equal(rig.statuses.at(-1), "Waiting for Session Handoff · Input available · /sh-cancel\nAwaiting User GO · Tell your LLM to start when ready");
  assert.deepEqual(await rig.handlers.input?.({ type: "input", text: "continue", source: "interactive" }, rig.context), { action: "continue" });
  assert.equal(rig.flow.phase, "waiting");
  await rig.getToolExecute("session_handoff_go")("go", { key }, undefined, undefined, rig.context);
  assert.equal(rig.flow.phase, "ready");
});

test("user deferral Cancel queues the same model reset instruction", async () => {
  const rig = createRig();
  rig.setSelectHandler(async () => "Cancel");
  await rig.commands.get("sh")?.("", rig.context);
  const key = rig.flow.snapshot?.readinessKey;
  assert.ok(key);

  await rig.getToolExecute("session_handoff_go_with_user_deferral")(
    "defer",
    { key, reason: "The user is still reviewing" },
    undefined,
    undefined,
    rig.context,
  );

  assert.equal(rig.flow.phase, "inactive");
  assert.match(rig.sentMessages.at(-1)?.message.content ?? "", /Resume normal conversation and task work/);
  assert.deepEqual(rig.sentMessages.at(-1)?.options, { deliverAs: "followUp", triggerTurn: true });
});

test("post-GO interactive and RPC prompts are handled, preserved, and persisted in one file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-extension-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const recoveryDirectory = join(root, "recovery");
  await mkdir(recoveryDirectory);
  const rig = createRig({ recoveryDirectory }, { sessionFile: "/sessions/My source.jsonl" });
  await rig.commands.get("sh")?.("", rig.context);
  const go = rig.flow.snapshot?.readinessKey;
  assert.ok(go);
  await rig.getToolExecute("session_handoff_go")("go", { key: go }, undefined, undefined, rig.context);
  await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);
  assert.match(rig.statuses.at(-1) ?? "", /Inputs deferred \(0\)/);

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
  assert.ok(rig.statuses.some((status) => status?.includes("Inputs deferred (1)")));
  assert.match(rig.statuses.at(-1) ?? "", /Inputs deferred \(2\)/);

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
  const root = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-extension-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const notDirectory = join(root, "not-a-directory");
  await writeFile(notDirectory, "occupied");
  const rig = createRig({ recoveryDirectory: notDirectory });
  await rig.commands.get("sh")?.("", rig.context);
  const go = rig.flow.snapshot?.readinessKey;
  assert.ok(go);
  await rig.getToolExecute("session_handoff_go")("go", { key: go }, undefined, undefined, rig.context);
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

test("only a current keyed GO tool call advances and writer dispatch waits for settled", async () => {
  const rig = createRig();
  await rig.commands.get("sh")?.("", rig.context);
  const go = rig.flow.snapshot?.readinessKey;
  assert.ok(go);
  const execute = rig.getToolExecute("session_handoff_go");

  await assert.rejects(execute("stale", { key: "stale" }, undefined, undefined, rig.context));
  await execute("current", { key: go }, undefined, undefined, rig.context);
  assert.equal(rig.flow.phase, "ready");
  assert.notEqual(rig.notifications.at(-1)?.message, "Session handoff readiness confirmed.");
  await rig.handlers.agent_settled?.({ type: "agent_settled" }, rig.context);
  assert.equal(rig.notifications.at(-1)?.message, "Session handoff readiness confirmed.");
});
