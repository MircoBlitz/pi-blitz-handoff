import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { defaultConfig } from "../extensions/pi-simple-handoff/config.ts";
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

test("loading the package entrypoint initializes and validates managed storage", async (t) => {
  const agentDirectory = await mkdtemp(join(tmpdir(), "pi-simple-handoff-package-"));
  const previousAgentDirectory = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDirectory;
  t.after(() => {
    if (previousAgentDirectory === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDirectory;
    }
  });
  t.after(() => rm(agentDirectory, { recursive: true, force: true }));

  const baselineApi = Object.freeze({}) as ExtensionAPI;
  await loadExtension(baselineApi);

  const baseDirectory = join(agentDirectory, "pi-simple-handoff");
  const recoveryDirectory = join(baseDirectory, "recovery");
  const templateDirectory = join(baseDirectory, "templates");
  assert.equal((await stat(baseDirectory)).isDirectory(), true);
  assert.equal((await stat(recoveryDirectory)).isDirectory(), true);
  assert.equal((await stat(templateDirectory)).isDirectory(), true);
  assert.equal(
    await readFile(join(templateDirectory, "default.cmpl"), "utf8"),
    await readFile(new URL("../default.cmpl", import.meta.url), "utf8"),
  );

  const missingRecoveryDirectory = join(agentDirectory, "missing-recovery");
  await writeFile(
    join(baseDirectory, "config.json"),
    JSON.stringify({ ...defaultConfig(agentDirectory), recoveryDirectory: missingRecoveryDirectory }),
  );
  await assert.rejects(loadExtension(baselineApi), { code: "ENOENT" });
});
