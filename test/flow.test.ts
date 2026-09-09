import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { HandoffFlow, shouldStartAutomaticHandoff, type ActiveHandoffSnapshot } from "../extensions/flow.ts";

interface MutableContext { idle: boolean; pending: boolean; sessionFile?: string }

function extensionContext(state: MutableContext): ExtensionContext {
  return {
    mode: "tui",
    isIdle: () => state.idle,
    hasPendingMessages: () => state.pending,
    sessionManager: { getSessionFile: () => state.sessionFile },
  } as unknown as ExtensionContext;
}

function setup(state: MutableContext) {
  const prompts: string[] = [];
  const reminders: string[] = [];
  const ready: ActiveHandoffSnapshot[] = [];
  const timers: Array<() => void> = [];
  const cleared: unknown[] = [];
  const flow = new HandoffFlow({
    readinessRetrySeconds: 12,
    callTemplate: "CALL TEMPLATE",
    createHandoffId: () => "handoff-1",
    createReadinessKey: () => "key-1",
    onReadinessPrompt(prompt) { prompts.push(prompt); },
    onReadinessReminder(prompt) { reminders.push(prompt); },
    onReady(handoff) { ready.push(handoff); },
    setTimer(callback, delay) {
      assert.equal(delay, 12_000);
      timers.push(callback);
      return callback;
    },
    clearTimer(timer) { cleared.push(timer); },
  });
  return { flow, prompts, reminders, ready, timers, cleared, ctx: extensionContext(state) };
}

test("start requires persistence and dispatches one instruction at an idle boundary", () => {
  const missing = setup({ idle: true, pending: false });
  assert.deepEqual(missing.flow.start(missing.ctx, "command"), { accepted: false, reason: "unpersisted" });

  const state = { idle: false, pending: false, sessionFile: "/sessions/source.jsonl" };
  const rig = setup(state);
  assert.equal(rig.flow.start(rig.ctx, "command").accepted, true);
  assert.equal(rig.prompts.length, 0);
  state.idle = true;
  state.pending = true;
  rig.flow.handleSettled(rig.ctx);
  assert.equal(rig.prompts.length, 0);
  state.pending = false;
  rig.flow.handleSettled(rig.ctx);
  rig.flow.handleSettled(rig.ctx);
  assert.equal(rig.prompts.length, 1);
  assert.match(rig.prompts[0] ?? "", /key-1/);
  assert.equal(rig.flow.phase, "waiting");
});

test("automatic turn-boundary start dispatches direct-GO-only readiness despite queued continuation", () => {
  const rig = setup({ idle: false, pending: true, sessionFile: "/sessions/source.jsonl" });

  assert.equal(rig.flow.startAutomaticAtTurnBoundary(rig.ctx).accepted, true);
  assert.equal(rig.prompts.length, 1);
  assert.match(rig.prompts[0] ?? "", /key-1/);
  assert.match(rig.prompts[0] ?? "", /User deferral is unavailable/);
  assert.equal(rig.flow.snapshot?.source, "automatic");
  assert.equal(rig.flow.beginUserDeferral("key-1", rig.ctx), "automatic");
  assert.equal(rig.flow.phase, "waiting");
});

test("explicit initiation sources share the same readiness behavior", () => {
  const prompts = new Set<string>();
  for (const source of ["command", "tool"] as const) {
    const rig = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
    rig.flow.start(rig.ctx, source);
    prompts.add(rig.prompts[0] ?? "");
    assert.equal(rig.flow.phase, "waiting");
  }
  assert.equal(prompts.size, 1);
});

test("direct GO is exactly correlated, protects immediately, and dispatches writer only when settled", () => {
  const state = { idle: true, pending: false, sessionFile: "/sessions/source.jsonl" };
  const rig = setup(state);
  assert.equal(rig.flow.acceptGo("key-1", rig.ctx), "not-started");
  rig.flow.start(rig.ctx, "command");
  assert.equal(rig.flow.acceptGo("wrong", rig.ctx), "stale");
  assert.equal(rig.flow.isTransferProtected, false);
  assert.equal(rig.flow.acceptGo("key-1", rig.ctx), "accepted");
  assert.equal(rig.flow.isTransferProtected, true);
  assert.equal(rig.ready.length, 0);
  assert.equal(rig.flow.acceptGo("key-1", rig.ctx), "stale");

  state.pending = true;
  rig.flow.handleSettled(rig.ctx);
  assert.equal(rig.ready.length, 0);
  state.pending = false;
  rig.flow.handleSettled(rig.ctx);
  rig.flow.handleSettled(rig.ctx);
  assert.equal(rig.ready.length, 1);
});

