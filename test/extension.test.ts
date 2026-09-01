import assert from "node:assert/strict";
import test from "node:test";
import { createHarness } from "./extension-harness.ts";

test("simple_handoff status and start use the same real flow as /sh", async () => {
	const harness = createHarness({ contextPercent: 60 });
	await harness.start();
	const status = await harness.callTool("simple_handoff", { action: "status" });
	assert.match(status.content[0].text, /60\.0%/);
	assert.equal(typeof status.details.automaticSessionHandoff, "boolean");
	const start = await harness.callTool("simple_handoff", { action: "start" });
	assert.equal(start.details.queued, true);
	assert.equal(harness.latestState().handoff.status, "pending");
	assert.match(harness.sent[0]?.content ?? "", /HANDOFF READINESS CHECK/);
	assert.doesNotMatch(harness.sent[0]?.content ?? "", /^\/sh$/);
	assert.match(harness.notifications.at(-1)?.message ?? "", /waiting for current agent and subagent work to settle/);
});

test("automatic handoff follows explicit enablement and minimum threshold", async () => {
	const disabled = createHarness({ contextPercent: 80 });
	await disabled.start();
	await disabled.settle();
	assert.equal(disabled.sent.length, 0);

	const tooLow = createHarness({
		contextPercent: 80,
		config: { automaticSessionHandoff: true, automaticSessionHandoffPercent: 49 },
	});
	await tooLow.start();
	await tooLow.settle();
	assert.equal(tooLow.sent.length, 0);
	assert.match(tooLow.notifications[0]?.message ?? "", /49% is too low/);

	const enabled = createHarness({
		contextPercent: 60,
		config: { automaticSessionHandoff: true, automaticSessionHandoffPercent: 60 },
	});
	await enabled.start();
	await enabled.settle();
	assert.equal(enabled.latestState().handoff.status, "pending");
	assert.match(enabled.sent[0]?.content ?? "", /HANDOFF READINESS CHECK/);
	assert.match(enabled.widgets.get("pi-simple-handoff")?.[0] ?? "", /^Session Handoff Running · Preparing readiness check \(1\/7\) · Continue in 30s$/);
	assert.equal(enabled.widgetColors.get("pi-simple-handoff"), "warning");
});

test("writing blocks unrelated tools and compaction", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	await harness.start();
	await harness.invoke("sh");
	const ids = harness.latestState().handoff;
	await harness.dispatchNext();
	await harness.finishAgent(`${ids.goId}: GO`);
	await harness.dispatchNext();
	assert.deepEqual(await harness.beforeCompact(), { cancel: true });
	assert.deepEqual(await harness.toolCall("bash"), {
		block: true,
		reason: "Session Handoff is running; only submit_session_handoff is allowed.",
		terminate: true,
	});
	assert.equal(await harness.toolCall("submit_session_handoff"), undefined);
});
