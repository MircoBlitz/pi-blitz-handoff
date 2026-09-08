import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  atomicWriteFile,
  ensureDirectory,
  PRIVATE_DIRECTORY_MODE,
  PRIVATE_FILE_MODE,
  requireDirectory,
} from "../extensions/filesystem.ts";

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-filesystem-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function permissions(mode: number): number {
  return mode & 0o777;
}

test("new private directories and files use restrictive modes", async (t) => {
  const root = await temporaryDirectory(t);
  const directory = join(root, "private", "nested");
  await ensureDirectory(directory);
  assert.equal(permissions((await stat(directory)).mode), PRIVATE_DIRECTORY_MODE);

  const file = join(directory, "private.txt");
  await atomicWriteFile(file, "private");
  assert.equal(permissions((await stat(file)).mode), PRIVATE_FILE_MODE);
  assert.equal(await readFile(file, "utf8"), "private");
});

test("directory symlinks are valid and non-directories are rejected", async (t) => {
  const root = await temporaryDirectory(t);
  const target = join(root, "target");
  const link = join(root, "link");
  await mkdir(target);
  await symlink(target, link, "dir");

  await assert.doesNotReject(ensureDirectory(link));
  await assert.doesNotReject(requireDirectory(link));

  const file = join(root, "file");
  await writeFile(file, "not a directory");
  await assert.rejects(ensureDirectory(file), /Not a directory/);
  await assert.rejects(requireDirectory(file), /Not a directory/);
});

test("atomic writes replace the target and leave no temporary sibling", async (t) => {
  const root = await temporaryDirectory(t);
  const file = join(root, "config.json");
  await atomicWriteFile(file, "first");
  const firstInode = (await stat(file)).ino;

  await atomicWriteFile(file, "second");
  assert.equal(await readFile(file, "utf8"), "second");
  assert.notEqual((await stat(file)).ino, firstInode);
  assert.deepEqual(await readdir(root), ["config.json"]);
});

test("a failed atomic replacement removes only its exact temporary file", async (t) => {
  const root = await temporaryDirectory(t);
  const targetDirectory = join(root, "target");
  const nested = join(targetDirectory, "keep.txt");
  await mkdir(targetDirectory);
  await writeFile(nested, "keep");

  await assert.rejects(atomicWriteFile(targetDirectory, "cannot replace a directory"));
  assert.deepEqual(await readdir(root), ["target"]);
  assert.equal(await readFile(nested, "utf8"), "keep");
});
