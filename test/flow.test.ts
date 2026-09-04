import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  HandoffFlow,
  shouldStartAutomaticHandoff,
  type ActiveHandoffSnapshot,
} from "../extensions/pi-simple-handoff/flow.ts";

interface MutableContext {
  idle: boolean;
  pending: boolean;
  sessionFile?: string;
}

function extensionContext(state: MutableContext): ExtensionContext {
  return {
    isIdle: () => state.idle,
    hasPendingMessages: () => state.pending,
    sessionManager: { getSessionFile: () => state.sessionFile },
  } as unknown as ExtensionContext;
}

function sequence<T>(values: T[]): () => T {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) throw new Error("sequence exhausted");
    index += 1;
    return value;
  };
}

function setup(state: MutableContext, answers = [
  { go: "go-1", notYet: "no-1" },
  { go: "go-2", notYet: "no-2" },
]) {
  const prompts: ActiveHandoffSnapshot[] = [];
  const ready: ActiveHandoffSnapshot[] = [];
  const timers: Array<() => void> = [];
  const cleared: unknown[] = [];
  const flow = new HandoffFlow({
    readinessRetrySeconds: 12,
    createHandoffId: () => "handoff-1",
    createIdentifiers: sequence(answers),
    onReadinessPrompt(_prompt, handoff) {
      prompts.push(handoff);
    },
    onReady(handoff) {
      ready.push(handoff);
    },
    setTimer(callback, delay) {
      assert.equal(delay, 12_000);
      timers.push(callback);
      return callback;
    },
    clearTimer(timer) {
      cleared.push(timer);
    },
  });
  return { flow, prompts, ready, timers, cleared, ctx: extensionContext(state) };
}

test("a start requires a persisted source session", () => {
  const state: MutableContext = { idle: true, pending: false };
  const { flow, prompts, ctx } = setup(state);

  assert.deepEqual(flow.start(ctx, "command"), { accepted: false, reason: "unpersisted" });
  assert.equal(flow.phase, "inactive");
  assert.equal(prompts.length, 0);
});

test("a second start is rejected without replacing active identity or IDs", () => {
  const state: MutableContext = { idle: true, pending: false, sessionFile: "/sessions/source.jsonl" };
  const { flow, prompts, ctx } = setup(state);

  const first = flow.start(ctx, "command");
  assert.equal(first.accepted, true);
  const before = flow.snapshot;
  const second = flow.start(ctx, "tool");

  assert.equal(second.accepted, false);
  assert.equal(second.reason, "active");
  assert.deepEqual(flow.snapshot, before);
  assert.equal(prompts.length, 1);
});

test("readiness waits for a settled boundary with no pending messages", () => {
  const state: MutableContext = { idle: false, pending: false, sessionFile: "/sessions/source.jsonl" };
  const { flow, prompts, ctx } = setup(state);

  assert.equal(flow.start(ctx, "tool").accepted, true);
  assert.equal(prompts.length, 0);

  state.pending = true;
  flow.handleSettled(ctx);
  assert.equal(prompts.length, 0);

  state.pending = false;
  state.idle = true;
  flow.handleSettled(ctx);
  assert.equal(prompts.length, 1);
  assert.equal(flow.phase, "checking");
});

test("exact GO advances only after its model run settles with no pending message", () => {
  const state: MutableContext = { idle: true, pending: false, sessionFile: "/sessions/source.jsonl" };
  const { flow, ready, ctx } = setup(state);

  flow.start(ctx, "command");
  flow.handleAssistantAnswer("go-1");
  assert.equal(flow.phase, "checking");
  assert.equal(ready.length, 0);

  state.pending = true;
  flow.handleSettled(ctx);
  assert.equal(flow.phase, "checking");

  state.pending = false;
  flow.handleSettled(ctx);
  assert.equal(flow.phase, "ready");
  assert.equal(ready.length, 1);
});

test("NOT-YET and malformed answers replace polling with one delayed retry using fresh IDs", () => {
  const state: MutableContext = { idle: true, pending: false, sessionFile: "/sessions/source.jsonl" };
  const { flow, prompts, timers, ctx } = setup(state);

  flow.start(ctx, "command");
  flow.handleAssistantAnswer("no-1");
  flow.handleSettled(ctx);
  assert.equal(flow.phase, "retry-delay");
  assert.equal(timers.length, 1);

  timers[0]?.();
  assert.equal(prompts.length, 2);
  assert.deepEqual(prompts[1]?.readinessIds, { go: "go-2", notYet: "no-2" });

  flow.handleAssistantAnswer("not an identifier");
  flow.handleSettled(ctx);
  assert.equal(flow.phase, "retry-delay");
  assert.equal(timers.length, 2);
});

test("ordinary input invalidates IDs and timers, passes control to the next settled boundary", () => {
  const state: MutableContext = { idle: true, pending: false, sessionFile: "/sessions/source.jsonl" };
  const { flow, prompts, timers, cleared, ctx } = setup(state);

  flow.start(ctx, "command");
  const staleIds = flow.snapshot?.readinessIds;
  assert.equal(flow.handleInput("interactive", ctx), true);
  assert.equal(flow.phase, "waiting");
  assert.equal(flow.snapshot?.readinessIds, undefined);

  state.idle = true;
  flow.handleSettled(ctx);
  assert.equal(prompts.length, 2);
  assert.notDeepEqual(flow.snapshot?.readinessIds, staleIds);

  flow.handleAssistantAnswer(staleIds?.go);
  flow.handleSettled(ctx);
  assert.equal(flow.phase, "retry-delay");
  assert.equal(timers.length, 1);
  assert.equal(flow.handleInput("rpc", ctx), true);
  assert.equal(cleared.length, 1);

  assert.equal(flow.handleInput("extension", ctx), false);
});

test("late retry callbacks from cancelled or input-invalidated handoffs do nothing", () => {
  const state: MutableContext = { idle: true, pending: false, sessionFile: "/sessions/source.jsonl" };
  const first = setup(state);
  first.flow.start(first.ctx, "command");
  first.flow.handleAssistantAnswer("no-1");
  first.flow.handleSettled(first.ctx);
  const cancelledCallback = first.timers[0];
  assert.equal(first.flow.cancel(first.ctx), true);
  cancelledCallback?.();
  assert.equal(first.flow.phase, "inactive");
  assert.equal(first.prompts.length, 1);

  const second = setup(state);
  second.flow.start(second.ctx, "command");
  second.flow.handleAssistantAnswer("no-1");
  second.flow.handleSettled(second.ctx);
  const invalidatedCallback = second.timers[0];
  second.flow.handleInput("interactive", second.ctx);
  invalidatedCallback?.();
  assert.equal(second.flow.phase, "waiting");
  assert.equal(second.prompts.length, 1);
});

test("only automatic initiation uses enablement and context thresholds", () => {
  assert.equal(shouldStartAutomaticHandoff(false, 70, 99), false);
  assert.equal(shouldStartAutomaticHandoff(true, 0, 99), false);
  assert.equal(shouldStartAutomaticHandoff(true, 70, 69.9), false);
  assert.equal(shouldStartAutomaticHandoff(true, 70, 70), true);
  assert.equal(shouldStartAutomaticHandoff(true, 70, null), false);
});
