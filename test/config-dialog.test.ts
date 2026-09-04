import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { ConfigDialog } from "../extensions/pi-simple-handoff/config-dialog.ts";
import {
  defaultConfig,
  handoffPaths,
  loadConfig,
  saveConfig,
  type HandoffConfig,
} from "../extensions/pi-simple-handoff/config.ts";

interface Notification {
  message: string;
  type?: "info" | "warning" | "error";
}

type DialogStep =
  | { method: "select"; answer: string | undefined; check?: (title: string, options: string[]) => void }
  | { method: "input"; answer: string | undefined; check?: (title: string, placeholder?: string) => void }
  | { method: "confirm"; answer: boolean; check?: (title: string, message: string) => void };

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-simple-handoff-dialog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function persistedConfig(agentDirectory: string, changes: Partial<HandoffConfig> = {}): Promise<HandoffConfig> {
  const recoveryDirectory = join(agentDirectory, "existing-recovery");
  await mkdir(recoveryDirectory);
  const config = { ...defaultConfig(agentDirectory), recoveryDirectory, ...changes };
  await saveConfig(agentDirectory, config);
  return config;
}

function scriptedContext(steps: DialogStep[]) {
  const notifications: Notification[] = [];
  const context = {
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
      assert.equal(title, "Configure pi-simple-handoff");
      check?.(options);
    },
  };
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

test("setting list shows the complete draft and settings can be revisited without persistence", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const original = await persistedConfig(agentDirectory);
  const configFile = handoffPaths(agentDirectory).configFile;
  const originalFile = await readFile(configFile, "utf8");

  const rig = scriptedContext([
    chooseSetting("Writer attempts: 3", (options) => {
      assert.equal(options.length, 12);
      for (const label of [
        "Context warning percentage",
        "Critical warning percentage",
        "Automatic session handoff",
        "Automatic session handoff percentage",
        "Readiness retry seconds",
        "Writer attempts",
        "Writer retry delay seconds",
        "Recovery directory",
        "Template directory",
        "Handoff template",
      ]) {
        assert.ok(options.some((option) => option.startsWith(`${label}: `)), `missing ${label}`);
      }
      assert.deepEqual(options.slice(-2), ["Save configuration", "Cancel configuration"]);
    }),
    { method: "input", answer: "5" },
    chooseSetting("Context warning percentage: 60", (options) => {
      assert.ok(options.includes("Writer attempts: 5"));
    }),
    { method: "input", answer: "55" },
    chooseSetting("Writer attempts: 5", (options) => {
      assert.ok(options.includes("Context warning percentage: 55"));
    }),
    { method: "input", answer: "7" },
    chooseSetting("Cancel configuration", (options) => {
      assert.ok(options.includes("Writer attempts: 7"));
      assert.ok(options.includes("Template directory: not configured"));
    }),
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  rig.assertFinished();
  assert.deepEqual(await loadConfig(agentDirectory), original);
  assert.equal(await readFile(configFile, "utf8"), originalFile);
  assert.equal(rig.notifications.at(-1)?.message, "Configuration changes discarded.");
});

test("draft path edits do not create directories before save", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const original = await persistedConfig(agentDirectory);
  const missingRecovery = join(agentDirectory, "draft-only", "recovery");
  const missingTemplates = join(agentDirectory, "draft-only", "templates");
  const rig = scriptedContext([
    chooseSetting(`Recovery directory: ${original.recoveryDirectory}`),
    { method: "input", answer: missingRecovery },
    chooseSetting("Template directory: not configured"),
    { method: "input", answer: missingTemplates },
    chooseSetting("Cancel configuration"),
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  assert.equal(await pathExists(missingRecovery), false);
  assert.equal(await pathExists(missingTemplates), false);
  assert.deepEqual(await loadConfig(agentDirectory), original);
});

test("save confirms each exact missing directory, creates it, and persists the complete draft", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const original = await persistedConfig(agentDirectory);
  const recoveryDirectory = join(agentDirectory, "new", "recovery");
  const templateDirectory = join(agentDirectory, "new", "templates");
  const rig = scriptedContext([
    chooseSetting(`Recovery directory: ${original.recoveryDirectory}`),
    { method: "input", answer: recoveryDirectory },
    chooseSetting("Template directory: not configured"),
    { method: "input", answer: templateDirectory },
    chooseSetting("Writer attempts: 3"),
    { method: "input", answer: "6" },
    chooseSetting("Save configuration"),
    {
      method: "confirm",
      answer: true,
      check(title, message) {
        assert.equal(title, "Create missing directory?");
        assert.equal(message, `Saving requires this directory. Create exactly this directory?\n${recoveryDirectory}`);
      },
    },
    {
      method: "confirm",
      answer: true,
      check(_title, message) {
        assert.equal(message, `Saving requires this directory. Create exactly this directory?\n${templateDirectory}`);
      },
    },
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  rig.assertFinished();
  assert.equal((await stat(recoveryDirectory)).isDirectory(), true);
  assert.equal((await stat(templateDirectory)).isDirectory(), true);
  assert.deepEqual(await loadConfig(agentDirectory), {
    ...original,
    recoveryDirectory,
    templateDirectory,
    writerAttempts: 6,
  });
  assert.equal(rig.notifications.at(-1)?.message, "Configuration saved.");
});

test("declining any required directory leaves all missing paths and persisted config unchanged", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const original = await persistedConfig(agentDirectory);
  const recoveryDirectory = join(agentDirectory, "declined", "recovery");
  const templateDirectory = join(agentDirectory, "declined", "templates");
  const rig = scriptedContext([
    chooseSetting(`Recovery directory: ${original.recoveryDirectory}`),
    { method: "input", answer: recoveryDirectory },
    chooseSetting("Template directory: not configured"),
    { method: "input", answer: templateDirectory },
    chooseSetting("Save configuration"),
    { method: "confirm", answer: true },
    { method: "confirm", answer: false },
    chooseSetting("Cancel configuration"),
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  assert.equal(await pathExists(recoveryDirectory), false);
  assert.equal(await pathExists(templateDirectory), false);
  assert.deepEqual(await loadConfig(agentDirectory), original);
  assert.ok(rig.notifications.some(({ message }) => message.includes(templateDirectory)));
});

test("invalid answers show clear feedback and retain the previous draft values", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  await persistedConfig(agentDirectory);
  const rig = scriptedContext([
    chooseSetting("Writer attempts: 3"),
    {
      method: "input",
      answer: "0",
      check(title) {
        assert.equal(title, "How many total writer attempts should be made? Enter a positive integer.");
      },
    },
    chooseSetting("Handoff template: default.cmpl", (options) => {
      assert.ok(options.includes("Writer attempts: 3"));
    }),
    { method: "input", answer: "nested/file.cmpl" },
    chooseSetting("Automatic session handoff: disabled", (options) => {
      assert.ok(options.includes("Handoff template: default.cmpl"));
    }),
    { method: "select", answer: "Enabled" },
    chooseSetting("Cancel configuration", (options) => {
      assert.ok(options.includes("Automatic session handoff: enabled"));
    }),
  ]);

  await new ConfigDialog(agentDirectory).run(rig.context);

  assert.ok(rig.notifications.some(({ message }) => message === "Enter a positive integer."));
  assert.ok(rig.notifications.some(({ message }) => message === "Enter a .cmpl filename without a directory path."));
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