test("user deferral entry point owns Ready, Wait, and Cancel transitions", () => {
  const ready = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
  ready.flow.start(ready.ctx, "command");
  assert.equal(ready.flow.beginUserDeferral("wrong", ready.ctx), "stale");
  assert.equal(ready.flow.beginUserDeferral("key-1", ready.ctx), "accepted");
  assert.equal(ready.flow.phase, "user-input-required");
  assert.equal(ready.flow.acceptGo("key-1", ready.ctx), "stale");
  assert.equal(ready.flow.resolveUserDeferral("key-1", "Ready", ready.ctx), "accepted");
  assert.equal(ready.flow.isTransferProtected, true);

  const wait = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
  wait.flow.start(wait.ctx, "command");
  wait.flow.beginUserDeferral("key-1", wait.ctx);
  wait.flow.resolveUserDeferral("key-1", "Wait", wait.ctx);
  assert.equal(wait.flow.phase, "waiting");
  assert.equal(wait.flow.snapshot?.awaitingUserGo, true);
  assert.equal(wait.flow.beginUserDeferral("key-1", wait.ctx), "stale");
  assert.equal(wait.flow.acceptGo("key-1", wait.ctx), "accepted");

  const cancel = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
  cancel.flow.start(cancel.ctx, "tool");
  cancel.flow.beginUserDeferral("key-1", cancel.ctx);
  cancel.flow.resolveUserDeferral("key-1", "Cancel", cancel.ctx);
  assert.equal(cancel.flow.phase, "inactive");
});

test("ordinary input is unchanged before GO and deferred unchanged after GO", () => {
  const rig = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
  rig.flow.start(rig.ctx, "command");
  assert.deepEqual(rig.flow.handleInput(" before ", "interactive", rig.ctx), { action: "continue" });
  rig.flow.beginUserDeferral("key-1", rig.ctx);
  assert.deepEqual(rig.flow.handleInput(" during choice ", "rpc", rig.ctx), { action: "continue" });
  rig.flow.resolveUserDeferral("key-1", "Wait", rig.ctx);
  assert.deepEqual(rig.flow.handleInput(" after wait ", "interactive", rig.ctx), { action: "continue" });

  rig.flow.acceptGo("key-1", rig.ctx);
  const text = "  exact\nspacing  ";
  const result = rig.flow.handleInput(text, "rpc", rig.ctx);
  assert.equal(result.action, "deferred");
  assert.deepEqual(rig.flow.deferredSnapshot?.prompts, [text]);
  assert.deepEqual(rig.flow.handleInput("extension", "extension", rig.ctx), { action: "continue" });
});

test("reminder is single-shot and is suspended by either valid GO tool invocation", () => {
  const fired = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
  fired.flow.start(fired.ctx, "command");
  fired.timers[0]?.();
  fired.timers[0]?.();
  assert.equal(fired.reminders.length, 1);

  const direct = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
  direct.flow.start(direct.ctx, "command");
  direct.flow.acceptGo("key-1", direct.ctx);
  direct.timers[0]?.();
  assert.equal(direct.reminders.length, 0);
  assert.equal(direct.cleared.length, 1);

  const wait = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
  wait.flow.start(wait.ctx, "command");
  wait.flow.beginUserDeferral("key-1", wait.ctx);
  wait.flow.resolveUserDeferral("key-1", "Wait", wait.ctx);
  wait.timers[0]?.();
  assert.equal(wait.reminders.length, 0);
  assert.equal(wait.timers.length, 1);
});

test("stale calls and late callbacks cannot affect a replacement handoff", () => {
  const rig = setup({ idle: true, pending: false, sessionFile: "/sessions/source.jsonl" });
  rig.flow.start(rig.ctx, "command");
  const callback = rig.timers[0];
  rig.flow.cancel(rig.ctx);
  callback?.();
  assert.equal(rig.reminders.length, 0);
  assert.equal(rig.flow.resolveUserDeferral("key-1", "Ready", rig.ctx), "not-started");
});

test("only automatic initiation uses enablement and context thresholds", () => {
  assert.equal(shouldStartAutomaticHandoff(false, 70, 99), false);
  assert.equal(shouldStartAutomaticHandoff(true, 0, 99), false);
  assert.equal(shouldStartAutomaticHandoff(true, 70, 69.9), false);
  assert.equal(shouldStartAutomaticHandoff(true, 70, 70), true);
  assert.equal(shouldStartAutomaticHandoff(true, 70, null), false);
});
