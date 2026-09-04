import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { defaultConfig, handoffPaths, type HandoffConfig } from "../extensions/pi-simple-handoff/config.ts";
import { activateHandoffExtension } from "../extensions/pi-simple-handoff/index.ts";

interface Notification {
  message: string;
  type?: "info" | "warning" | "error";
}

interface RegisteredCommand {
  description?: string;
  handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
}

interface RegisteredTool {
  name: string;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ): Promise<unknown>;
}

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>;

async function activateIntegrationRig(
  t: test.TestContext,
  configChanges: Partial<HandoffConfig> = {},
  sessionFile: string | undefined = "/sessions/source.jsonl",
) {
  const root = await mkdtemp(join(tmpdir(), "pi-simple-handoff-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = handoffPaths(root);
  await mkdir(paths.recoveryDirectory, { recursive: true });
  await mkdir(paths.templateDirectory, { recursive: true });
  await writeFile(join(paths.templateDirectory, "default.cmpl"), "INTEGRATION HANDOFF TEMPLATE");

  const state: { sessionFile: string | undefined; idle: boolean; pending: boolean } = {
    sessionFile,
    idle: true,
    pending: false,
  };
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, RegisteredTool>();
  const handlers = new Map<string, EventHandler>();
  const notifications: Notification[] = [];
  const statuses: Array<string | undefined> = [];
  const customMessages: string[] = [];
  const userMessages: Array<{ content: string; options?: { deliverAs?: string } }> = [];
  const replacementPrompts: string[] = [];
  const parentSessions: Array<string | undefined> = [];
  let activeTools = ["read", "bash"];
  let selectAnswers: string[] = [];

  const context = {
    mode: "tui",
    hasUI: true,
    isIdle: () => state.idle,
    hasPendingMessages: () => state.pending,
    getContextUsage: () => ({ tokens: 1_000, contextWindow: 100_000, percent: 1 }),
    sessionManager: { getSessionFile: () => state.sessionFile },
    abort() {},
    ui: {
      async select() {
        return selectAnswers.shift();
      },
      async input() {
        return undefined;
      },
      async confirm() {
        return false;
      },
      notify(message: string, type?: Notification["type"]) {
        notifications.push({ message, type });
      },
      setStatus(_key: string, text: string | undefined) {
        statuses.push(text);
      },
      setWorkingIndicator() {},
    },
    async newSession(options?: NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>) {
      parentSessions.push(options?.parentSession);
      const beforeSwitch = handlers.get("session_before_switch");
      const guard = await beforeSwitch?.({ type: "session_before_switch", reason: "new" }, context);
      if ((guard as { cancel?: boolean } | undefined)?.cancel === true) return { cancelled: true };

      await handlers.get("session_shutdown")?.(
        { type: "session_shutdown", reason: "new", targetSessionFile: "/sessions/replacement.jsonl" },
        context,
      );
      state.sessionFile = "/sessions/replacement.jsonl";
      const replacementContext = {
        ...context,
        async sendUserMessage(content: string) {
          replacementPrompts.push(content);
        },
      } as unknown as Parameters<NonNullable<NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>["withSession"]>>[0];
      await options?.withSession?.(replacementContext);
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
    on(event: string, handler: EventHandler) {
      handlers.set(event, handler);
    },
    getActiveTools() {
      return [...activeTools];
    },
    setActiveTools(names: string[]) {
      activeTools = [...names];
    },
    sendMessage(message: { content: string }) {
      customMessages.push(message.content);
    },
    sendUserMessage(content: string, options?: { deliverAs?: string }) {
      userMessages.push({ content, options });
    },
  } as unknown as ExtensionAPI;

  const config = {
    ...defaultConfig(root),
    recoveryDirectory: paths.recoveryDirectory,
    ...configChanges,
  };
  const flow = activateHandoffExtension(api, config, paths);

  return {
    state,
    paths,
    commands,
    tools,
    handlers,
    notifications,
    statuses,
    customMessages,
    userMessages,
    replacementPrompts,
    parentSessions,
    flow,
    context,
    getActiveTools: () => activeTools,
    setSelectAnswers: (answers: string[]) => {
      selectAnswers = [...answers];
    },
  };
}

function assistantMessage(text: string): unknown {
  return {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

async function reachWriter(rig: Awaited<ReturnType<typeof activateIntegrationRig>>): Promise<string> {
  const command = rig.commands.get("sh");
  assert.ok(command);
  await command.handler("", rig.context);
  const go = rig.flow.snapshot?.readinessIds?.go;
  assert.ok(go);
  await rig.handlers.get("message_end")?.(assistantMessage(go), rig.context);
  await rig.handlers.get("agent_settled")?.({ type: "agent_settled" }, rig.context);
  for (let attempt = 0; attempt < 100 && rig.userMessages.length === 0; attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }

  const writerPrompt = rig.userMessages.at(-1)?.content;
  assert.ok(writerPrompt);
  const submissionId = /^Use this exact submission ID: (.+)$/m.exec(writerPrompt)?.[1];
  assert.ok(submissionId);
  return submissionId;
}

test("integrated command-to-replacement success preserves lineage, deferred prompts, tools, and cleanup", async (t) => {
  const rig = await activateIntegrationRig(t, {
    automaticSessionHandoff: true,
    automaticSessionHandoffPercent: 100,
  });
  const submissionId = await reachWriter(rig);
  assert.deepEqual(rig.getActiveTools(), ["submit_session_handoff"]);

  const deferred = "  continue with this\nthen verify  ";
  assert.deepEqual(
    await rig.handlers.get("input")?.(
      { type: "input", text: deferred, source: "interactive", streamingBehavior: "followUp" },
      rig.context,
    ),
    { action: "handled" },
  );
  assert.equal((await readdir(rig.paths.recoveryDirectory)).length, 1);

  const submission = rig.tools.get("submit_session_handoff");
  assert.ok(submission);
  await submission.execute(
    "writer-call",
    { id: submissionId, content: "# Candidate continuation\n\nVerified dossier." },
    undefined,
    undefined,
    rig.context,
  );
  await rig.handlers.get("agent_settled")?.({ type: "agent_settled" }, rig.context);
  assert.deepEqual(rig.getActiveTools(), ["read", "bash"]);

  const transitionRequest = rig.userMessages.at(-1)?.content;
  assert.match(transitionRequest ?? "", /^\/__pi_simple_handoff_transition /);
  const [commandName, token] = (transitionRequest ?? "").slice(1).split(" ");
  assert.ok(commandName);
  assert.ok(token);
  await rig.commands.get(commandName)?.handler(token, rig.context);

  assert.deepEqual(rig.parentSessions, ["/sessions/source.jsonl"]);
  assert.deepEqual(rig.replacementPrompts, [[
    "# Candidate continuation\n\nVerified dossier.",
    "## Deferred Prompts",
    "Treat the entries below as separate sequential user inputs after this dossier. Later entries may update or supersede earlier entries.",
    `--- Deferred Prompt 1 of 1 ---\n${deferred}`,
  ].join("\n\n")]);
  assert.deepEqual(await readdir(rig.paths.recoveryDirectory), []);
  assert.equal(rig.flow.phase, "inactive");
  assert.equal(rig.statuses.at(-1), "Session Handoff Finished");
});

test("integrated starts reject an unpersisted source and writer exhaustion fails visibly with tools restored", async (t) => {
  const rejected = await activateIntegrationRig(t);
  rejected.state.sessionFile = undefined;
  await rejected.commands.get("sh")?.handler("", rejected.context);
  assert.equal(rejected.flow.phase, "inactive");
  assert.equal(rejected.customMessages.length, 0);
  assert.match(rejected.notifications.at(-1)?.message ?? "", /persisted source session/);

  const failed = await activateIntegrationRig(t, { writerAttempts: 1 });
  await reachWriter(failed);
  await failed.handlers.get("agent_settled")?.({ type: "agent_settled" }, failed.context);

  assert.equal(failed.flow.phase, "inactive");
  assert.deepEqual(failed.getActiveTools(), ["read", "bash"]);
  assert.equal(failed.replacementPrompts.length, 0);
  assert.equal(failed.statuses.at(-1), "Session Handoff Failed");
  assert.match(failed.notifications.at(-1)?.message ?? "", /exhausted 1 attempt/);
});

test("integrated cancellation retains deferred recovery, whose explicit execution preserves and removes it", async (t) => {
  const rig = await activateIntegrationRig(t);
  const submissionId = await reachWriter(rig);
  const deferred = "first deferred line\nsecond deferred line";
  await rig.handlers.get("input")?.(
    { type: "input", text: deferred, source: "rpc", streamingBehavior: "steer" },
    rig.context,
  );
  const [fileName] = await readdir(rig.paths.recoveryDirectory);
  assert.ok(fileName);
  const stored = await readFile(join(rig.paths.recoveryDirectory, fileName), "utf8");

  await rig.commands.get("sh")?.handler("cancel", rig.context);
  assert.equal(rig.flow.phase, "inactive");
  assert.deepEqual(rig.getActiveTools(), ["read", "bash"]);
  assert.equal(await readFile(join(rig.paths.recoveryDirectory, fileName), "utf8"), stored);
  const submission = rig.tools.get("submit_session_handoff");
  assert.ok(submission);
  await assert.rejects(
    submission.execute(
      "late-writer-call",
      { id: submissionId, content: "# Late dossier" },
      undefined,
      undefined,
      rig.context,
    ),
    /No current writer submission/,
  );

  const date = fileName.slice(0, 24).replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/,
    "$1:$2:$3.$4",
  );
  rig.setSelectAnswers([`${date} — ${fileName}`, "Execute recovered prompts"]);
  await rig.commands.get("sh")?.handler("recover", rig.context);

  assert.deepEqual(await readdir(rig.paths.recoveryDirectory), []);
  const recoveryTurn = rig.userMessages.at(-1)?.content ?? "";
  assert.match(recoveryTurn, /^Treat the marked entries below as separate sequential user inputs/);
  assert.ok(recoveryTurn.endsWith(stored));
});
