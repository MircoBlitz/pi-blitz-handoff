import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  deleteRecoveryFile,
  inspectRecoveryFile,
  normalizeSourceSessionId,
  persistDeferredPrompts,
  recoveryFileName,
} from "../extensions/pi-blitz-handoff/recovery-store.ts";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-blitz-handoff-recovery-"));
}

test("recovery filenames use safe UTC milliseconds and normalized transcript basenames", () => {
  const timestamp = new Date("2026-02-03T04:05:06.007Z");

  assert.equal(normalizeSourceSessionId("/sessions/My source_#1.jsonl"), "My-source-1-jsonl");
  assert.equal(normalizeSourceSessionId("/sessions/...."), "session");
  assert.equal(
    recoveryFileName(timestamp, "/sessions/My source_#1.jsonl"),
    "2026-02-03T04-05-06-007Z-My-source-1-jsonl.md",
  );
});

test("one private recovery file is atomically replaced with the complete latest snapshot", async (t) => {
  const root = await temporaryDirectory();
  t.after(() => rm(root, { recursive: true, force: true }));
  const realDirectory = join(root, "real");
  const recoveryDirectory = join(root, "linked");
  await mkdir(realDirectory, { mode: 0o700 });
  await symlink(realDirectory, recoveryDirectory, "dir");

  const base = {
    handoffTimestamp: new Date("2026-02-03T04:05:06.007Z"),
    sourceSessionPath: "/sessions/source.jsonl",
  };
  const fileName = await persistDeferredPrompts(recoveryDirectory, { ...base, prompts: [" first "] });
  assert.deepEqual(await readdir(realDirectory), [fileName]);
  assert.equal(await inspectRecoveryFile(recoveryDirectory, fileName), "--- Deferred Prompt 1 of 1 ---\n first ");
  assert.equal((await stat(join(realDirectory, fileName))).mode & 0o777, 0o600);

  const second = "second\nline";
  await persistDeferredPrompts(recoveryDirectory, { ...base, prompts: [" first ", second] });
  assert.deepEqual(await readdir(realDirectory), [fileName]);
  assert.equal(
    await inspectRecoveryFile(recoveryDirectory, fileName),
    `--- Deferred Prompt 1 of 2 ---\n first \n--- Deferred Prompt 2 of 2 ---\n${second}`,
  );
});

test("empty snapshots create no file and inspect/delete operate on only an exact safe selection", async (t) => {
  const recoveryDirectory = await temporaryDirectory();
  t.after(() => rm(recoveryDirectory, { recursive: true, force: true }));
  const snapshot = {
    handoffTimestamp: new Date("2026-02-03T04:05:06.007Z"),
    sourceSessionPath: "/sessions/source.jsonl",
    prompts: [] as string[],
  };

  await assert.rejects(() => persistDeferredPrompts(recoveryDirectory, snapshot), /empty/);
  assert.deepEqual(await readdir(recoveryDirectory), []);

  const fileName = await persistDeferredPrompts(recoveryDirectory, { ...snapshot, prompts: ["recover me"] });
  await assert.rejects(() => inspectRecoveryFile(recoveryDirectory, "../outside.md"), /filesystem-safe/);
  await assert.rejects(() => deleteRecoveryFile(recoveryDirectory, "nested/file.md"), /filesystem-safe/);
  assert.deepEqual(await readdir(recoveryDirectory), [fileName]);

  await deleteRecoveryFile(recoveryDirectory, fileName);
  assert.deepEqual(await readdir(recoveryDirectory), []);
});
