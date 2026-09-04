import assert from "node:assert/strict";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  assembleRecoveryTurn,
  RecoveryDialog,
} from "../extensions/pi-simple-handoff/recovery-dialog.ts";

interface Notification {
  message: string;
  type?: "info" | "warning" | "error";
}

interface SelectStep {
  answer: string | undefined;
  check?(title: string, options: string[]): void;
}

async function recoveryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-simple-handoff-recover-dialog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function scriptedContext(steps: SelectStep[]) {
  const notifications: Notification[] = [];
  const context = {
    hasUI: true,
    ui: {
      async select(title: string, options: string[]) {
        const step = steps.shift();
        if (step === undefined) throw new Error(`Unexpected selection dialog: ${title}`);
        step.check?.(title, options);
        return step.answer;
      },
      notify(message: string, type?: Notification["type"]) {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;
  return { context, notifications, assertFinished: () => assert.deepEqual(steps, []) };
}

const firstFile = "2026-02-03T04-05-06-007Z-first-jsonl.md";
const secondFile = "2026-02-04T05-06-07-008Z-second-jsonl.md";

async function put(directory: string, fileName: string, content: string): Promise<void> {
  await writeFile(join(directory, fileName), content);
}

test("recovery lists every safe top-level recovery file with its UTC date", async (t) => {
  const directory = await recoveryDirectory(t);
  await put(directory, secondFile, "second");
  await put(directory, firstFile, "first");
  await put(directory, "notes.txt", "ignored");
  await mkdir(join(directory, "2026-02-05T00-00-00-000Z-directory.md"));

  const rig = scriptedContext([{
    answer: "Cancel recovery",
    check(title, options) {
      assert.equal(title, "Recover deferred session handoff prompts");
      assert.deepEqual(options, [
        `2026-02-03T04:05:06.007Z — ${firstFile}`,
        `2026-02-04T05:06:07.008Z — ${secondFile}`,
        "Cancel recovery",
      ]);
    },
  }]);

  await new RecoveryDialog(directory, () => {}).run(rig.context);

  rig.assertFinished();
  assert.deepEqual((await readdir(directory)).sort(), [
    "2026-02-05T00-00-00-000Z-directory.md",
    firstFile,
    "notes.txt",
    secondFile,
  ].sort());
  assert.equal(rig.notifications.at(-1)?.message, "Recovery cancelled; all recovery files were retained.");
});

test("inspect shows complete contents read-only and return or cancel never modifies files", async (t) => {
  const directory = await recoveryDirectory(t);
  const content = "--- Deferred Prompt 1 of 1 ---\n  complete\ncontent  ";
  await put(directory, firstFile, content);
  const label = `2026-02-03T04:05:06.007Z — ${firstFile}`;
  const rig = scriptedContext([
    { answer: label },
    { answer: "Inspect complete contents" },
    {
      answer: "Return to file actions",
      check(title, options) {
        assert.equal(title, `Complete contents of ${firstFile} (read-only):\n\n${content}`);
        assert.deepEqual(options, ["Return to file actions", "Cancel recovery"]);
      },
    },
    { answer: "Return to recovery file list" },
    { answer: label },
    { answer: "Cancel recovery" },
  ]);

  await new RecoveryDialog(directory, () => {}).run(rig.context);

  rig.assertFinished();
  assert.equal(await readFile(join(directory, firstFile), "utf8"), content);
  assert.equal(rig.notifications.at(-1)?.message, "Recovery cancelled; the selected file was retained.");
});

test("execute dispatches one combined sequential turn and deletes only after immediate acceptance", async (t) => {
  const directory = await recoveryDirectory(t);
  const content = "--- Deferred Prompt 1 of 2 ---\nfirst\n--- Deferred Prompt 2 of 2 ---\nsecond";
  await put(directory, firstFile, content);
  const sent: string[] = [];
  const rig = scriptedContext([
    { answer: `2026-02-03T04:05:06.007Z — ${firstFile}` },
    { answer: "Execute recovered prompts" },
  ]);

  await new RecoveryDialog(directory, (message) => {
    assert.deepEqual(awaitedFileNames(directory), [firstFile]);
    sent.push(message as string);
  }).run(rig.context);

  rig.assertFinished();
  assert.deepEqual(sent, [assembleRecoveryTurn(content)]);
  assert.match(sent[0] ?? "", /separate sequential user inputs/);
  assert.ok((sent[0] ?? "").endsWith(content));
  assert.deepEqual(await readdir(directory), []);
});

test("immediate dispatch errors and unreadable files are reported and retained", async (t) => {
  const directory = await recoveryDirectory(t);
  await put(directory, firstFile, "recover me");
  const label = `2026-02-03T04:05:06.007Z — ${firstFile}`;
  const dispatchRig = scriptedContext([
    { answer: label },
    { answer: "Execute recovered prompts" },
    { answer: label },
    { answer: "Cancel recovery" },
  ]);
  await new RecoveryDialog(directory, () => {
    throw new Error("agent busy");
  }).run(dispatchRig.context);
  assert.equal(await readFile(join(directory, firstFile), "utf8"), "recover me");
  assert.match(dispatchRig.notifications[0]?.message ?? "", /agent busy/);
  assert.match(dispatchRig.notifications[0]?.message ?? "", new RegExp(firstFile));

  await rm(join(directory, firstFile));
  await symlink(join(directory, "missing-target"), join(directory, secondFile));
  const unreadableLabel = `2026-02-04T05:06:07.008Z — ${secondFile}`;
  const unreadableRig = scriptedContext([
    { answer: unreadableLabel },
    { answer: "Inspect complete contents" },
    { answer: "Cancel recovery" },
  ]);
  await new RecoveryDialog(directory, () => {}).run(unreadableRig.context);
  assert.match(unreadableRig.notifications[0]?.message ?? "", /Could not read recovery file/);
  assert.match(unreadableRig.notifications[0]?.message ?? "", /retained/);
  assert.deepEqual(await readdir(directory), [secondFile]);
});

test("discard removes only the selected file and post-dispatch cleanup failure reports its exact path", async (t) => {
  const directory = await recoveryDirectory(t);
  await put(directory, firstFile, "discard");
  await put(directory, secondFile, "keep");
  const discardRig = scriptedContext([
    { answer: `2026-02-03T04:05:06.007Z — ${firstFile}` },
    { answer: "Discard recovery file" },
    { answer: `2026-02-04T05:06:07.008Z — ${secondFile}` },
    { answer: "Cancel recovery" },
  ]);
  await new RecoveryDialog(directory, () => {}).run(discardRig.context);
  assert.deepEqual(await readdir(directory), [secondFile]);

  const exactPath = join(directory, secondFile);
  const cleanupRig = scriptedContext([
    { answer: `2026-02-04T05:06:07.008Z — ${secondFile}` },
    { answer: "Execute recovered prompts" },
  ]);
  await new RecoveryDialog(directory, () => {
    rmSync(exactPath);
    mkdirSync(exactPath);
  }).run(cleanupRig.context);

  assert.equal((await readdir(directory)).includes(secondFile), true);
  assert.match(cleanupRig.notifications.at(-1)?.message ?? "", /dispatch returned without an immediate error/i);
  assert.match(cleanupRig.notifications.at(-1)?.message ?? "", new RegExp(escapeRegex(exactPath)));
  assert.equal(cleanupRig.notifications.at(-1)?.type, "error");
});

function awaitedFileNames(directory: string): string[] {
  return readdirSync(directory);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
