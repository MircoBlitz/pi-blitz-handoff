import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { initializeHandoffStorage } from "../extensions/pi-simple-handoff/index.ts";
import { loadExtension } from "./extension-harness.ts";

interface PackageManifest {
  engines?: Record<string, string>;
  files?: string[];
  peerDependencies?: Record<string, string>;
  pi?: { extensions?: string[] };
}

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as PackageManifest;
}

test("package declares the supported runtimes and shipped resources", async () => {
  const manifest = await readManifest();

  assert.equal(manifest.engines?.node, ">=22.19.0");
  assert.equal(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"], ">=0.84.2");
  assert.deepEqual(manifest.files, ["extensions", "default.cmpl"]);
  assert.deepEqual(manifest.pi?.extensions, ["./extensions/pi-simple-handoff/index.ts"]);
});

test("extension entrypoint loads with the baseline API adapter", async () => {
  const baselineApi = Object.freeze({}) as ExtensionAPI;

  await assert.doesNotReject(loadExtension(baselineApi));
});

test("foundation initialization creates managed storage, installs the shipped default, and loads defaults", async (t) => {
  const agentDirectory = await mkdtemp(join(tmpdir(), "pi-simple-handoff-package-"));
  t.after(() => rm(agentDirectory, { recursive: true, force: true }));

  const initialized = await initializeHandoffStorage(agentDirectory);
  assert.equal((await stat(initialized.paths.baseDirectory)).isDirectory(), true);
  assert.equal((await stat(initialized.paths.recoveryDirectory)).isDirectory(), true);
  assert.equal((await stat(initialized.paths.templateDirectory)).isDirectory(), true);
  assert.equal(
    await readFile(join(initialized.paths.templateDirectory, "default.cmpl"), "utf8"),
    await readFile(new URL("../default.cmpl", import.meta.url), "utf8"),
  );
  assert.equal(initialized.config.handoffTemplate, "default.cmpl");
});
