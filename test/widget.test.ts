import assert from "node:assert/strict";
import test from "node:test";
import { handoffWidget } from "../extensions/pi-simple-handoff/widget.ts";
import type { ExtensionState } from "../extensions/pi-simple-handoff/state.ts";

const base: ExtensionState = {
	warnedAtWarning: false,
	automaticHandoffSuppressed: false,
	deferredPrompts: [],
	nextDeferredSequence: 1,
};

test("running widget reports seven English stages in warning color", () => {
	const cases: Array<[ExtensionState, RegExp, Record<string, unknown>?]> = [
		[{ ...base, handoff: { status: "pending", goId: "a", waitId: "b", retryAt: 30_000 } }, /Preparing readiness check \(1\/7\) · Continue in 30s$/, {}],
		[{ ...base, handoff: { status: "pending", goId: "a", waitId: "b" } }, /Checking readiness \(2\/7\) · Readiness check running$/, { readinessCheckActive: true }],
		[{ ...base, handoff: { status: "writing", token: "token", submitId: "id", attempt: 1, totalAttempts: 1 } }, /Writing focused context \(3\/7\) · Creating handoff \(attempt 1\)$/],
		[{ ...base, handoff: { status: "ready", token: "token" } }, /Handoff validated \(4\/7\) · Opening fresh session$/],
		[{ ...base, handoff: { status: "transitioning", token: "token" } }, /Opening fresh session \(5\/7\) · Switching session$/],
		[{ ...base, deliveryPending: "replacement", deferredPrompts: [{ sequence: 1, text: "next" }], nextDeferredSequence: 2 }, /Deliver deferred prompts \(6\/7\) · Delivering FIFO turns · Deferred prompts: 1$/],
		[{ ...base, cleanupToken: "token", banner: "finished" }, /Finalizing fresh session \(7\/7\) · Cleaning private artifact$/],
	];

	for (const [state, expected, progress] of cases) {
		const widget = handoffWidget(state, { readinessCheckActive: false, continueInSeconds: 30, ...progress });
		assert.equal(widget?.color, "warning");
		assert.match(widget?.text ?? "", /^Session Handoff Running · /);
		assert.match(widget?.text ?? "", expected);
	}
});

test("writer retry countdown, exhaustion, and delivery recovery stay actionable", () => {
	const waiting = handoffWidget({ ...base, handoff: { status: "writing", token: "token", submitId: "id", attempt: 2, totalAttempts: 2, retryAt: 10_000 } }, {
		readinessCheckActive: false,
		writerRetryInSeconds: 10,
	});
	assert.match(waiting?.text ?? "", /Writer retry in 10s/);
	const paused = handoffWidget({ ...base, handoff: { status: "writing", token: "token", submitId: "id", attempt: 4, totalAttempts: 4, paused: true } });
	assert.match(paused?.text ?? "", /run \/sh retry or \/sh cancel/);
	const deliveryPaused = handoffWidget({
		...base,
		deliveryPending: "replacement",
		deliveryPaused: true,
		deferredPrompts: [{ sequence: 1, text: "recover me" }],
		nextDeferredSequence: 2,
	});
	assert.match(deliveryPaused?.text ?? "", /Delivery paused; run \/sh recover/);
});

test("finished widget is green and complete", () => {
	assert.deepEqual(handoffWidget({ ...base, banner: "finished" }), {
		color: "success",
		text: "Session Handoff Finished · Complete (7/7)",
	});
});
