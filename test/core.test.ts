import assert from "node:assert/strict";
import test from "node:test";
import {
	buildContinuationPrompt,
	buildHandoffCreationPrompt,
	formatWarning,
	handoffPath,
	MAX_HANDOFF_BYTES,
	isHandoffTokenForSession,
	isValidHandoffContent,
	makeHandoffToken,
	validateThresholds,
	warningLevel,
} from "../extensions/pi-simple-handoff/core.ts";

function sampleHandoff(): string {
	return `# Context Handoff

## Goal
Finish the release review.

## Current State
The package is prepared.

## Decisions and Constraints
Do not publish yet.

## Next Steps
Run integration tests and fix concrete findings.

## Open Questions and Blockers
None.

## Working Set
- package.json

## Behavior Changes
None.

## Precision Anchors
None.

## Cold Context
No transcript reference is available.`;
}

test("does not warn below 70 percent", () => {
	assert.equal(warningLevel(null, false), undefined);
	assert.equal(warningLevel(69.99, false), undefined);
});

test("warns once from 70 percent", () => {
	assert.equal(warningLevel(70, false), "warning");
	assert.equal(warningLevel(89.99, false), "warning");
	assert.equal(warningLevel(70, true), undefined);
	assert.equal(warningLevel(89.99, true), undefined);
});

test("warns hard on every settled turn from 90 percent", () => {
	assert.equal(warningLevel(90, false), "error");
	assert.equal(warningLevel(90, true), "error");
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
	assert.throws(
		() => validateThresholds({ warningThreshold: Number.NaN, criticalThreshold: 80 }),
		/thresholds must satisfy/,
	);
});

test("formats soft and hard warnings differently", () => {
	assert.equal(
		formatWarning(70, "warning"),
		"Your KV context is at 70%. Consider running /sh or asking for a handoff.",
	);
	assert.equal(
		formatWarning(90.9, "error"),
		"CRITICAL: Your KV context is at 90%. Run /sh now or ask for a handoff.",
	);
});

test("builds a private temporary handoff path from a validated token", () => {
	assert.equal(
		handoffPath("session-1", "/tmp"),
		"/tmp/pi-simple-handoff-session-1/session-handoff.md",
	);
	assert.throws(() => handoffPath("../../escape", "/tmp"), /Invalid pi-simple-handoff token/);
});

