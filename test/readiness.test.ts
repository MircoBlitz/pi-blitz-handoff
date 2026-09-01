import assert from "node:assert/strict";
import test from "node:test";
import { buildReadinessPrompt, parseReadinessAnswer } from "../extensions/pi-simple-handoff/readiness.ts";
import { createHarness } from "./extension-harness.ts";

async function startReadiness(harness: ReturnType<typeof createHarness>) {
	await harness.start();
	await harness.invoke("sh");
	const state = harness.latestState().handoff as { status: string; goId: string; waitId: string };
	assert.equal(state.status, "pending");
	assert.notEqual(state.goId, state.waitId);
	assert.match(harness.widgets.get("pi-simple-handoff")?.[0] ?? "", /^Session Handoff Running · Preparing readiness check \(1\/7\) · Continue in 30s$/);
	assert.equal(harness.widgetColors.get("pi-simple-handoff"), "warning");
	assert.match(harness.notifications.at(-1)?.message ?? "", /waiting for current agent and subagent work to settle/);
	assert.match(harness.sent[0]?.content ?? "", /inspect all session-owned asynchronous and background work, including the subagent fleet/);
	assert.ok(harness.activeTools.includes("mcp"), "readiness keeps the existing status-capable tool set available");
	assert.ok(harness.activeTools.includes("submit_session_handoff"));
	await harness.dispatchNext();
	assert.equal(harness.latestState().handoff.status, "pending");
	return state;
}

test("readiness countdown uses the configured retry time and advances in the widget", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
	const harness = createHarness({ config: { readinessRetrySeconds: 45 } });
	await harness.start();
	await harness.invoke("sh");
	assert.match(harness.widgets.get("pi-simple-handoff")?.[0] ?? "", /Continue in 45s$/);
	t.mock.timers.tick(1_000);
	assert.match(harness.widgets.get("pi-simple-handoff")?.[0] ?? "", /Continue in 44s$/);
});

test("readiness accepts only the exact current GO and NOT YET shibboleths", () => {
	const ids = { goId: "aaaaaaaa-aaaa-aaaa-aaaa", waitId: "bbbbbbbb-bbbb-bbbb-bbbb" };
	assert.equal(parseReadinessAnswer(`${ids.goId}: GO`, ids), "go");
	assert.equal(parseReadinessAnswer(`${ids.waitId}: NOT YET`, ids), "wait");
	for (const text of [
		`${ids.goId}: NOT YET`,
		`${ids.waitId}: GO`,
		`${ids.goId}: GO\n${ids.waitId}: NOT YET`,
		` ${ids.goId}: GO`,
		`${ids.goId}: GO `,
		"GO",
		"",
	]) assert.equal(parseReadinessAnswer(text, ids), "invalid", text);
	assert.match(buildReadinessPrompt(ids), new RegExp(`${ids.goId}: GO`));
	assert.match(buildReadinessPrompt(ids), new RegExp(`${ids.waitId}: NOT YET`));
});

test("exact GO starts the extension-owned writer", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const ids = await startReadiness(harness);
	await harness.finishAgent(`${ids.goId}: GO`);
	assert.equal(harness.latestState().handoff.status, "writing");
	assert.ok(harness.latestState().handoff.submitId);
	assert.equal(harness.widgets.get("pi-simple-handoff")?.[0], "Session Handoff Running · Writing focused context (3/7) · Creating handoff (attempt 1)");
	assert.equal(harness.widgetColors.get("pi-simple-handoff"), "warning");
	assert.deepEqual(harness.activeTools, ["submit_session_handoff"], "writer exposes only the direct submission tool");
	assert.match(harness.sent[0]!.content, /submit_session_handoff/);
	assert.doesNotMatch(harness.sent[0]!.content, /session-handoff\.md|Write the handoff to/);
});

