import assert from "node:assert/strict";
import test from "node:test";
import {
	isReadinessRetryPreset,
	READINESS_RETRY_SECOND_OPTIONS,
	registerConfigCommand,
	validateConfigDraft,
} from "../extensions/pi-simple-handoff/config-ui.ts";
import { DEFAULT_CONFIG } from "../extensions/pi-simple-handoff/config.ts";

function commandHarness(customResult: boolean, mode = "tui") {
	let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
	const notifications: Array<{ message: string; level: string }> = [];
	let reloads = 0;
	const pi = {
		registerCommand(_name: string, definition: { handler: typeof handler }) { handler = definition.handler; },
	};
	const ctx = {
		mode,
		ui: {
			custom: async () => customResult,
			notify: (message: string, level: string) => notifications.push({ message, level }),
		},
		reload: async () => { reloads += 1; },
	};
	return {
		pi,
		ctx,
		notifications,
		invoke: async () => { await handler!("", ctx); },
		get reloads() { return reloads; },
	};
}

test("/shconfig preserves configured 0 and under-50 automatic semantics on save and reload", async () => {
	for (const percent of [0, 49]) {
		const harness = commandHarness(true);
		let saved: typeof DEFAULT_CONFIG | undefined;
		registerConfigCommand(harness.pi as never, { ...DEFAULT_CONFIG, automaticSessionHandoffPercent: percent }, async (value) => {
			saved = value;
		});
		await harness.invoke();
		assert.equal(saved?.automaticSessionHandoffPercent, percent);
		assert.equal(harness.reloads, 1);
		assert.match(harness.notifications.at(-1)?.message ?? "", /saved/);
	}
});

test("/shconfig cancel neither saves nor reloads", async () => {
	const harness = commandHarness(false);
	let saves = 0;
	registerConfigCommand(harness.pi as never, DEFAULT_CONFIG, async () => { saves += 1; });
	await harness.invoke();
	assert.equal(saves, 0);
	assert.equal(harness.reloads, 0);
});

test("/shconfig rejects non-TUI mode visibly", async () => {
	const harness = commandHarness(false, "json");
	registerConfigCommand(harness.pi as never, DEFAULT_CONFIG, async () => undefined);
	await harness.invoke();
	assert.match(harness.notifications[0]?.message ?? "", /requires TUI mode/);
	assert.equal(harness.notifications[0]?.level, "error");
});

test("readiness retry selector offers the fixed published choices with 30 seconds as the default", () => {
	assert.deepEqual(READINESS_RETRY_SECOND_OPTIONS, [15, 30, 60, 120, 180]);
	assert.equal(DEFAULT_CONFIG.readinessRetrySeconds, 30);
	assert.equal(isReadinessRetryPreset(30), true);
	assert.equal(isReadinessRetryPreset(45), false);
});

test("configuration validation keeps warning order and validates both retry policies", () => {
	validateConfigDraft({ ...DEFAULT_CONFIG, automaticSessionHandoffPercent: 0 });
	validateConfigDraft({ ...DEFAULT_CONFIG, automaticSessionHandoffPercent: 49, readinessRetrySeconds: 45, writerRetryLimit: 0 });
	assert.equal(DEFAULT_CONFIG.writerRetryLimit, 3);
	assert.equal(DEFAULT_CONFIG.writerRetryDelaySeconds, 30);
	assert.throws(() => validateConfigDraft({ ...DEFAULT_CONFIG, kvWarningPercent: 90, selfHandoffPercent: 80 }), /warningThreshold/);
	assert.throws(() => validateConfigDraft({ ...DEFAULT_CONFIG, automaticSessionHandoffPercent: 101 }), /between 0 and 100/);
	assert.throws(() => validateConfigDraft({ ...DEFAULT_CONFIG, readinessRetrySeconds: 0 }), /between 1 and 300 seconds/);
	assert.throws(() => validateConfigDraft({ ...DEFAULT_CONFIG, readinessRetrySeconds: 1.5 }), /integer between 1 and 300 seconds/);
	assert.throws(() => validateConfigDraft({ ...DEFAULT_CONFIG, writerRetryLimit: 11 }), /between 0 and 10/);
	assert.throws(() => validateConfigDraft({ ...DEFAULT_CONFIG, writerRetryDelaySeconds: 301 }), /between 1 and 300 seconds/);
});