test("creation prompt is forward-focused, English, and independent of project context files", () => {
	const submitId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
	const sourceSessionPath = "/sessions/source.jsonl";
	const prompt = buildHandoffCreationPrompt(submitId, sourceSessionPath);
	assert.match(prompt, /🟡 \*\*HANDOFF STARTED\*\*/);
	assert.match(prompt, /exactly one focused context handoff/);
	assert.match(prompt, /entire handoff directly in English/);
	assert.match(prompt, /## Next Steps/);
	assert.match(prompt, /## Behavior Changes/);
	assert.match(prompt, /## Precision Anchors/);
	assert.match(prompt, /## Cold Context/);
	assert.match(prompt, /must not be read automatically/);
	assert.ok(prompt.includes(submitId));
	assert.ok(prompt.includes(sourceSessionPath));
	assert.match(prompt, /Call the `submit_session_handoff` tool directly/);
	assert.match(prompt, /Do not route the submission through MCP, another tool, a gateway, or delegation/);
	assert.match(prompt, /Do not create, read, serve, or delete any handoff file/);
	assert.match(prompt, /first non-whitespace line must be `# Context Handoff`/);
	assert.match(prompt, /every heading below exactly once and in exactly this order/);
	assert.match(prompt, /Do not add any other `#` or `##` headings/);
	assert.match(prompt, /`###` and deeper headings are permitted inside sections/);
	assert.match(prompt, /Every section must contain substantive text/);
	assert.match(prompt, /write `None\.`/);
	assert.match(prompt, /Do not add text before the title/);
	assert.doesNotMatch(prompt, /session-handoff\.md|Write the handoff to/);
});

test("accepts the exact handoff template and None. as substantive section content", () => {
	assert.equal(isValidHandoffContent(sampleHandoff()), true);
	assert.equal(
		isValidHandoffContent(sampleHandoff().replace("Finish the release review.", "None.")),
		true,
	);
});

test("requires the title first and forbids text in the root section", () => {
	assert.equal(isValidHandoffContent(`Preface\n\n${sampleHandoff()}`), false);
	assert.equal(
		isValidHandoffContent(sampleHandoff().replace("# Context Handoff\n\n", "# Context Handoff\n\nPreface\n\n")),
		false,
	);
});

test("requires every structural heading exactly once and in exact order", () => {
	assert.equal(
		isValidHandoffContent(sampleHandoff().replace("## Current State", "## Goal")),
		false,
	);
	assert.equal(
		isValidHandoffContent(
			sampleHandoff().replace(
				"## Goal\nFinish the release review.\n\n## Current State\nThe package is prepared.",
				"## Current State\nThe package is prepared.\n\n## Goal\nFinish the release review.",
			),
		),
		false,
	);
	assert.equal(isValidHandoffContent(sampleHandoff().replace("## Goal", "## Goalkeeper")), false);
});

test("rejects every additional H1 or H2 heading, including CommonMark indentation", () => {
	for (const heading of ["## Extra", "# Extra", "   ## Extra", "##", "   ##", "#", "   #"]) {
		assert.equal(
			isValidHandoffContent(sampleHandoff().replace("The package is prepared.", `The package is prepared.\n\n${heading}\nNo.`)),
			false,
		);
	}
});

test("permits H3 and deeper headings as section content", () => {
	assert.equal(
		isValidHandoffContent(sampleHandoff().replace("The package is prepared.", "The package is prepared.\n\n### Detail\nStill section content.")),
		true,
	);
});

test("requires every handoff section to be nonempty", () => {
	for (const content of [
		sampleHandoff().replace("Finish the release review.", ""),
		sampleHandoff().replace("None.\n\n## Working Set", "\n## Working Set"),
		sampleHandoff().replace("No transcript reference is available.", ""),
	]) {
		assert.equal(isValidHandoffContent(content), false);
	}
	assert.equal(isValidHandoffContent("# Context Handoff\n\n## Goal\n"), false);
});

test("retains null-byte, envelope, and byte-size protections", () => {
	assert.equal(isValidHandoffContent(sampleHandoff().replace("## Goal", "## Goal\0")), false);
	assert.equal(isValidHandoffContent(`--- BEGIN CONTEXT HANDOFF ---\n${sampleHandoff()}`), false);
	assert.equal(isValidHandoffContent(`${sampleHandoff()}\n--- END CONTEXT HANDOFF ---`), false);
	assert.equal(isValidHandoffContent(`${sampleHandoff()}\n${"x".repeat(MAX_HANDOFF_BYTES)}`), false);
});

test("continuation embeds the captured handoff without delegating file deletion", () => {
	const handoff = sampleHandoff();
	const prompt = buildContinuationPrompt(handoff);
	assert.match(prompt, /🟢 \*\*NEW SESSION STARTED\*\*/);
	assert.match(prompt, /continuation context, not a new request or new permission/);
	assert.doesNotMatch(prompt, /Continue the already requested work/);
	assert.match(prompt, /Cold Context.*only if/);
	assert.ok(prompt.includes(handoff));
	assert.match(prompt, /deterministic code owns the temporary transport file and cleanup/);
	assert.doesNotMatch(prompt, /attempt to remove|delete exactly|session-handoff\.md/);
});

test("creates filesystem-safe tokens bound to their source session", () => {
	const token = makeHandoffToken("ABC_def/session", 36, "01234567-89ab-cdef");
	assert.equal(token, "abc-def-session-10-0123456789abcdef");
	assert.equal(isHandoffTokenForSession(token, "ABC_def/session"), true);
	assert.equal(isHandoffTokenForSession(token, "other-session"), false);
	assert.equal(isHandoffTokenForSession("../../escape", "ABC_def/session"), false);
});
