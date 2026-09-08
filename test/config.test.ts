import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";

import {
  defaultConfig,
  handoffPaths,
  loadConfig,
  saveConfig,
  validateConfig,
  type HandoffConfig,
} from "../extensions/pi-blitz-handoff/config.ts";

async function temporaryDirectory(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function configured(agentDirectory: string, changes: Partial<HandoffConfig> = {}): HandoffConfig {
  return { ...defaultConfig(agentDirectory), ...changes };
}

test("defaults exactly match the specified values and managed paths", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const paths = handoffPaths(agentDirectory);

  assert.deepEqual(defaultConfig(agentDirectory), {
    contextWarningPercent: 60,
    criticalWarningPercent: 90,
    automaticSessionHandoff: false,
    automaticSessionHandoffPercent: 70,
    readinessRetrySeconds: 60,
    writerAttempts: 3,
    writerRetryDelaySeconds: 30,
    recoveryDirectory: `${paths.recoveryDirectory}${sep}`,
    templateDirectory: null,
    callTemplate: "call_default.cmpl",
    handoffTemplate: "handoff_default.cmpl",
  });
  assert.deepEqual(await loadConfig(agentDirectory), defaultConfig(agentDirectory));
});

test("validation enforces all numeric and boolean boundaries", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const valid = configured(agentDirectory, {
    contextWarningPercent: 1,
    criticalWarningPercent: 100,
    automaticSessionHandoffPercent: 0,
    readinessRetrySeconds: 1,
    writerAttempts: 1,
    writerRetryDelaySeconds: 300,
  });
  assert.deepEqual(validateConfig(valid), valid);

  const invalidChanges: Partial<HandoffConfig>[] = [
    { contextWarningPercent: 0 },
    { contextWarningPercent: 90 },
    { criticalWarningPercent: 101 },
    { automaticSessionHandoffPercent: -1 },
    { automaticSessionHandoffPercent: 101 },
    { readinessRetrySeconds: 0 },
    { readinessRetrySeconds: 301 },
    { readinessRetrySeconds: 1.5 },
    { writerAttempts: 0 },
    { writerAttempts: 1.5 },
    { writerRetryDelaySeconds: 0 },
    { writerRetryDelaySeconds: 301 },
    { automaticSessionHandoff: 1 as unknown as boolean },
  ];
  for (const changes of invalidChanges) {
    assert.throws(() => validateConfig(configured(agentDirectory, changes)));
  }
});

test("validation requires complete exact settings, absolute directories, and a filename", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const valid = configured(agentDirectory);

  assert.throws(() => validateConfig({ ...valid, extra: true }));
  const incomplete = { ...valid } as Partial<HandoffConfig>;
  delete incomplete.writerAttempts;
  assert.throws(() => validateConfig(incomplete));
  assert.throws(() => validateConfig(configured(agentDirectory, { recoveryDirectory: "relative" })));
  assert.throws(() => validateConfig(configured(agentDirectory, { templateDirectory: "relative" })));
  assert.throws(() => validateConfig(configured(agentDirectory, { callTemplate: "nested/file.cmpl" })));
  assert.throws(() => validateConfig(configured(agentDirectory, { handoffTemplate: "nested/file.cmpl" })));
  assert.throws(() => validateConfig(configured(agentDirectory, { handoffTemplate: "file.md" })));
});

test("save creates only confirmed configured directories and atomically persists complete config", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const recoveryDirectory = join(agentDirectory, "custom", "recovery");
  const templateDirectory = join(agentDirectory, "custom", "templates");
  const config = configured(agentDirectory, { recoveryDirectory, templateDirectory, handoffTemplate: "team.cmpl" });

  await assert.rejects(saveConfig(agentDirectory, config));
  assert.deepEqual(await readdir(handoffPaths(agentDirectory).baseDirectory), []);

  await saveConfig(agentDirectory, config, [recoveryDirectory, templateDirectory]);
  assert.deepEqual(await loadConfig(agentDirectory), config);
  assert.deepEqual(
    JSON.parse(await readFile(handoffPaths(agentDirectory).configFile, "utf8")) as unknown,
    config,
  );
  assert.deepEqual((await readdir(handoffPaths(agentDirectory).baseDirectory)).sort(), ["config.json"]);

  const replacement = { ...config, writerAttempts: 7 };
  await saveConfig(agentDirectory, replacement);
  assert.deepEqual(await loadConfig(agentDirectory), replacement);
  assert.deepEqual((await readdir(handoffPaths(agentDirectory).baseDirectory)).sort(), ["config.json"]);
});

test("configured directory symlinks are accepted", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const targetRecovery = join(agentDirectory, "target-recovery");
  const recoveryLink = join(agentDirectory, "recovery-link");
  await mkdir(targetRecovery);
  await symlink(targetRecovery, recoveryLink, "dir");

  const config = configured(agentDirectory, { recoveryDirectory: recoveryLink });
  await saveConfig(agentDirectory, config);
  assert.deepEqual(await loadConfig(agentDirectory), config);
});

test("an exact old config gains callTemplate only in memory and is not rewritten", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const paths = handoffPaths(agentDirectory);
  await mkdir(paths.baseDirectory);
  const old = { ...defaultConfig(agentDirectory), handoffTemplate: "handoff_team.cmpl" } as Record<string, unknown>;
  delete old.callTemplate;
  const persisted = `${JSON.stringify(old, null, 2)}\n`;
  await writeFile(paths.configFile, persisted);

  assert.deepEqual(await loadConfig(agentDirectory), { ...old, callTemplate: "call_default.cmpl" });
  assert.equal(await readFile(paths.configFile, "utf8"), persisted);
});

test("invalid persisted configuration is rejected rather than merged with defaults", async (t) => {
  const agentDirectory = await temporaryDirectory(t);
  const paths = handoffPaths(agentDirectory);
  await mkdir(paths.baseDirectory);
  await writeFile(paths.configFile, JSON.stringify({ contextWarningPercent: 60 }));

  await assert.rejects(loadConfig(agentDirectory), /exactly the supported settings/);
});
