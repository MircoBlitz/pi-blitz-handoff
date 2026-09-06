import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  CALL_DEFAULT_TEMPLATE,
  HANDOFF_DEFAULT_TEMPLATE,
  catalogueTemplates,
  checkTemplateHealth,
  resolveTemplate,
  synchronizeManagedTemplate,
} from "../extensions/pi-blitz-handoff/templates.ts";

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-templates-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("managed default is installed when missing and untouched when equal", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  const packaged = join(root, "package.cmpl");
  await writeFile(packaged, "shipped default");

  assert.deepEqual(await synchronizeManagedTemplate(managed, "default.cmpl", packaged), { status: "installed" });
  const managedPath = join(managed, "default.cmpl");
  const before = await stat(managedPath);
  assert.equal(await readFile(managedPath, "utf8"), "shipped default");
  assert.equal(before.mode & 0o777, 0o600);

  assert.deepEqual(await synchronizeManagedTemplate(managed, "default.cmpl", packaged), { status: "equal" });
  assert.equal((await stat(managedPath)).ino, before.ino);
  assert.deepEqual(await readdir(managed), ["default.cmpl"]);
});

test("a different managed default is timestamp-backed up before replacement", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  const packaged = join(root, "package.cmpl");
  await mkdir(managed);
  await writeFile(packaged, "new default");
  await writeFile(join(managed, "default.cmpl"), "old default");
  await writeFile(join(managed, "other.cmpl"), "preserved");
  const now = new Date("2025-06-07T08:09:10.123Z");
  const backupPath = join(managed, "default.cmpl.backup-2025-06-07T08-09-10.123Z");

  assert.deepEqual(await synchronizeManagedTemplate(managed, "default.cmpl", packaged, now), {
    status: "updated",
    backupPath,
  });
  assert.equal(await readFile(backupPath, "utf8"), "old default");
  assert.equal(await readFile(join(managed, "default.cmpl"), "utf8"), "new default");
  assert.equal(await readFile(join(managed, "other.cmpl"), "utf8"), "preserved");
  assert.equal(backupPath.endsWith(".cmpl"), false);
});

test("catalogue is nonrecursive, excludes invalid entries, and addendum shadows managed", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  const addendum = join(root, "addendum");
  await mkdir(join(managed, "nested"), { recursive: true });
  await mkdir(addendum);
  await writeFile(join(managed, "default.cmpl"), "managed default");
  await writeFile(join(managed, "team.cmpl"), "managed team");
  await writeFile(join(managed, "empty.cmpl"), "");
  await writeFile(join(managed, "default.cmpl.backup-date"), "backup");
  await writeFile(join(managed, "nested", "hidden.cmpl"), "nested");
  await writeFile(join(addendum, "team.cmpl"), "addendum team");
  await writeFile(join(addendum, "extra.cmpl"), "extra");

  assert.deepEqual(await catalogueTemplates(managed, addendum), [
    { filename: "default.cmpl", path: join(managed, "default.cmpl"), source: "managed" },
    { filename: "extra.cmpl", path: join(addendum, "extra.cmpl"), source: "addendum" },
    { filename: "team.cmpl", path: join(addendum, "team.cmpl"), source: "addendum" },
  ]);
});

test("resolution uses an addendum selected template first and otherwise the managed selection", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  const addendum = join(root, "addendum");
  await mkdir(managed);
  await mkdir(addendum);
  await writeFile(join(managed, "team.cmpl"), "managed team");
  await writeFile(join(addendum, "team.cmpl"), "addendum team");

  assert.deepEqual(await resolveTemplate("team.cmpl", { managedDirectory: managed, addendumDirectory: addendum }), {
    path: resolve(addendum, "team.cmpl"),
    content: "addendum team",
    failures: [],
  });

  await rm(join(addendum, "team.cmpl"));
  assert.deepEqual(await resolveTemplate("team.cmpl", { managedDirectory: managed, addendumDirectory: addendum }), {
    path: resolve(managed, "team.cmpl"),
    content: "managed team",
    failures: [],
  });
});

