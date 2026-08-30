import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	DEFAULT_CONFIG,
	loadHandoffThresholds,
	loadSimpleHandoffConfig,
	piAgentDirectory,
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
		assert.deepEqual(loadHandoffThresholds(directory), {
			warningThreshold: 70,
			criticalThreshold: 90,
		});
	});
});

test("loads KV warning and self-handoff limits from the Pi extension settings file", async () => {
	await withAgentDirectory(async (directory) => {
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			kvWarningPercent: 55,
			selfHandoffPercent: 75,
		}), "utf8");
		const thresholds = loadHandoffThresholds(directory);
		assert.deepEqual(thresholds, { warningThreshold: 55, criticalThreshold: 75 });
		assert.deepEqual(validateThresholds(thresholds), thresholds);
	});
});

test("loads separate automatic handoff enablement and percentage settings", async () => {
	await withAgentDirectory(async (directory) => {
		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			automaticSessionHandoff: true,
			automaticSessionHandoffPercent: 49,
		}), "utf8");
		assert.equal(loadSimpleHandoffConfig(directory).automaticSessionHandoff, true);
		assert.equal(loadSimpleHandoffConfig(directory).automaticSessionHandoffPercent, 49);
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
		assert.throws(() => validateThresholds(loadHandoffThresholds(directory)), /must satisfy/);

		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			kvWarningPercent: true,
		}), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /finite JSON number/);

		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			automaticSessionHandoff: "yes",
		}), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /must be true or false/);

		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			automaticSessionHandoffPercent: "60",
		}), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /finite JSON number/);

		await writeFile(simpleHandoffConfigPath(directory), JSON.stringify({
			automaticSessionHandoffPercent: 101,
		}), "utf8");
		assert.throws(() => loadSimpleHandoffConfig(directory), /between 0 and 100/);
	});
});

test("saves a complete configuration atomically", async () => {
	await withAgentDirectory(async (directory) => {
		const config = {
			kvWarningPercent: 70,
			selfHandoffPercent: 90,
			automaticSessionHandoff: true,
			automaticSessionHandoffPercent: 60,
		};
		await saveSimpleHandoffConfig(config, directory);
		assert.deepEqual(loadSimpleHandoffConfig(directory), config);
	});
});

test("respects PI_CODING_AGENT_DIR", () => {
	assert.equal(
		piAgentDirectory({ PI_CODING_AGENT_DIR: "/tmp/custom-pi-agent" }),
		"/tmp/custom-pi-agent",
	);
});