test("NOT YET and malformed answers rotate IDs and retry after 30 seconds", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const harness = createHarness();
	t.after(harness.cleanup);
	const first = await startReadiness(harness);
	await harness.finishAgent(`${first.waitId}: NOT YET`);
	const second = harness.latestState().handoff;
	assert.equal(second.status, "pending");
	assert.equal(second.goId, first.goId, "IDs rotate only when the delayed poll is dispatched");
	assert.match(harness.notifications.at(-1)?.message ?? "", /NOT YET/);
	assert.deepEqual(await harness.input("continue after handoff"), { action: "handled" });
	assert.deepEqual(harness.latestState().deferredPrompts.map((prompt: { text: string }) => prompt.text), ["continue after handoff"]);

	t.mock.timers.tick(30_000);
	assert.equal(harness.sent.length, 1);
	assert.notEqual(harness.latestState().handoff.goId, first.goId);
	await harness.dispatchNext();
	const active = harness.latestState().handoff;
	await harness.finishAgent(`${active.goId}: NOT YET`);
	assert.equal(harness.latestState().handoff.status, "pending");
	assert.match(harness.notifications.at(-1)?.message ?? "", /Invalid handoff readiness response/);
});

test("stale, crossed, duplicated, missing, and extra-text answers never start writing", async (t) => {
	for (const answer of ["crossed", "duplicated", "missing", "extra"] as const) {
		const harness = createHarness();
		t.after(harness.cleanup);
		const ids = await startReadiness(harness);
		const text = answer === "crossed" ? `${ids.waitId}: GO`
			: answer === "duplicated" ? `${ids.goId}: GO\n${ids.goId}: GO`
			: answer === "missing" ? ""
			: `${ids.goId}: GO\nready`;
		await harness.finishAgent(text);
		assert.equal(harness.latestState().handoff.status, "pending", answer);
	}
});

test("hard cancel invalidates an active readiness response and suppresses automatic retrigger", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const harness = createHarness({
		contextPercent: 80,
		config: { automaticSessionHandoff: true, automaticSessionHandoffPercent: 60 },
	});
	t.after(harness.cleanup);
	const ids = await startReadiness(harness);
	await harness.invoke("sh", "cancel");
	assert.equal(harness.latestState().handoff, undefined);
	assert.equal(harness.latestState().automaticHandoffSuppressed, true);
	assert.equal(harness.widgets.get("pi-simple-handoff")?.[0], "Session Handoff Cancelled");
	assert.equal(harness.abortCount, 0, "cancelling pending readiness does not abort Pi-owned source work");
	await harness.finishAgent(`${ids.goId}: GO`);
	assert.equal(harness.latestState().handoff, undefined);
	const filtered = await harness.filterContext([
		{ role: "user", content: buildReadinessPrompt(ids) },
		{ role: "user", content: "ordinary work" },
	]) as { messages: unknown[] };
	assert.equal(filtered.messages.length, 1, "cancel removes stale readiness instructions from later model context");
	t.mock.timers.tick(30_000);
	await harness.settle();
	assert.equal(harness.latestState().handoff, undefined);
	await harness.input("next normal turn");
	assert.equal(harness.widgets.get("pi-simple-handoff"), undefined);
});

test("a settled readiness retry waits for both its delay and Pi idleness", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const harness = createHarness();
	const ids = await startReadiness(harness);
	await harness.finishAgent(`${ids.waitId}: NOT YET`);
	harness.setIdle(false);
	t.mock.timers.tick(30_000);
	assert.equal(harness.sent.length, 0);
	harness.setIdle(true);
	t.mock.timers.tick(250);
	assert.equal(harness.sent.length, 1);
});

test("a readiness prompt-start failure leaves a deterministic retry and still defers later input", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const harness = createHarness({ sendFailure: true });
	await harness.start();
	await harness.invoke("sh");
	const first = harness.latestState().handoff;
	assert.equal(first.status, "pending");
	assert.equal(harness.sent.length, 0);
	assert.deepEqual(await harness.input("later work"), { action: "handled" });
	assert.equal(harness.latestState().deferredPrompts[0].text, "later work");
	harness.setSendFailure(false);
	t.mock.timers.tick(30_000);
	assert.equal(harness.sent.length, 1);
	assert.notEqual(harness.latestState().handoff.goId, first.goId);
});
