import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { defaultConfig } from "../extensions/config.ts";
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
  devDependencies?: Record<string, string>;
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
    devDependencies?: Record<string, string>;
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
  assert.equal(manifest.version, "1.2.3");
  assert.equal(
    manifest.description,
    "Carry ongoing work and conversation into a fresh, natively linked Pi session with template-guided readiness and handoff dossiers. Whether invoked manually or near the context limit, the replacement resumes the existing interaction mode and next action without granting new permission.",
  );
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.keywords, ["pi-package", "pi-extension", "handoff", "context-window", "compaction"]);
  assert.equal(manifest.engines?.node, ">=22.19.0");
  assert.equal(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"], ">=0.84.2");
  assert.equal(manifest.peerDependencies?.["@earendil-works/pi-tui"], "*");
  assert.equal(manifest.devDependencies?.["@earendil-works/pi-tui"], "^0.84.2");
  assert.deepEqual(manifest.files, [
    "extensions",
    "docs",
    "assets/logo.png",
    "templates/call_balanced.cmpl",
    "templates/call_default.cmpl",
    "templates/call_fast.cmpl",
    "templates/handoff_balanced.cmpl",
    "templates/handoff_default.cmpl",
    "templates/handoff_fast.cmpl",
    "CHANGELOG.md",
    "README.md",
    "LICENSE",
    "SECURITY.md",
  ]);
  assert.deepEqual(manifest.pi?.extensions, ["./extensions/index.ts"]);
  assert.equal(
    manifest.pi?.image,
    "https://raw.githubusercontent.com/MircoBlitz/pi-blitz-handoff/main/assets/logo.png",
  );
  assert.equal(manifest.scripts?.test, "node --test --experimental-strip-types test/*.test.ts");
  assert.equal(manifest.scripts?.typecheck, "tsc --noEmit");
  assert.equal(manifest.scripts?.validate, "npm test && npm run typecheck");
  assert.equal(manifest.scripts?.prepublishOnly, "npm run validate");
});

test("public documentation carries the current tagline and supported line", async () => {
  const [readme, security] = await Promise.all([
    readFile(join(projectRoot, "README.md"), "utf8"),
    readFile(join(projectRoot, "SECURITY.md"), "utf8"),
  ]);

  assert.match(readme, /^Steer your context\. Hand off what matters\.$/m);
  assert.match(security, /current 1\.2 code line/);
  assert.doesNotMatch(security, /current 1\.1 code line/);
});

test("shipped template profiles preserve their distinct continuation contracts", async () => {
  const [fastCall, balancedCall, fast, balanced, precise] = await Promise.all([
    readFile(join(projectRoot, "templates", "call_fast.cmpl"), "utf8"),
    readFile(join(projectRoot, "templates", "call_balanced.cmpl"), "utf8"),
    readFile(join(projectRoot, "templates", "handoff_fast.cmpl"), "utf8"),
    readFile(join(projectRoot, "templates", "handoff_balanced.cmpl"), "utf8"),
    readFile(join(projectRoot, "templates", "handoff_default.cmpl"), "utf8"),
  ]);

  assert.match(fastCall, /earliest genuinely safe boundary\. Speed comes first/);
  assert.match(balancedCall, /next stable, genuinely safe boundary/);
  assert.match(balancedCall, /Finish the coherent unit/);

  assert.match(fast, /Speed comes first; precision comes last except where exactness is critical/);
  assert.match(fast, /Prefer a precise file, specification, plan, report, commit, session, or artifact index over restating older knowledge/);
  assert.match(fast, /Do \*\*not\*\* begin with a user-facing recap/);

  assert.match(balanced, /initialize the replacement reliably without reproducing the full source session/);
  assert.match(balanced, /brief user-facing re-entry summary/);
  assert.match(balanced, /Complete the initialization work identified by the dossier/);

  const runtimeState = precise.indexOf("## Operational runtime state");
  const activeInstructions = precise.indexOf("## Active behavioral instructions");
  const loadedSkills = precise.indexOf("## Loaded skills");
  assert.ok(activeInstructions < runtimeState && runtimeState < loadedSkills);
  assert.match(precise, /session-specific runtime deviations or status/);
  assert.match(precise, /Skills whose current state matters/);
  assert.match(precise, /Subagents/);
  assert.match(precise, /Intentionally changed active toolset/);
  assert.match(precise, /Relevant live processes or cmux surfaces/);
  assert.match(precise, /Session-specific behavioral deltas/);
  assert.match(precise, /For each category, write `None\.` when absent/);
  assert.match(precise, /every replacement session to begin its first visible assistant response with a concise re-entry summary/);
  assert.match(precise, /After the summary, the replacement must treat any Deferred Prompts as sequential user inputs/);
  assert.match(precise, /Deferred Prompts may update or supersede the recorded `Action`/);

  for (const template of [fast, balanced, precise]) {
    assert.doesNotMatch(template, /do not perform further task work/i);
    assert.match(template, /extension-owned writer control.*current writer turn/s);
    assert.match(template, /not a user instruction or continuation constraint/);
    assert.match(template, /must not appear in the dossier/);
  }

  assert.match(fast, /autonomous continuation is authorized.*never stop after merely/s);
  for (const template of [balanced, precise]) {
    assert.match(template, /autonomous continuation is authorized.*rather than merely/s);
  }
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
  assert.deepEqual(root?.devDependencies, manifest.devDependencies);
});

test("npm pack includes the runtime and documentation only, excluding tests and local artifacts", async () => {
  const { stdout } = await executeFile("npm", ["pack", "--dry-run", "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  const result = (JSON.parse(stdout) as PackDryRunResult[])[0];
  assert.ok(result);
  const packed = result.files.map((file) => file.path).sort();
  const extensionFiles = (await readdir(join(projectRoot, "extensions")))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `extensions/${name}`);
  const expected = [
    "CHANGELOG.md",
    "LICENSE",
    "README.md",
    "SECURITY.md",
    "assets/logo.png",
    "templates/call_balanced.cmpl",
    "templates/call_default.cmpl",
    "templates/call_fast.cmpl",
    "templates/handoff_balanced.cmpl",
    "templates/handoff_default.cmpl",
    "templates/handoff_fast.cmpl",
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
  for (const filename of [
    "call_balanced.cmpl",
    "call_default.cmpl",
    "call_fast.cmpl",
    "handoff_balanced.cmpl",
    "handoff_default.cmpl",
    "handoff_fast.cmpl",
  ]) {
    assert.equal(
      await readFile(join(templateDirectory, filename), "utf8"),
      await readFile(join(projectRoot, "templates", filename), "utf8"),
    );
  }

  const missingRecoveryDirectory = join(agentDirectory, "missing-recovery");
  await writeFile(
    join(baseDirectory, "config.json"),
    JSON.stringify({ ...defaultConfig(agentDirectory), recoveryDirectory: missingRecoveryDirectory }),
  );
  await assert.rejects(loadExtension(baselineApi), { code: "ENOENT" });
});
