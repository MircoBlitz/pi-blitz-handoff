import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
