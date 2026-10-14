import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test doubles cover Pi lifecycle; file preparation uses real task-owned temp files.
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { SUBMIT_SESSION_HANDOFF_TOOL } from "../extensions/submission-tool.ts";
import {
  HandoffWriter,
  writerPrompt,
  type WriterPhase,
  type WriterRuntime,
  type WriterTerminalReason,
} from "../extensions/writer.ts";

interface ContextState {
  idle: boolean;
  pending: boolean;
  aborted: number;
}

interface WriterRigOptions {
  attempts?: number;
  ids?: string[];
  templates?: Array<{ path: string; content: string; failures: Array<{ path: string; reason: string }> }>;
  resolveError?: Error;
  sendError?: Error;
  isolateError?: Error;
  restoreError?: Error;
  initialTools?: string[];
  missingWriteTool?: boolean;
}

function context(state: ContextState): ExtensionContext {
  return {
    cwd: roots.at(-1),
    sessionManager: { getSessionId: () => "source" },
    isIdle: () => state.idle,
    hasPendingMessages: () => state.pending,
    abort: () => {
      state.aborted += 1;
    },
  } as unknown as ExtensionContext;
}

function handoff() {
  return {
    id: "handoff-1",
    source: "command" as const,
    sourceSessionPath: "/sessions/exact-source.jsonl",
    phase: "ready" as const,
    readinessKey: "key-1",
    awaitingUserGo: false,
  };
}

function rig(options: WriterRigOptions = {}) {
  roots.push(mkdtempSync(join(tmpdir(), "pi-blitz-handoff-writer-")));
  const state: ContextState = { idle: true, pending: false, aborted: 0 };
  const ctx = context(state);
  const prompts: string[] = [];
  const toolChanges: string[][] = [];
  const failures: Array<{ path: string; reason: string; attempt: number }> = [];
  const phases: Array<{ phase: WriterPhase; attempt: number }> = [];
  const successes: Array<{ attempt: number; id: string; handoffFile: string }> = [];
  const terminals: Array<{ reason: Exclude<WriterTerminalReason, "succeeded">; message: string }> = [];
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const cleared: unknown[] = [];
  const initialTools = options.initialTools ?? ["read", "bash", "read"];
  let activeTools = [...initialTools];
  let resolveCount = 0;
  let idIndex = 0;
  const ids = options.ids ?? ["submission-1", "submission-2", "submission-3"];
  const templates = options.templates ?? [
    { path: "/templates/default.cmpl", content: "COMPLETE TEMPLATE", failures: [] },
  ];

  const runtime: WriterRuntime = {
    getActiveTools: () => [...activeTools],
    setActiveTools(toolNames) {
      if (options.isolateError !== undefined && toolNames.includes(SUBMIT_SESSION_HANDOFF_TOOL)) {
        throw options.isolateError;
      }
      if (options.restoreError !== undefined && toolNames.join("\0") === initialTools.join("\0")) {
        throw options.restoreError;
      }
      // Native Pi ignores requested tool names that are not registered.
      activeTools = options.missingWriteTool ? toolNames.filter((name) => name !== "write") : [...toolNames];
      toolChanges.push([...toolNames]);
    },
    sendUserMessage(prompt) {
      if (options.sendError !== undefined) throw options.sendError;
      prompts.push(prompt);
    },
  };

  const writer = new HandoffWriter({
    writerAttempts: options.attempts ?? 3,
    writerRetryDelaySeconds: 17,
    runtime,
    async resolveTemplate() {
      resolveCount += 1;
      if (options.resolveError !== undefined) throw options.resolveError;
      const template = templates[resolveCount - 1] ?? templates.at(-1);
      if (template === undefined) throw new Error("no template configured");
      return template;
    },
    createSubmissionId() {
      const id = ids[idIndex];
      if (id === undefined) throw new Error("no submission ID configured");
      idIndex += 1;
      return id;
    },
    onTemplateFailure(failure, attempt) {
      failures.push({ ...failure, attempt });
    },
    onPhaseChange(phase, attempt) {
      phases.push({ phase, attempt });
    },
    onSuccess(result) {
      successes.push({ attempt: result.attempt, ...result.submission, handoffFile: result.handoffFile });
    },
    onTerminalFailure(reason, message) {
      terminals.push({ reason, message });
    },
    setTimer(callback, delay) {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      cleared.push(timer);
    },
  });

  return {
    writer,
    state,
    ctx,
    prompts,
    toolChanges,
    failures,
    phases,
    successes,
    terminals,
    timers,
    cleared,
    initialTools,
    getActiveTools: () => activeTools,
    getResolveCount: () => resolveCount,
  };
}

