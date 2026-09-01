import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	DEFAULT_CONFIG,
	loadSimpleHandoffConfig,
	saveSimpleHandoffConfig,
	simpleHandoffConfigPath,
} from "../extensions/pi-simple-handoff/config.ts";
import { validateThresholds } from "../extensions/pi-simple-handoff/core.ts";

async function withAgentDirectory(run: (directory: string) => Promise<void>): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "pi-simple-handoff-config-"));
	try {
		await mkdir(join(directory, "extensions"));
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("uses defaults when the extension settings file is absent", async () => {
	await withAgentDirectory(async (directory) => {
		assert.deepEqual(loadSimpleHandoffConfig(directory), DEFAULT_CONFIG);
	});
});

test("loads KV warning and self-handoff limits from the Pi extension settings file", async () => {
	await withAgentDirectory(async (directory) => {
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			kvWarningPercent: 55,
			selfHandoffPercent: 75,
		}), "utf8");
		const config = loadSimpleHandoffConfig(directory);
		assert.deepEqual(validateThresholds({ warningThreshold: config.kvWarningPercent, criticalThreshold: config.selfHandoffPercent }), {
			warningThreshold: 55,
			criticalThreshold: 75,
		});
	});
});

test("loads separate automatic, readiness, and writer retry settings", async () => {
	await withAgentDirectory(async (directory) => {
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			automaticSessionHandoff: true,
			automaticSessionHandoffPercent: 49,
			readinessRetrySeconds: 45,
			writerRetryLimit: 5,
			writerRetryDelaySeconds: 20,
		}), "utf8");
		const config = loadSimpleHandoffConfig(directory);
		assert.equal(config.automaticSessionHandoff, true);
		assert.equal(config.automaticSessionHandoffPercent, 49);
		assert.equal(config.readinessRetrySeconds, 45);
		assert.equal(config.writerRetryLimit, 5);
		assert.equal(config.writerRetryDelaySeconds, 20);
	});
});

test("rejects unknown settings and invalid configured limits", async () => {
	await withAgentDirectory(async (directory) => {
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ extra: true }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /unknown setting/);

		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			kvWarningPercent: 90,
			selfHandoffPercent: 80,
		}), "utf8");
		assert.throws(() => validateThresholds({
			warningThreshold: loadSimpleHandoffConfig(directory).kvWarningPercent,
			criticalThreshold: loadSimpleHandoffConfig(directory).selfHandoffPercent,
		}), /must satisfy/);

		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ kvWarningPercent: true }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /finite JSON number/);
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ automaticSessionHandoff: "yes" }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /must be true or false/);
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ automaticSessionHandoffPercent: "60" }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /finite JSON number/);
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ automaticSessionHandoffPercent: 101 }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /between 0 and 100/);
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ readinessRetrySeconds: 0 }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /integer between 1 and 300/);
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ readinessRetrySeconds: 1.5 }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /integer between 1 and 300/);
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ writerRetryLimit: 11 }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /writerRetryLimit must be an integer between 0 and 10/);
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({ writerRetryDelaySeconds: 0 }), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /writerRetryDelaySeconds must be an integer between 1 and 300/);
	});
});

test("saves a complete configuration atomically", async () => {
	await withAgentDirectory(async (directory) => {
		const config = {
			kvWarningPercent: 70,
			selfHandoffPercent: 90,
			automaticSessionHandoff: true,
			automaticSessionHandoffPercent: 60,
			readinessRetrySeconds: 45,
			writerRetryLimit: 3,
			writerRetryDelaySeconds: 30,
		};
		await saveSimpleHandoffConfig(config, directory);
		assert.deepEqual(loadSimpleHandoffConfig(directory), config);
	});
});
