import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { defaultConfig } from "../extensions/pi-blitz-handoff/config.ts";
import { loadExtension } from "./extension-harness.ts";

interface PackageManifest {
  name?: string;
  version?: string;
  description?: string;
  type?: string;
  engines?: Record<string, string>;
  files?: string[];
  keywords?: string[];
  peerDependencies?: Record<string, string>;
  pi?: { extensions?: string[]; image?: string };
  scripts?: Record<string, string>;
}

interface PackageLock {
  name?: string;
  version?: string;
  packages?: Record<string, {
    name?: string;
    version?: string;
    engines?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  }>;
}

interface PackDryRunResult {
  files: Array<{ path: string }>;
}

const projectRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const executeFile = promisify(execFile);

async function readManifest(): Promise<PackageManifest> {
  return JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as PackageManifest;
}

test("package metadata declares the supported runtime and complete Pi package resources", async () => {
  const manifest = await readManifest();

  assert.equal(manifest.name, "pi-blitz-handoff");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(
    manifest.description,
    "Carry focused task context into a genuinely fresh, natively linked Pi session.",
  );
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.keywords, ["pi-package", "pi-extension", "handoff", "context-window", "compaction"]);
  assert.equal(manifest.engines?.node, ">=22.19.0");
  assert.equal(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"], ">=0.84.2");
  assert.deepEqual(manifest.files, ["extensions", "docs", "assets", "default.cmpl", "README.md", "LICENSE", "SECURITY.md"]);
  assert.deepEqual(manifest.pi?.extensions, ["./extensions/pi-blitz-handoff/index.ts"]);
  assert.equal(
    manifest.pi?.image,
    "https://raw.githubusercontent.com/MircoBlitz/pi-blitz-handoff/main/assets/logo.png",
  );
  assert.equal(manifest.scripts?.test, "node --test --experimental-strip-types test/*.test.ts");
  assert.equal(manifest.scripts?.typecheck, "tsc --noEmit");
  assert.equal(manifest.scripts?.validate, "npm test && npm run typecheck");
  assert.equal(manifest.scripts?.prepublishOnly, "npm run validate");
});

test("package lock root metadata remains coherent with the manifest", async () => {
  const manifest = await readManifest();
  const lock = JSON.parse(await readFile(join(projectRoot, "package-lock.json"), "utf8")) as PackageLock;
  const root = lock.packages?.[""];

  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(root?.name, manifest.name);
  assert.equal(root?.version, manifest.version);
  assert.deepEqual(root?.engines, manifest.engines);
  assert.deepEqual(root?.peerDependencies, manifest.peerDependencies);
});

test("npm pack includes the runtime and documentation only, excluding tests and local artifacts", async () => {
  const { stdout } = await executeFile("npm", ["pack", "--dry-run", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const result = (JSON.parse(stdout) as PackDryRunResult[])[0];
  assert.ok(result);
  const packed = result.files.map((file) => file.path).sort();
  const extensionFiles = (await readdir(join(projectRoot, "extensions", "pi-blitz-handoff")))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `extensions/pi-blitz-handoff/${name}`);
  const expected = [
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "assets/logo.png",
    "default.cmpl",
    "docs/specification.md",
    "docs/specification.sha256",
    "package.json",
    ...extensionFiles,
  ].sort();

  assert.deepEqual(packed, expected);
  assert.equal(packed.some((path) => path.startsWith("test/") || path.startsWith(".pi")), false);
  assert.equal(packed.includes("package-lock.json"), false);
});

test("loading the package entrypoint initializes and validates managed storage", async (t) => {
  const agentDirectory = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-package-"));
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

  const baseDirectory = join(agentDirectory, "pi-blitz-handoff");
  const recoveryDirectory = join(baseDirectory, "recovery");
  const templateDirectory = join(baseDirectory, "templates");
  assert.equal((await stat(baseDirectory)).isDirectory(), true);
  assert.equal((await stat(recoveryDirectory)).isDirectory(), true);
  assert.equal((await stat(templateDirectory)).isDirectory(), true);
  assert.equal(
    await readFile(join(templateDirectory, "default.cmpl"), "utf8"),
    await readFile(join(projectRoot, "default.cmpl"), "utf8"),
  );

  const missingRecoveryDirectory = join(agentDirectory, "missing-recovery");
  await writeFile(
    join(baseDirectory, "config.json"),
    JSON.stringify({ ...defaultConfig(agentDirectory), recoveryDirectory: missingRecoveryDirectory }),
  );
  await assert.rejects(loadExtension(baselineApi), { code: "ENOENT" });
});
