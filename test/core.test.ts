import assert from "node:assert/strict";
import test from "node:test";
import {
	buildContinuationPrompt,
	buildHandoffCreationPrompt,
	formatWarning,
	handoffPath,
	makeHandoffToken,
	validateThresholds,
	warningLevel,
} from "../extensions/pi-simple-handoff/core.ts";

test("does not warn below 60 percent", () => {
	assert.equal(warningLevel(null, false), undefined);
	assert.equal(warningLevel(59.99, false), undefined);
});

test("warns once from 60 percent", () => {
	assert.equal(warningLevel(60, false), "warning");
	assert.equal(warningLevel(79.99, false), "warning");
	assert.equal(warningLevel(60, true), undefined);
	assert.equal(warningLevel(79.99, true), undefined);
});

test("warns hard on every settled turn from 80 percent", () => {
	assert.equal(warningLevel(80, false), "error");
	assert.equal(warningLevel(80, true), "error");
	assert.equal(warningLevel(100, true), "error");
});

test("supports a configurable handoff window", () => {
	const thresholds = validateThresholds({ warningThreshold: 50, criticalThreshold: 75 });
	assert.equal(warningLevel(49.99, false, thresholds), undefined);
	assert.equal(warningLevel(50, false, thresholds), "warning");
	assert.equal(warningLevel(74.99, true, thresholds), undefined);
	assert.equal(warningLevel(75, true, thresholds), "error");
	assert.throws(
		() => validateThresholds({ warningThreshold: 80, criticalThreshold: 60 }),
		/warningThreshold < criticalThreshold/,
	);
});

test("formats soft and hard warnings differently", () => {
	assert.equal(formatWarning(60, "warning"), "Your KV context is at 60%. Consider running /handoff.");
	assert.equal(formatWarning(80.9, "error"), "CRITICAL: Your KV context is at 80%. Run /handoff now.");
});

test("builds one handoff path", () => {
	assert.equal(handoffPath("/work", "session-1"), "/work/.pi/session-handoff/session-1/session-handoff.md");
});

test("creation prompt is forward-focused, English, and independent of project context files", () => {
	const sessionPath = handoffPath("/work", "session-1");
	const sourceSessionPath = "/sessions/source.jsonl";
	const prompt = buildHandoffCreationPrompt(sessionPath, sourceSessionPath);
	assert.match(prompt, /🟡 \*\*HANDOFF STARTED\*\*/);
	assert.match(prompt, /exactly one focused context handoff/);
	assert.match(prompt, /entire handoff directly in English/);
	assert.match(prompt, /## Next Steps/);
	assert.match(prompt, /## Behavior Changes/);
	assert.match(prompt, /## Precision Anchors/);
	assert.match(prompt, /## Cold Context/);
	assert.match(prompt, /must not be read automatically/);
	assert.ok(prompt.includes(sessionPath));
	assert.ok(prompt.includes(sourceSessionPath));
	assert.doesNotMatch(prompt, /Aktualisiere|Lösche|Verhaltensänderungen/);
});

test("restart prompt reads, deletes exactly the handoff, and continues", () => {
	const sessionPath = handoffPath("/work", "session-1");
	const prompt = buildContinuationPrompt(sessionPath);
	assert.match(prompt, /🟢 \*\*NEW SESSION STARTED\*\*/);
	assert.equal(prompt.split(sessionPath).length - 1, 2);
	assert.match(prompt, /delete exactly this file/);
	assert.match(prompt, /Immediately continue.*“Next Steps\.”/);
	assert.match(prompt, /Cold Context.*only if/);
	assert.match(prompt, /Do not perform any other session scans/);
});

test("creates filesystem-safe handoff tokens", () => {
	assert.equal(makeHandoffToken("ABC_def/session", 36), "abc-def-session-10");
});