test("resolution reports failures through addendum and managed default fallbacks", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  const addendum = join(root, "addendum");
  await mkdir(managed);
  await mkdir(addendum);
  await writeFile(join(managed, "team.cmpl"), "");
  await writeFile(join(addendum, "default.cmpl"), "");
  await writeFile(join(managed, "default.cmpl"), "managed default");

  const result = await resolveTemplate("team.cmpl", { managedDirectory: managed, addendumDirectory: addendum }, "default.cmpl");
  assert.equal(result.path, resolve(managed, "default.cmpl"));
  assert.equal(result.content, "managed default");
  assert.deepEqual(result.failures, [
    { path: resolve(managed, "team.cmpl"), reason: "template is empty" },
    { path: resolve(addendum, "default.cmpl"), reason: "template is empty" },
  ]);
});

test("the same physical fallback candidate is attempted at most once", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  const addendum = join(root, "addendum");
  await mkdir(managed);
  await mkdir(addendum);
  await writeFile(join(addendum, "default.cmpl"), "");
  await writeFile(join(managed, "default.cmpl"), "managed default");

  const result = await resolveTemplate("default.cmpl", { managedDirectory: managed, addendumDirectory: addendum }, "default.cmpl");
  assert.equal(result.path, resolve(managed, "default.cmpl"));
  assert.deepEqual(result.failures, [
    { path: resolve(addendum, "default.cmpl"), reason: "template is empty" },
  ]);
});

test("role-specific defaults do not fall back through the other role", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  await mkdir(managed);
  await writeFile(join(managed, CALL_DEFAULT_TEMPLATE), "call fallback");
  await writeFile(join(managed, HANDOFF_DEFAULT_TEMPLATE), "handoff fallback");

  assert.equal((await resolveTemplate("missing.cmpl", { managedDirectory: managed, addendumDirectory: null }, CALL_DEFAULT_TEMPLATE)).content, "call fallback");
  assert.equal((await resolveTemplate("missing.cmpl", { managedDirectory: managed, addendumDirectory: null }, HANDOFF_DEFAULT_TEMPLATE)).content, "handoff fallback");
  await rm(join(managed, CALL_DEFAULT_TEMPLATE));
  await assert.rejects(resolveTemplate("missing.cmpl", { managedDirectory: managed, addendumDirectory: null }, CALL_DEFAULT_TEMPLATE));
});

test("health check warns only when a non-default selection falls back", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  await mkdir(managed);
  await writeFile(join(managed, CALL_DEFAULT_TEMPLATE), "call fallback");

  const fallback = await checkTemplateHealth(
    "Call",
    "missing.cmpl",
    CALL_DEFAULT_TEMPLATE,
    { managedDirectory: managed, addendumDirectory: null },
  );
  assert.equal(fallback.resolved.path, resolve(managed, CALL_DEFAULT_TEMPLATE));
  assert.match(fallback.warning ?? "", /Call template "missing\.cmpl" could not be used/);
  assert.match(fallback.warning ?? "", /managed\/missing\.cmpl/);
  assert.match(fallback.warning ?? "", /Using fallback .*call_default\.cmpl/);

  const configuredDefault = await checkTemplateHealth(
    "Call",
    CALL_DEFAULT_TEMPLATE,
    CALL_DEFAULT_TEMPLATE,
    { managedDirectory: managed, addendumDirectory: null },
  );
  assert.equal(configuredDefault.warning, undefined);
});

test("health check identifies a role default that cannot resolve", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  await mkdir(managed);
  await writeFile(join(managed, "custom.cmpl"), "valid custom template");

  await assert.rejects(
    checkTemplateHealth(
      "Handoff",
      "custom.cmpl",
      HANDOFF_DEFAULT_TEMPLATE,
      { managedDirectory: managed, addendumDirectory: null },
    ),
    /Handoff template default "handoff_default\.cmpl" could not resolve/,
  );
});

test("resolution has exactly three tiers and no embedded fallback", async (t) => {
  const root = await temporaryDirectory(t);
  const managed = join(root, "managed");
  const addendum = join(root, "addendum");
  await mkdir(managed);
  await mkdir(addendum);
  await writeFile(join(addendum, "team.cmpl"), "");

  await assert.rejects(
    resolveTemplate("team.cmpl", { managedDirectory: managed, addendumDirectory: addendum }, "default.cmpl"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /No valid template found/);
      assert.match(error.message, /addendum\/team\.cmpl/);
      assert.match(error.message, /addendum\/default\.cmpl/);
      assert.match(error.message, /managed\/default\.cmpl/);
      return true;
    },
  );
});
