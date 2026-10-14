import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { ConfigDialog } from "../extensions/config-dialog.ts";
import {
  defaultConfig,
  handoffPaths,
  loadConfig,
  saveConfig,
  type HandoffConfig,
} from "../extensions/config.ts";

interface Notification {
  message: string;
  type?: "info" | "warning" | "error";
}

type DialogStep =
  | { method: "select"; answer: string | undefined; check?: (title: string, options: string[]) => void }
  | { method: "input"; answer: string | undefined; check?: (title: string, placeholder?: string) => void }
  | { method: "confirm"; answer: boolean; check?: (title: string, message: string) => void };

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-dialog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function persistedConfig(agentDirectory: string, changes: Partial<HandoffConfig> = {}): Promise<HandoffConfig> {
  const recoveryDirectory = join(agentDirectory, "existing-recovery");
  const templateDirectory = handoffPaths(agentDirectory).templateDirectory;
  await mkdir(recoveryDirectory);
  await mkdir(templateDirectory, { recursive: true });
  await writeFile(join(templateDirectory, "call_default.cmpl"), "call default");
  await writeFile(join(templateDirectory, "handoff_default.cmpl"), "handoff default");
  const config = { ...defaultConfig(agentDirectory), recoveryDirectory, ...changes };
  await saveConfig(agentDirectory, config);
  return config;
}

function scriptedContext(steps: DialogStep[]) {
  const notifications: Notification[] = [];
  // Native RPC dialog test double; terminal component coverage is separate.
  const context = {
    mode: "rpc",
    hasUI: true,
    ui: {
      async select(title: string, options: string[]) {
        const step = steps.shift();
        assert.equal(step?.method, "select");
        if (step?.method !== "select") throw new Error("Expected select step");
        step.check?.(title, options);
        return step.answer;
      },
      async input(title: string, placeholder?: string) {
        const step = steps.shift();
        assert.equal(step?.method, "input");
        if (step?.method !== "input") throw new Error("Expected input step");
        step.check?.(title, placeholder);
        return step.answer;
      },
      async confirm(title: string, message: string) {
        const step = steps.shift();
        assert.equal(step?.method, "confirm");
        if (step?.method !== "confirm") throw new Error("Expected confirm step");
        step.check?.(title, message);
        return step.answer;
      },
      notify(message: string, type?: Notification["type"]) {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;

  return { context, notifications, assertFinished: () => assert.deepEqual(steps, []) };
}

function chooseSetting(label: string, check?: (options: string[]) => void): DialogStep {
  return {
    method: "select",
    answer: label,
    check(title, options) {
      assert.equal(title, "Configure pi-blitz-handoff");
      check?.(options);
    },
  };
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

test("debugging is one boolean setting with immediate persistence in both directions", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  await persistedConfig(agentDirectory);
  const applied: boolean[] = [];
  const rig = scriptedContext([
    chooseSetting("Debugging (archive handoff files): disabled"),
    { method: "select", answer: "Enabled", check(title, options) {
      assert.match(title, /oldlog_donotread/);
      assert.deepEqual(options, ["Enabled", "Disabled"]);
    } },
    chooseSetting("Debugging (archive handoff files): enabled"),
    { method: "select", answer: "Disabled" },
    { method: "select", answer: undefined },
  ]);
  await new ConfigDialog(agentDirectory, (config) => { applied.push(config.debugging); }).run(rig.context);
  rig.assertFinished();
  assert.deepEqual(applied, [true, false]);
  assert.equal((await loadConfig(agentDirectory)).debugging, false);
});

test("Speed Mode is a boolean setting with immediate persistence", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  await persistedConfig(agentDirectory);
  const applied: boolean[] = [];
  const rig = scriptedContext([
    chooseSetting("Speed Mode (optional early preparation): disabled"),
    { method: "select", answer: "Enabled", check(title, options) {
      assert.match(title, /early template retrieval/);
      assert.deepEqual(options, ["Enabled", "Disabled"]);
    } },
    { method: "select", answer: undefined },
  ]);
  await new ConfigDialog(agentDirectory, (config) => { applied.push(config.speedMode); }).run(rig.context);
  rig.assertFinished();
  assert.deepEqual(applied, [true]);
  assert.equal((await loadConfig(agentDirectory)).speedMode, true);
});

test("chain limit rejects zero and fractions, persists immediately and applies live", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  await persistedConfig(agentDirectory);
  const applied: number[] = [];
  const rig = scriptedContext([
    chooseSetting("Maximum session chain length: 25"),
    { method: "input", answer: "0" },
    chooseSetting("Maximum session chain length: 25"),
    { method: "input", answer: "1.5" },
    chooseSetting("Maximum session chain length: 25"),
    { method: "input", answer: "10" },
    { method: "select", answer: undefined, check(_title, options) {
      assert.ok(options.includes("Maximum session chain length: 10"));
    } },
  ]);
  await new ConfigDialog(agentDirectory, (config) => { applied.push(config.maxSessionChainLength); }).run(rig.context);
  rig.assertFinished();
  assert.equal((await loadConfig(agentDirectory)).maxSessionChainLength, 10);
  assert.deepEqual(applied, [10]);
  assert.equal(rig.notifications.filter(({ type }) => type === "warning").length, 2);
});

test("setting list persists every confirmed edit immediately and Escape closes naturally", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const original = await persistedConfig(agentDirectory);
  const applied: HandoffConfig[] = [];
  const rig = scriptedContext([
    chooseSetting("Writer attempts: 3", (options) => {
      assert.equal(options.length, 14);
      assert.equal(options.some((option) => option.startsWith("Save configuration")), false);
      assert.equal(options.some((option) => option.startsWith("Cancel configuration")), false);
    }),
    { method: "input", answer: "5" },
    chooseSetting("Context warning percentage: 60", (options) => {
      assert.ok(options.includes("Writer attempts: 5"));
    }),
    { method: "input", answer: "55" },
    { method: "select", answer: undefined },
  ]);

  await new ConfigDialog(agentDirectory, (config) => {
    applied.push(config);
  }).run(rig.context);

  rig.assertFinished();
  assert.deepEqual(await loadConfig(agentDirectory), {
    ...original,
    writerAttempts: 5,
    contextWarningPercent: 55,
  });
  assert.deepEqual(applied.map(({ writerAttempts, contextWarningPercent }) => ({ writerAttempts, contextWarningPercent })), [
    { writerAttempts: 5, contextWarningPercent: 60 },
    { writerAttempts: 5, contextWarningPercent: 55 },
  ]);
  assert.equal(rig.notifications.some(({ message }) => message.includes("discarded")), false);
});