async function settlePromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("early preparation is shared, cannot submit before GO, and finalizes without resending the template", async () => {
  const testRig = rig();
  const preparing = testRig.writer.prepare(handoff(), testRig.ctx);
  assert.equal(testRig.writer.prepare(handoff(), testRig.ctx), preparing);
  const prepared = await preparing;
  prepared.templateReturned = true; // Successful GET test double.
  writeFileSync(prepared.handoffFile, "# Prepared draft"); // Scripted source-model test double.
  assert.throws(() => testRig.writer.submit({ id: prepared.submissionId }), /No current writer submission/);
  assert.equal(testRig.prompts.length, 0);
  assert.equal(testRig.writer.phase, "inactive");

  testRig.writer.start(handoff(), testRig.ctx);
  await settlePromises();
  assert.equal(testRig.getResolveCount(), 1);
  assert.match(testRig.prompts[0] ?? "", /GO has been accepted/);
  assert.match(testRig.prompts[0] ?? "", /No template is resent/);
  assert.doesNotMatch(testRig.prompts[0] ?? "", /COMPLETE TEMPLATE|BEGIN COMPLETE HANDOFF TEMPLATE/);
  assert.equal(readFileSync(prepared.handoffFile, "utf8"), "# Prepared draft");
  testRig.writer.submit({ id: prepared.submissionId });
  testRig.writer.handleSettled(testRig.ctx);
  assert.equal(testRig.successes[0]?.handoffFile, prepared.handoffFile);
  assert.equal(testRig.successes[0]?.id, "submission-1");
});

test("prepared retries keep the file and template snapshot but require a fresh DONE ID", async () => {
  const testRig = rig();
  const prepared = await testRig.writer.prepare(handoff(), testRig.ctx);
  prepared.templateReturned = true; // Successful GET test double.
  testRig.writer.start(handoff(), testRig.ctx);
  await settlePromises();
  testRig.writer.handleSettled(testRig.ctx);
  testRig.timers[0]?.callback();
  await settlePromises();
  assert.equal(testRig.getResolveCount(), 1);
  assert.match(testRig.prompts[1] ?? "", /submission-2/);
  assert.ok(testRig.prompts[1]?.includes(JSON.stringify(prepared.handoffFile)));
  assert.doesNotMatch(testRig.prompts[1] ?? "", /COMPLETE TEMPLATE/);
  assert.throws(() => testRig.writer.submit({ id: prepared.submissionId }), /does not match/);
  testRig.writer.cancel(testRig.ctx);
});

test("cancellation during optional preparation prevents stale file reservation", async () => {
  const testRig = rig();
  const preparing = testRig.writer.prepare(handoff(), testRig.ctx);
  testRig.writer.cancel(testRig.ctx);
  await assert.rejects(preparing, /preparation was cancelled/);
  assert.equal(testRig.writer.isActive, false);
  assert.equal(testRig.prompts.length, 0);
});

