import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { defaultConfig } from "../extensions/config.ts";
import { SHIPPED_TEMPLATE_FILENAMES } from "../extensions/templates.ts";
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
  assert.equal(manifest.version, "1.3.0");
  assert.equal(
    manifest.description,
    "This extension is designed for one purpose: to capture a session’s continuation context more precisely than compaction and pass it to a fresh, natively linked Pi session as the first prompt that starts the replacement. How work continues is determined by the user’s existing instructions, workflow, and templates.",
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
    "templates/call_default.cmpl",
    "templates/handoff_default.cmpl",
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

test("the package ships only the readiness-only Call default and unchanged reviewed V2 Handoff default", async () => {
  const filenames = ["call_default.cmpl", "handoff_default.cmpl"];
  assert.deepEqual(SHIPPED_TEMPLATE_FILENAMES, filenames);
  assert.deepEqual((await readdir(join(projectRoot, "templates"))).sort(), filenames);

  const [call, handoff] = await Promise.all([
    readFile(join(projectRoot, "templates", "call_default.cmpl")),
    readFile(join(projectRoot, "templates", "handoff_default.cmpl")),
  ]);
  assert.equal(
    createHash("sha256").update(call).digest("hex"),
    "513655a89bf70026e4a97fd22313f1ef79fb68c30ef609cbc9db6ecc2a87fabd",
  );
  assert.equal(
    createHash("sha256").update(handoff).digest("hex"),
    "70eb0966d79ce166397b09e467cd49058cd4e2e0c38476aefef998603992f080",
  );
});

test("the V2 default text instructs mode-aware continuation, scoped grants and targeted retrieval", async () => {
  const handoff = await readFile(join(projectRoot, "templates", "handoff_default.cmpl"), "utf8");
  const headings = [
    "**Working mode:**",
    "### Work and assignment",
    "### Permissions and boundaries",
    "### Current work state",
    "### Binding instructions",
    "### Evidence and uncertainty",
    "### Targeted retrieval",
  ];
  let previous = -1;
  for (const heading of headings) {
    const position = handoff.indexOf(heading);
    assert.ok(position > previous, `Missing or out-of-order field: ${heading}`);
    previous = position;
  }

  assert.match(handoff, /actual pre-writer continuation mode: `userfacing` or `autonom`/);
  assert.match(handoff, /Already commissioned work still to be done/);
  assert.match(handoff, /completing one step does not consume an undertaking-wide grant/);
  assert.match(handoff, /including authorized privilege elevation/);
  assert.match(handoff, /Retain material enumerated conditions/);
  assert.match(handoff, /A past read, audit, available skill or worker's read is not activation/);
  assert.match(handoff, /name — purpose — scope\. No skill paths in this field/);
  assert.match(handoff, /Preserve selected frozen authority through the binding plan\/source reference/);
  assert.match(handoff, /later edits do not inherit an earlier PASS or clean status/);
  assert.match(handoff, /Preserve the exact unread frontier or inspected ranges/);
  assert.match(handoff, /preserve the exact source-session transcript path/i);
  assert.match(handoff, /do not invent one, prescribe routine transcript reading or request ancestor scans/);
  assert.match(handoff, /Apply any Deferred Prompts as separate sequential user inputs/);
  assert.match(handoff, /Do not start with a previous-session recap/);
  assert.match(handoff, /actually perform the authorized next work in the first response, not merely promise continuation/);
  assert.match(handoff, /do not re-request a grant that still covers the work/);
  assert.match(handoff, /writer control applies only to the writer turn; never transfer it as a user instruction or continuation constraint/);
  assert.doesNotMatch(handoff, /^## (Loaded skills|Operational runtime state|Post-Handoff Initial Action)$/m);
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
    "templates/call_default.cmpl",
    "templates/handoff_default.cmpl",
    "docs/session-chain-validation.md",
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
  const filenames = ["call_default.cmpl", "handoff_default.cmpl"];
  assert.deepEqual((await readdir(templateDirectory)).sort(), ["backups", ...filenames]);
  assert.equal((await stat(join(templateDirectory, "backups"))).isDirectory(), true);
  for (const filename of filenames) {
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