test("a missing directory is created only after exact confirmation and then persists immediately", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const original = await persistedConfig(agentDirectory);
  const recoveryDirectory = join(agentDirectory, "new", "recovery");
  const rig = scriptedContext([
    chooseSetting(`Recovery directory: ${original.recoveryDirectory}`),
    { method: "input", answer: recoveryDirectory },
    {
      method: "confirm",
      answer: true,
      check(title, message) {
        assert.equal(title, "Create missing directory?");
        assert.equal(message, `Saving requires this directory. Create exactly this directory?\n${recoveryDirectory}`);
      },
    },
    { method: "select", answer: undefined },
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  rig.assertFinished();
  assert.equal((await stat(recoveryDirectory)).isDirectory(), true);
  assert.deepEqual(await loadConfig(agentDirectory), { ...original, recoveryDirectory });
});

test("declining directory creation retains the previous value", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const original = await persistedConfig(agentDirectory);
  const missing = join(agentDirectory, "declined", "templates");
  const rig = scriptedContext([
    chooseSetting("Template directory: not configured"),
    { method: "input", answer: missing },
    { method: "confirm", answer: false },
    chooseSetting("Template directory: not configured"),
    { method: "input", answer: undefined },
    { method: "select", answer: undefined },
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  rig.assertFinished();
  assert.equal(await pathExists(missing), false);
  assert.deepEqual(await loadConfig(agentDirectory), original);
  assert.ok(rig.notifications.some(({ message }) => message.includes(missing)));
});

test("save failures are visible and retain the previous value", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const original = await persistedConfig(agentDirectory);
  const baseDirectory = handoffPaths(agentDirectory).baseDirectory;
  await chmod(baseDirectory, 0o500);
  const rig = scriptedContext([
    chooseSetting("Writer attempts: 3"),
    { method: "input", answer: "5" },
    {
      method: "select",
      answer: undefined,
      check(_title, options) {
        assert.ok(options.includes("Writer attempts: 3"));
      },
    },
  ]);

  try {
    await new ConfigDialog(agentDirectory).run(rig.context);
  } finally {
    await chmod(baseDirectory, 0o700);
  }

  rig.assertFinished();
  assert.deepEqual(await loadConfig(agentDirectory), original);
  assert.ok(rig.notifications.some(({ message, type }) =>
    type === "error" && message.startsWith("Configuration was not saved:")));
});

test("invalid answers show clear feedback and retain the previous persisted values", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  await persistedConfig(agentDirectory, { handoffTemplate: "handoff_custom.cmpl" });
  const rig = scriptedContext([
    chooseSetting("Writer attempts: 3"),
    {
      method: "input",
      answer: "0",
      check(title) {
        assert.equal(title, "How many total writer attempts should be made? Enter a positive integer.");
      },
    },
    chooseSetting("Handoff template: handoff_custom.cmpl", (options) => {
      assert.ok(options.includes("Writer attempts: 3"));
    }),
    {
      method: "select",
      answer: "Enter another filename",
      check(title, options) {
        assert.equal(title, "Which handoff dossier template should be used?");
        assert.deepEqual(options, ["handoff_default.cmpl", "Enter another filename"]);
      },
    },
    { method: "input", answer: "nested/file.cmpl" },
    chooseSetting("Automatic session handoff: disabled", (options) => {
      assert.ok(options.includes("Handoff template: handoff_custom.cmpl"));
    }),
    { method: "select", answer: "Enabled" },
    {
      method: "select",
      answer: undefined,
      check(_title, options) {
        assert.ok(options.includes("Automatic session handoff: enabled"));
      },
    },
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  assert.ok(rig.notifications.some(({ message }) => message === "Enter a positive integer."));
  assert.ok(rig.notifications.some(({ message }) => message === "Enter a .cmpl filename without a directory path."));
});

test("template settings list role-prefixed templates and allow manual entry", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const addendumDirectory = join(agentDirectory, "addendum");
  await mkdir(addendumDirectory);
  await writeFile(join(addendumDirectory, "call_custom.cmpl"), "custom call");
  await writeFile(join(addendumDirectory, "handoff_compact.cmpl"), "handoff compact");
  await writeFile(join(addendumDirectory, "unrelated.cmpl"), "not role prefixed");
  await persistedConfig(agentDirectory, { templateDirectory: addendumDirectory });

  const rig = scriptedContext([
    chooseSetting("Call template: call_default.cmpl"),
    {
      method: "select",
      answer: "call_custom.cmpl",
      check(title, options) {
        assert.equal(title, "Which session handoff call template should be used?");
        assert.deepEqual(options, ["call_custom.cmpl", "call_default.cmpl", "Enter another filename"]);
      },
    },
    chooseSetting("Handoff template: handoff_default.cmpl", (options) => {
      assert.ok(options.includes("Call template: call_custom.cmpl"));
    }),
    {
      method: "select",
      answer: "Enter another filename",
      check(title, options) {
        assert.equal(title, "Which handoff dossier template should be used?");
        assert.deepEqual(options, ["handoff_compact.cmpl", "handoff_default.cmpl", "Enter another filename"]);
      },
    },
    {
      method: "input",
      answer: "handoff_custom.cmpl",
      check(title) {
        assert.equal(title, "What .cmpl filename should be used? Enter a filename, not a path.");
      },
    },
    {
      method: "select",
      answer: undefined,
      check(_title, options) {
        assert.ok(options.includes("Handoff template: handoff_custom.cmpl"));
      },
    },
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  rig.assertFinished();
});

test("discard aborts an active extension-owned question", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  await persistedConfig(agentDirectory);
  let observedSignal: AbortSignal | undefined;
  let markSelectStarted: (() => void) | undefined;
  const selectStarted = new Promise<void>((resolve) => {
    markSelectStarted = resolve;
  });
  const context = {
    hasUI: true,
    ui: {
      select(_title: string, _options: string[], opts?: { signal?: AbortSignal }) {
        observedSignal = opts?.signal;
        markSelectStarted?.();
        return new Promise<string | undefined>((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve(undefined), { once: true });
        });
      },
      notify() {},
    },
  } as unknown as ExtensionCommandContext;
  const dialog = new ConfigDialog(agentDirectory);

  const running = dialog.run(context);
  await selectStarted;
  assert.equal(dialog.isActive, true);
  dialog.discard();
  await running;

  assert.equal(observedSignal?.aborted, true);
  assert.equal(dialog.isActive, false);
});