test("a missing native write tool fails before dispatch and restores the exact source tools", () => {
  const testRig = rig({ missingWriteTool: true });
  assert.equal(testRig.writer.start(handoff(), testRig.ctx), false);
  assert.equal(testRig.writer.phase, "failed");
  assert.match(testRig.terminals[0]?.message ?? "", /requires Pi's native write tool/);
  assert.deepEqual(testRig.getActiveTools(), testRig.initialTools);
  assert.deepEqual(testRig.prompts, []);
  assert.equal(testRig.getResolveCount(), 0);
});

test("live writer configuration controls subsequent attempt count and retry delay", async () => {
  const testRig = rig();
  testRig.writer.configure(2, 4);

  assert.equal(testRig.writer.start(handoff(), testRig.ctx), true);
  await settlePromises();
  testRig.writer.handleSettled(testRig.ctx);

  assert.equal(testRig.writer.phase, "retry-delay");
  assert.equal(testRig.timers[0]?.delay, 4_000);
  testRig.timers[0]?.callback();
  await settlePromises();
  testRig.writer.handleSettled(testRig.ctx);
  assert.equal(testRig.writer.phase, "exhausted");
  assert.match(testRig.terminals[0]?.message ?? "", /exhausted 2 attempts/);
});

test("writer prompt contains scoped writer control, the complete template, exact ID, and source transcript", () => {
  const prompt = writerPrompt("line one\nline two", "submission-exact", "/sessions/source exact.jsonl", "/project/.pi/session/handoff_file.md");

  assert.match(prompt, /^This is an extension-owned writer turn\./);
  assert.match(prompt, /Perform no source-task work during this turn/);
  assert.match(prompt, /not a user instruction or continuation constraint/);
  assert.match(prompt, /Do not include or preserve it in the handoff/);
  assert.doesNotMatch(prompt, /Stop all further task work/);
  assert.equal(prompt.match(/submission-exact/g)?.length, 1);
  assert.equal(prompt.match(/\/sessions\/source exact\.jsonl/g)?.length, 1);
  assert.match(prompt, /submit it exactly once/);
  assert.match(prompt, /--- BEGIN COMPLETE HANDOFF TEMPLATE ---\n\nline one\nline two\n\n--- END COMPLETE HANDOFF TEMPLATE ---/);
});

test("writer isolates tools, reports every fallback failure, accepts once, and restores only after settled", async () => {
  const testRig = rig({
    templates: [{
      path: "/managed/default.cmpl",
      content: "FULL TEMPLATE",
      failures: [
        { path: "/addendum/chosen.cmpl", reason: "permission denied" },
        { path: "/managed/chosen.cmpl", reason: "missing" },
      ],
    }],
  });

  assert.equal(testRig.writer.start(handoff(), testRig.ctx), true);
  assert.deepEqual(testRig.getActiveTools(), ["read", "write", "edit", SUBMIT_SESSION_HANDOFF_TOOL]);
  await settlePromises();

  assert.equal(testRig.prompts.length, 1);
  assert.deepEqual(testRig.failures, [
    { path: "/addendum/chosen.cmpl", reason: "permission denied", attempt: 1 },
    { path: "/managed/chosen.cmpl", reason: "missing", attempt: 1 },
  ]);
  assert.match(testRig.prompts[0] ?? "", /FULL TEMPLATE/);
  assert.match(testRig.prompts[0] ?? "", /submission-1/);
  assert.match(testRig.prompts[0] ?? "", /\/sessions\/exact-source\.jsonl/);

  testRig.writer.submit({ id: "submission-1" });
  assert.throws(
    () => testRig.writer.submit({ id: "submission-1" }),
    /already been accepted/,
  );
  assert.deepEqual(testRig.getActiveTools(), ["read", "write", "edit", SUBMIT_SESSION_HANDOFF_TOOL]);

  testRig.state.pending = true;
  testRig.writer.handleSettled(testRig.ctx);
  assert.equal(testRig.writer.isActive, true);
  assert.equal(testRig.successes.length, 0);

  testRig.state.pending = false;
  testRig.writer.handleSettled(testRig.ctx);
  assert.equal(testRig.writer.phase, "succeeded");
  const encodedPath = /^Write the complete handoff Markdown to this exact file: (.+)$/m.exec(testRig.prompts[0] ?? "")?.[1];
  assert.ok(encodedPath);
  const path = JSON.parse(encodedPath) as string;
  assert.deepEqual(testRig.successes, [{ attempt: 1, id: "submission-1", handoffFile: path }]);
  assert.equal(readFileSync(path, "utf8"), ""); // Metadata validation is transition-owned, not writer-owned.
  assert.deepEqual(testRig.getActiveTools(), testRig.initialTools);
  assert.deepEqual(testRig.toolChanges, [["read", "write", "edit", SUBMIT_SESSION_HANDOFF_TOOL], testRig.initialTools]);
});

test("a valid settled submission fails visibly instead of succeeding when tool restoration fails", async () => {
  const testRig = rig({ restoreError: new Error("saved tool list rejected") });

  testRig.writer.start(handoff(), testRig.ctx);
  await settlePromises();
  testRig.writer.submit({ id: "submission-1" });
  testRig.writer.handleSettled(testRig.ctx);

  assert.equal(testRig.writer.phase, "failed");
  assert.equal(testRig.writer.isActive, false);
  assert.deepEqual(testRig.getActiveTools(), ["read", "write", "edit", SUBMIT_SESSION_HANDOFF_TOOL]);
  assert.deepEqual(testRig.successes, []);
  assert.deepEqual(testRig.terminals, [{
    reason: "failed",
    message: "Could not restore the active tool list: saved tool list rejected",
  }]);
});

test("settled attempts retry exactly after configured delay with a fresh template and ID", async () => {
  const testRig = rig({
    attempts: 3,
    templates: [
      { path: "/templates/one.cmpl", content: "TEMPLATE ONE", failures: [] },
      { path: "/templates/two.cmpl", content: "TEMPLATE TWO", failures: [] },
      { path: "/templates/three.cmpl", content: "TEMPLATE THREE", failures: [] },
    ],
  });

  testRig.writer.start(handoff(), testRig.ctx);
  await settlePromises();
  testRig.writer.handleSettled(testRig.ctx);

  assert.equal(testRig.writer.phase, "retry-delay");
  assert.equal(testRig.timers.length, 1);
  assert.equal(testRig.timers[0]?.delay, 17_000);
  assert.deepEqual(testRig.getActiveTools(), ["read", "write", "edit", SUBMIT_SESSION_HANDOFF_TOOL]);

  testRig.timers[0]?.callback();
  await settlePromises();
  assert.equal(testRig.getResolveCount(), 2);
  assert.match(testRig.prompts[1] ?? "", /TEMPLATE TWO/);
  assert.match(testRig.prompts[1] ?? "", /submission-2/);
  assert.doesNotMatch(testRig.prompts[1] ?? "", /submission-1/);

  testRig.writer.handleSettled(testRig.ctx);
  testRig.timers[1]?.callback();
  await settlePromises();
  assert.equal(testRig.getResolveCount(), 3);
  assert.match(testRig.prompts[2] ?? "", /TEMPLATE THREE/);
  assert.match(testRig.prompts[2] ?? "", /submission-3/);

  testRig.writer.handleSettled(testRig.ctx);
  assert.equal(testRig.writer.phase, "exhausted");
  assert.equal(testRig.timers.length, 2);
  assert.deepEqual(testRig.getActiveTools(), testRig.initialTools);
  assert.match(testRig.terminals[0]?.message ?? "", /exhausted 3 attempts/);
});

test("stale submissions and retry timers cannot change a later attempt or terminal run", async () => {
  const testRig = rig({ attempts: 2 });
  testRig.writer.start(handoff(), testRig.ctx);
  await settlePromises();

  assert.throws(
    () => testRig.writer.submit({ id: "stale-id" }),
    /does not match/,
  );
  testRig.writer.handleSettled(testRig.ctx);
  const staleTimer = testRig.timers[0];
  staleTimer?.callback();
  await settlePromises();

  assert.throws(
    () => testRig.writer.submit({ id: "submission-1" }),
    /does not match/,
  );
  testRig.writer.submit({ id: "submission-2" });
  testRig.writer.handleSettled(testRig.ctx);
  staleTimer?.callback();
  await settlePromises();

  assert.equal(testRig.writer.phase, "succeeded");
  assert.equal(testRig.prompts.length, 2);
  assert.equal(testRig.successes[0]?.id, "submission-2");
});

test("cancellation clears retry work, aborts an active model run, and restores the exact prior tools", async () => {
  const delayed = rig();
  delayed.writer.start(handoff(), delayed.ctx);
  await settlePromises();
  delayed.writer.handleSettled(delayed.ctx);
  const staleTimer = delayed.timers[0];

  assert.equal(delayed.writer.cancel(delayed.ctx), true);
  assert.equal(delayed.writer.phase, "cancelled");
  assert.deepEqual(delayed.getActiveTools(), delayed.initialTools);
  assert.equal(delayed.cleared.length, 1);
  staleTimer?.callback();
  await settlePromises();
  assert.equal(delayed.prompts.length, 1);

  const running = rig();
  running.writer.start(handoff(), running.ctx);
  await settlePromises();
  running.state.idle = false;
  running.writer.cancel(running.ctx);
  assert.equal(running.state.aborted, 1);
  assert.deepEqual(running.getActiveTools(), running.initialTools);
});

test("isolation, template, and dispatch failures are terminal, visible, and restore exact prior tools", async () => {
  const isolation = rig({ isolateError: new Error("tool switch rejected") });
  assert.equal(isolation.writer.start(handoff(), isolation.ctx), false);
  assert.equal(isolation.writer.phase, "failed");
  assert.deepEqual(isolation.getActiveTools(), isolation.initialTools);
  assert.match(isolation.terminals[0]?.message ?? "", /tool switch rejected/);

  const resolution = rig({ resolveError: new Error("all tiers unreadable") });
  resolution.writer.start(handoff(), resolution.ctx);
  await settlePromises();
  assert.equal(resolution.writer.phase, "failed");
  assert.deepEqual(resolution.getActiveTools(), resolution.initialTools);
  assert.match(resolution.terminals[0]?.message ?? "", /all tiers unreadable/);

  const dispatch = rig({ sendError: new Error("delivery rejected") });
  dispatch.writer.start(handoff(), dispatch.ctx);
  await settlePromises();
  assert.equal(dispatch.writer.phase, "failed");
  assert.deepEqual(dispatch.getActiveTools(), dispatch.initialTools);
  assert.match(dispatch.terminals[0]?.message ?? "", /delivery rejected/);
});
