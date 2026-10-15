import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createHandoffFile, finalizeHandoffFile, handoffStartPrompt } from "../extensions/handoff-file.ts";

async function root(t: test.TestContext): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-file-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("reserves an owner-only file directly under .pi using only the source-session ID", async (t) => {
  const cwd = await root(t);
  const path = createHandoffFile(cwd, "source-session-id");
  assert.equal(path, join(cwd, ".pi", "handoff_source-session-id.md"));
  assert.equal(await readFile(path, "utf8"), "");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(dirname(path))).mode & 0o777, 0o700);
  await writeFile(path, "existing handoff");
  assert.throws(() => createHandoffFile(cwd, "source-session-id"), { code: "EEXIST" });
  assert.equal(await readFile(path, "utf8"), "existing handoff");
  assert.equal(createHandoffFile(cwd, "next-session"), join(cwd, ".pi", "handoff_next-session.md"));
});

test("requires an existing nonempty file without recreating missing or empty dossiers", async (t) => {
  const path = createHandoffFile(await root(t), "source");
  assert.throws(() => finalizeHandoffFile(path, ["deferred"]), /nonempty regular file/);
  assert.equal(await readFile(path, "utf8"), "");
  await unlink(path);
  assert.throws(() => finalizeHandoffFile(path, ["deferred"]), { code: "ENOENT" });
  await assert.rejects(stat(path), { code: "ENOENT" });
});

test("keeps large dossier bytes unchanged and appends deferred inputs in exact order", async (t) => {
  const path = createHandoffFile(await root(t), "source");
  const dossier = "# Complete dossier\n" + "continuation\n".repeat(20_000);
  await writeFile(path, dossier);
  finalizeHandoffFile(path, []);
  assert.equal(await readFile(path, "utf8"), dossier);
  finalizeHandoffFile(path, [" first\nline ", "second"]);
  assert.equal(await readFile(path, "utf8"), dossier + "\n\n" + [
    "## Deferred Prompts",
    "Treat the entries below as separate sequential user inputs after this dossier. Later entries may update or supersede earlier entries.",
    "--- Deferred Prompt 1 of 2 ---\n first\nline \n--- Deferred Prompt 2 of 2 ---\nsecond",
  ].join("\n\n"));
  const prompt = handoffStartPrompt(path, true);
  assert.ok(prompt.length < 1_500);
  assert.doesNotMatch(prompt, /Complete dossier|continuation\n/);
});

test("bootstrap instructs startup, full untruncated ingestion and deletion only after success", () => {
  const path = "/project with spaces/.pi/handoff_source.md";
  const prompt = handoffStartPrompt(path, true);
  assert.ok(prompt.includes(JSON.stringify(path)));
  assert.ok(prompt.indexOf("normal startup instructions") < prompt.indexOf(JSON.stringify(path)));
  assert.match(prompt, /read this file completely/);
  assert.match(prompt, /continue reading until the end/);
  assert.match(prompt, /Only after successful complete ingestion: Delete this file\./);
  assert.match(prompt, /leave the file unchanged/);
  assert.doesNotMatch(prompt, /archive|move this file/i);
});

test("disabled post-read deletion instructs keeping the exact file without moving or archiving it", () => {
  const path = "/project/.pi/handoff_source.md";
  const prompt = handoffStartPrompt(path, false);
  assert.ok(prompt.includes(JSON.stringify(path)));
  assert.match(prompt, /Only after successful complete ingestion: Leave this file unchanged at its current path\./);
  assert.doesNotMatch(prompt, /Delete this file\.|archive|move this file/i);
});
