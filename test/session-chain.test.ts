import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionHeader } from "@earendil-works/pi-coding-agent";
import { sessionChainLimitReached } from "../extensions/transition.ts";

// Synthetic serialized Pi headers exercise lineage reading without a real model/session run.
function header(id: string, parentSession?: string): SessionHeader {
  return { type: "session", version: 3, id, cwd: "/project", timestamp: "2026-09-30T00:00:00Z", ...(parentSession === undefined ? {} : { parentSession }) };
}

async function chain(t: test.TestContext, length: number): Promise<SessionHeader> {
  const directory = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-chain-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let parent: string | undefined;
  let current = header("master");
  for (let index = 1; index <= length; index += 1) {
    current = header(String(index), parent);
    const path = join(directory, `${index}.jsonl`);
    await writeFile(path, `${JSON.stringify(current)}\n`);
    parent = path;
  }
  return current;
}

test("the master counts as session one, and limit one always starts a new master", async () => {
  assert.equal(await sessionChainLimitReached(header("master"), 25), false);
  assert.equal(await sessionChainLimitReached(header("master"), 1), true);
});

test("the 25-session default links session 25 but makes the following replacement independent", async (t) => {
  assert.equal(await sessionChainLimitReached(await chain(t, 24), 25), false);
  assert.equal(await sessionChainLimitReached(await chain(t, 25), 25), true);
});

test("persisted lineage survives resume/reload and a lower configured limit applies immediately", async (t) => {
  const current = await chain(t, 6);
  const resumed = JSON.parse(JSON.stringify(current)) as SessionHeader;
  assert.equal(await sessionChainLimitReached(resumed, 7), false);
  assert.equal(await sessionChainLimitReached(resumed, 6), true);
  assert.equal(await sessionChainLimitReached(resumed, 3), true);
  assert.equal(await sessionChainLimitReached(header("new-master"), 6), false);
});

test("an unreadable ancestor is a concrete failure, not an invented chain length", async () => {
  await assert.rejects(sessionChainLimitReached(header("source", "/missing/pi-blitz-handoff-parent.jsonl"), 25), /ENOENT/);
  await assert.rejects(sessionChainLimitReached(null, 25), /header is unavailable/);
});
