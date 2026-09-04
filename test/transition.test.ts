import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

import {
  NativeHandoffTransition,
  nativeTransitionCommand,
  registerNativeTransitionBridge,
  type NativeTransitionRequest,
} from "../extensions/pi-simple-handoff/transition.ts";

interface Notification {
  message: string;
  type?: "info" | "warning" | "error";
}

interface TransitionRigOptions {
  deferred?: string[];
  newSessionCancelled?: boolean;
  newSessionError?: Error;
  sendError?: Error;
  cleanupError?: Error;
}

function request(): NativeTransitionRequest {
  return {
    handoffId: "handoff-1",
    sourceSessionPath: "/sessions/exact-source.jsonl",
    dossier: "Task-specific title\n\n# Dossier body",
  };
}

function rig(options: TransitionRigOptions = {}) {
  let deferred = options.deferred;
  const notifications: Notification[] = [];
  const replacementNotifications: Notification[] = [];
  const parents: Array<string | undefined> = [];
  const prompts: string[] = [];
  const cleanup: Array<{ directory: string; fileName: string }> = [];
  const finished: string[] = [];
  const failures: string[] = [];
  const order: string[] = [];

  const replacementContext = {
    sessionManager: { getSessionFile: () => "/sessions/replacement.jsonl" },
    ui: {
      notify(message: string, type?: Notification["type"]) {
        replacementNotifications.push({ message, type });
      },
    },
    async sendUserMessage(content: string) {
      order.push("send");
      if (options.sendError !== undefined) throw options.sendError;
      prompts.push(content);
    },
  } as unknown as Parameters<NonNullable<NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>["withSession"]>>[0];

  const context = {
    sessionManager: { getSessionFile: () => "/sessions/exact-source.jsonl" },
    ui: {
      notify(message: string, type?: Notification["type"]) {
        notifications.push({ message, type });
      },
    },
    async newSession(newSessionOptions?: NonNullable<Parameters<ExtensionCommandContext["newSession"]>[0]>) {
      parents.push(newSessionOptions?.parentSession);
      if (options.newSessionError !== undefined) throw options.newSessionError;
      if (options.newSessionCancelled === true) return { cancelled: true };
      await newSessionOptions?.withSession?.(replacementContext);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext;

  const transition = new NativeHandoffTransition({
    recoveryDirectory: "/recovery",
    createToken: () => "token-1",
    getDeferredSnapshot(handoffId) {
      assert.equal(handoffId, "handoff-1");
      return deferred === undefined
        ? undefined
        : {
            handoffTimestamp: new Date("2026-02-03T04:05:06.007Z"),
            sourceSessionPath: "/sessions/exact-source.jsonl",
            prompts: [...deferred],
          };
    },
    async removeRecoveryFile(directory, fileName) {
      order.push("cleanup");
      cleanup.push({ directory, fileName });
      if (options.cleanupError !== undefined) throw options.cleanupError;
    },
    onFinished(result) {
      finished.push(result.handoffId);
    },
    onFailure(_result, message) {
      failures.push(message);
    },
  });

  return {
    transition,
    context,
    notifications,
    replacementNotifications,
    parents,
    prompts,
    cleanup,
    finished,
    failures,
    order,
    setDeferred(promptsValue: string[] | undefined) {
      deferred = promptsValue;
    },
  };
}

test("the bridge registers one description-free command and uses Pi command dispatch syntax", async () => {
  const testRig = rig();
  const commands: Array<{
    name: string;
    options: {
      description?: string;
      handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
    };
  }> = [];
  const pi = {
    registerCommand(name: string, options: (typeof commands)[number]["options"]) {
      commands.push({ name, options });
    },
  } as Pick<ExtensionAPI, "registerCommand">;

  registerNativeTransitionBridge(pi, testRig.transition);
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.options.description, undefined);

  const token = testRig.transition.prepare(request());
  assert.equal(token, "token-1");
  assert.equal(nativeTransitionCommand(token), `/${commands[0]?.name} token-1`);
  await commands[0]?.options.handler(token, testRig.context);
  assert.deepEqual(testRig.parents, ["/sessions/exact-source.jsonl"]);
});

test("native replacement preserves the dossier first line and omits an empty deferred section", async () => {
  const testRig = rig();
  const token = testRig.transition.prepare(request());
  assert.equal(token, "token-1");

  assert.equal(await testRig.transition.execute(token, testRig.context), true);
  assert.deepEqual(testRig.parents, ["/sessions/exact-source.jsonl"]);
  assert.deepEqual(testRig.prompts, ["Task-specific title\n\n# Dossier body"]);
  assert.equal(testRig.prompts[0]?.split("\n")[0], "Task-specific title");
  assert.doesNotMatch(testRig.prompts[0] ?? "", /Deferred Prompts/);
  assert.deepEqual(testRig.cleanup, []);
  assert.deepEqual(testRig.finished, ["handoff-1"]);
  assert.equal(testRig.transition.phase, "inactive");
});

test("execution takes the latest deferred snapshot, sends one deterministic first prompt, then cleans up", async () => {
  const testRig = rig({ deferred: ["old"] });
  const token = testRig.transition.prepare(request());
  testRig.setDeferred(["  first unchanged\n", "second\nline"]);

  assert.equal(await testRig.transition.execute(token ?? "", testRig.context), true);
  assert.equal(
    testRig.prompts[0],
    [
      "Task-specific title\n\n# Dossier body",
      "## Deferred Prompts",
      "Treat the entries below as separate sequential user inputs after this dossier. Later entries may update or supersede earlier entries.",
      "--- Deferred Prompt 1 of 2 ---\n  first unchanged\n\n--- Deferred Prompt 2 of 2 ---\nsecond\nline",
    ].join("\n\n"),
  );
  assert.deepEqual(testRig.order, ["send", "cleanup"]);
  assert.deepEqual(testRig.cleanup, [{
    directory: "/recovery",
    fileName: "2026-02-03T04-05-06-007Z-exact-source-jsonl.md",
  }]);
});

test("cancellation invalidates a pending token, while native invocation is committed and allows only its own new session", async () => {
  const pending = rig();
  const staleToken = pending.transition.prepare(request());
  assert.equal(pending.transition.cancel(), "cancelled");
  assert.equal(await pending.transition.execute(staleToken ?? "", pending.context), false);
  assert.deepEqual(pending.parents, []);
  assert.match(pending.notifications[0]?.message ?? "", /stale or uncorrelated/);

  let release: (() => void) | undefined;
  const nativeStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const committed = rig();
  const committedContext = {
    ...committed.context,
    async newSession() {
      await nativeStarted;
      return { cancelled: true };
    },
  } as ExtensionCommandContext;
  const token = committed.transition.prepare(request());
  const execution = committed.transition.execute(token ?? "", committedContext);
  await Promise.resolve();
  assert.equal(committed.transition.phase, "replacing");
  assert.equal(committed.transition.cancel(), "committed");
  assert.equal(committed.transition.allowNativeNewSession("resume"), false);
  assert.equal(committed.transition.allowNativeNewSession("new"), true);
  assert.equal(committed.transition.allowNativeNewSession("new"), false);
  release?.();
  assert.equal(await execution, false);
});

test("dispatch failure preserves recovery and reports the exact recovery path in the replacement session", async () => {
  const testRig = rig({ deferred: ["recover me"], sendError: new Error("dispatch rejected") });
  const token = testRig.transition.prepare(request());

  assert.equal(await testRig.transition.execute(token ?? "", testRig.context), false);
  assert.deepEqual(testRig.cleanup, []);
  assert.equal(testRig.finished.length, 0);
  assert.match(testRig.failures[0] ?? "", /dispatch rejected/);
  assert.match(
    testRig.failures[0] ?? "",
    /Deferred-prompt recovery remains at \/recovery\/2026-02-03T04-05-06-007Z-exact-source-jsonl\.md/,
  );
});

test("cleanup failure is visible with its path and does not roll back successful replacement", async () => {
  const testRig = rig({ deferred: ["recover me"], cleanupError: new Error("unlink denied") });
  const token = testRig.transition.prepare(request());

  assert.equal(await testRig.transition.execute(token ?? "", testRig.context), true);
  assert.deepEqual(testRig.finished, ["handoff-1"]);
  assert.equal(testRig.failures.length, 0);
  assert.match(testRig.replacementNotifications[0]?.message ?? "", /\/recovery\/.*\.md/);
  assert.match(testRig.replacementNotifications[0]?.message ?? "", /unlink denied/);
});

test("a guard-cancelled or failed newSession is terminal and never sends or cleans up", async () => {
  for (const options of [
    { newSessionCancelled: true },
    { newSessionError: new Error("native setup failed") },
  ]) {
    const testRig = rig(options);
    const token = testRig.transition.prepare(request());
    assert.equal(await testRig.transition.execute(token ?? "", testRig.context), false);
    assert.deepEqual(testRig.prompts, []);
    assert.deepEqual(testRig.cleanup, []);
    assert.equal(testRig.failures.length, 1);
    assert.equal(testRig.transition.phase, "inactive");
  }
});
