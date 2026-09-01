import assert from "node:assert/strict";
import { access, unlink } from "node:fs/promises";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { handoffDirectory, handoffPath, makeHandoffToken } from "../extensions/pi-simple-handoff/core.ts";
import { createPrivateHandoffDirectory, writeValidatedHandoff } from "../extensions/pi-simple-handoff/filesystem.ts";
import { STATE_ENTRY, restoreState } from "../extensions/pi-simple-handoff/state.ts";
import { createHarness, validHandoff } from "./extension-harness.ts";

async function reachWriting(harness: ReturnType<typeof createHarness>) {
	await harness.start();
	await harness.invoke("sh");
	const readiness = harness.latestState().handoff;
	await harness.dispatchNext();
	await harness.finishAgent(`${readiness.goId}: GO`);
	const writing = harness.latestState().handoff;
	await harness.dispatchNext();
	return writing as { status: "writing"; token: string; submitId: string; attempt: number; totalAttempts: number };
}

async function waitFor(check: () => boolean): Promise<void> {
	for (let index = 0; index < 50 && !check(); index += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	assert.equal(check(), true, "timed out waiting for asynchronous retry work");
}

async function submitAndOpen(harness: ReturnType<typeof createHarness>) {
	const writing = await reachWriting(harness);
	const result = await harness.callTool("submit_session_handoff", {
		id: writing.submitId,
		content: validHandoff(),
	});
	assert.equal(result.details.accepted, true);
	await harness.finishAgent("");
	assert.equal(harness.latestState().handoff.status, "ready");
	await harness.dispatchNext();
	return writing;
}

async function runAcceptedDelivery(harness: ReturnType<typeof createHarness>): Promise<void> {
	for (let step = 0; step < 20 && harness.latestState().deliveryPending; step += 1) {
		const next = harness.sent[0];
		assert.ok(next, "delivery work must remain scheduled while deliveryPending is durable");
		await harness.dispatchNext();
		if (!(typeof next.content === "string" && next.content.startsWith("/"))) await harness.finishAgent("");
	}
	assert.equal(harness.latestState().deliveryPending, undefined);
}

async function assertMissing(path: string) {
	await assert.rejects(access(path), (error: unknown) =>
		typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
}

test("GO cannot activate the writer before agent_settled across retry, compaction, or queued low-level runs", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	await harness.start();
	await harness.invoke("sh");
	const readiness = harness.latestState().handoff;
	await harness.dispatchNext();
	await harness.endAgent(`${readiness.goId}: GO`);
	assert.equal(harness.latestState().handoff.status, "pending");
	assert.notDeepEqual(harness.activeTools, ["submit_session_handoff"]);
	assert.equal(await harness.beforeCompact(), undefined, "Pi compaction remains available before activation");
	await harness.endAgent("queued source-session continuation finished");
	assert.equal(harness.latestState().handoff.status, "pending");
	await harness.settle();
	assert.equal(harness.latestState().handoff.status, "writing");
	assert.deepEqual(harness.activeTools, ["submit_session_handoff"]);
});

test("submission shibboleth makes the extension own create, write, serve, and delete", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await assert.rejects(
		harness.callTool("submit_session_handoff", { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", content: validHandoff() }),
		/Stale or unknown/,
	);
	await assertMissing(handoffPath(writing.token));

	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	assert.ok(harness.activeTools.includes("mcp"), "successful submission restores the exact pre-writer tools");
	assert.deepEqual(harness.activeTools, harness.activeToolHistory[0]);
	assert.equal(await (await import("node:fs/promises")).readFile(handoffPath(writing.token), "utf8"), validHandoff());
	await harness.finishAgent("");
	await harness.dispatchNext();

	const replacement = harness.replacement!;
	assert.ok(replacement.messages.some((message) => JSON.stringify(message).includes("NEW SESSION STARTED")));
	await runAcceptedDelivery(replacement);
	assert.equal(replacement.widgets.get("pi-simple-handoff")?.[0], "Session Handoff Finished · Complete (7/7)");
	assert.equal(replacement.widgetColors.get("pi-simple-handoff"), "success");
	assert.equal(replacement.sentHistory.some((message) => message.content === "Continue the handed-off work now."), true);
	await assertMissing(handoffDirectory(writing.token));
	assert.equal(replacement.latestState().cleanupToken, undefined);

	await replacement.input("ordinary next turn");
	assert.equal(replacement.widgets.get("pi-simple-handoff"), undefined);
});

test("writer failure schedules its retry only after the writer agent settles", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	await reachWriting(harness);
	assert.deepEqual(harness.activeTools, ["submit_session_handoff"]);
	await harness.endAgent("");
	assert.deepEqual(harness.activeTools, ["submit_session_handoff"]);
	assert.equal(harness.latestState().handoff.retryAt, undefined);
	await harness.settle();
	assert.deepEqual(harness.activeTools, harness.activeToolHistory[0]);
	assert.equal(harness.latestState().handoff.status, "writing");
	assert.match(harness.notifications.at(-1)?.message ?? "", /ended without an accepted submission/);
	assert.equal(harness.latestState().handoff.attempt, 1);
	assert.ok(harness.latestState().handoff.retryAt);
});

test("malformed content never creates the extension-owned file", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await assert.rejects(
		harness.callTool("submit_session_handoff", { id: writing.submitId, content: "# Context Handoff" }),
		/incomplete, malformed, or too large/,
	);
	await assertMissing(handoffPath(writing.token));
	assert.equal(harness.latestState().handoff.status, "writing");
});

test("hard cancel during writing removes the artifact and rejects a late submission", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await harness.invoke("sh", "cancel");
	assert.deepEqual(harness.activeTools, harness.activeToolHistory[0], "writer cancellation restores the exact pre-writer tools");
	await assertMissing(handoffDirectory(writing.token));
	await assert.rejects(
		harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() }),
		/Stale or unknown/,
	);
	const filtered = await harness.filterContext([
		{ role: "user", content: `🟡 **HANDOFF STARTED**\nsubmission ${writing.submitId}` },
		{ role: "user", content: "ordinary work" },
	]) as { messages: unknown[] };
	assert.equal(filtered.messages.length, 1, "cancel removes stale writing instructions from later model context");
	assert.equal(harness.widgets.get("pi-simple-handoff")?.[0], "Session Handoff Cancelled");
});

test("restart during pending preserves safe polling and restart during writing preserves delayed attempt accounting", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const pending = createHarness();
	await pending.start();
	await pending.invoke("sh");
	const entries = pending.entries;
	const restoredPending = createHarness({ entries, sessionId: pending.ctx.sessionManager.getSessionId() });
	await restoredPending.start();
	assert.equal(restoredPending.latestState().handoff.status, "pending");
	t.mock.timers.tick(30_000);
	assert.match(restoredPending.sent[0]?.content ?? "", /HANDOFF READINESS CHECK/);

	const writer = createHarness();
	t.after(writer.cleanup);
	const writing = await reachWriting(writer);
	const restoredWriter = createHarness({ entries: writer.entries, sessionId: writer.ctx.sessionManager.getSessionId() });
	t.after(restoredWriter.cleanup);
	await restoredWriter.start();
	assert.equal(restoredWriter.latestState().handoff.status, "writing");
	assert.equal(restoredWriter.latestState().handoff.attempt, 1);
	assert.equal(restoredWriter.sent.length, 0);
	t.mock.timers.tick(30_000);
	await waitFor(() => restoredWriter.latestState().handoff.attempt === 2);
	assert.equal(restoredWriter.latestState().handoff.attempt, 2);
	assert.notEqual(restoredWriter.latestState().handoff.submitId, writing.submitId);
});

test("active widget truncates deferred-prompt status to the terminal width", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	await harness.start();
	await harness.invoke("sh");
	await harness.input("a deferred prompt that makes the already detailed status line longer");
	const lines = harness.renderWidgetAt("pi-simple-handoff", 80) ?? [];
	assert.equal(lines.length, 1);
	assert.ok(lines.every((line) => visibleWidth(line) <= 80));
});

test("activation defers interactive and RPC prompts durably and delivers distinct FIFO turns before any generic continuation", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	assert.deepEqual(await harness.input("first deferred prompt"), { action: "handled" });
	assert.deepEqual(await harness.input("second deferred prompt", "rpc", [{ type: "image", data: "image-data", mimeType: "image/png" }]), { action: "handled" });
	assert.equal(harness.latestState().deferredPrompts.length, 2);
	assert.match(harness.notifications.at(-1)?.message ?? "", /deferred prompts: 2/i);
	const restored = restoreState(harness.entries, harness.ctx.sessionManager.getSessionId());
	assert.deepEqual(restored.deferredPrompts.map((prompt) => prompt.text), ["first deferred prompt", "second deferred prompt"]);

	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	await harness.finishAgent("");
	await harness.dispatchNext();
	const replacement = harness.replacement!;
	assert.ok(replacement.messages.some((message) => JSON.stringify(message).includes("NEW SESSION STARTED")));
	await runAcceptedDelivery(replacement);
	const delivered = replacement.sentHistory.filter((message) => !(typeof message.content === "string" && message.content.startsWith("/")));
	assert.equal(delivered.length, 2);
	assert.equal(delivered[0]?.content, "first deferred prompt");
	assert.deepEqual(delivered[1]?.content, [		{ type: "text", text: "second deferred prompt" },
		{ type: "image", data: "image-data", mimeType: "image/png" },
	]);
	assert.equal(replacement.sentHistory.some((message) => message.content === "Continue the handed-off work now."), false);
	assert.deepEqual(replacement.latestState().deferredPrompts, []);
});

test("replacement restart resumes its durable FIFO in the replacement extension instance", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await harness.input("first after restart");
	await harness.input("second after restart");
	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	await harness.finishAgent("");
	await harness.dispatchNext();
	const firstReplacement = harness.replacement!;
	assert.equal(firstReplacement.latestState().deliveryPending, "replacement");

	const restarted = createHarness({
		entries: firstReplacement.entries,
		sessionId: firstReplacement.ctx.sessionManager.getSessionId(),
	});
	t.after(restarted.cleanup);
	await restarted.start();
	await runAcceptedDelivery(restarted);
	const delivered = restarted.sentHistory.filter((message) => !(typeof message.content === "string" && message.content.startsWith("/")));
	assert.deepEqual(delivered.map((message) => message.content), ["first after restart", "second after restart"]);
});

test("an accepted prompt replays after a crash-before-checkpoint instead of being dropped", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await harness.input("replay me");
	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	await harness.finishAgent("");
	await harness.dispatchNext();
	const replacement = harness.replacement!;
	replacement.setPersistFailure(true);
	await replacement.dispatchNext();
	assert.equal(replacement.sentHistory.some((message) => message.content === "replay me"), true);
	assert.equal(replacement.latestState().deferredPrompts[0].text, "replay me");
	assert.match(replacement.notifications.at(-1)?.message ?? "", /may replay/);

	const restarted = createHarness({ entries: replacement.entries, sessionId: replacement.ctx.sessionManager.getSessionId() });
	t.after(restarted.cleanup);
	await restarted.start();
	await runAcceptedDelivery(restarted);
	assert.equal(restarted.sentHistory.filter((message) => message.content === "replay me").length, 1);
});

test("rejected replacement send preserves the full FIFO and recovers without stale source APIs", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await harness.input("current prompt");
	await harness.input("remaining prompt");
	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	await harness.finishAgent("");
	await harness.dispatchNext();
	const replacement = harness.replacement!;
	replacement.setSendThrows(true);
	await replacement.dispatchNext();
	assert.deepEqual(replacement.latestState().deferredPrompts.map((prompt: { text: string }) => prompt.text), ["current prompt", "remaining prompt"]);
	assert.equal(replacement.latestState().deliveryPaused, true);
	assert.match(replacement.notifications.at(-1)?.message ?? "", /run \/sh recover/i);
	replacement.setSendThrows(false);
	await replacement.invoke("sh", "retry");
	assert.match(replacement.notifications.at(-1)?.message ?? "", /uses \/sh recover/i);
	assert.equal(replacement.latestState().deliveryPaused, true);
	await replacement.invoke("sh", "recover");
	await runAcceptedDelivery(replacement);
	const delivered = replacement.sentHistory.filter((message) => message.content === "current prompt" || message.content === "remaining prompt");
	assert.deepEqual(delivered.map((message) => message.content), ["current prompt", "remaining prompt"]);
});

test("input arriving during replacement delivery joins the same FIFO", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await harness.input("first queued");
	await harness.input("second queued");
	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	await harness.finishAgent("");
	await harness.dispatchNext();
	const replacement = harness.replacement!;
	await replacement.dispatchNext();
	assert.deepEqual(await replacement.input("arrived during drain"), { action: "handled" });
	await runAcceptedDelivery(replacement);
	const delivered = replacement.sentHistory.filter((message) => ["first queued", "second queued", "arrived during drain"].includes(message.content));
	assert.deepEqual(delivered.map((message) => message.content), ["first queued", "second queued", "arrived during drain"]);
});

test("session switch and fork guards protect active and durably deferred transactions", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	await harness.start();
	await harness.invoke("sh");
	assert.deepEqual(await harness.beforeSwitch(), { cancel: true });
	assert.deepEqual(await harness.beforeFork(), { cancel: true });
	const readiness = harness.latestState().handoff;
	await harness.dispatchNext();
	await harness.finishAgent(`${readiness.goId}: GO`);
	await harness.dispatchNext();
	await harness.input("preserve me");
	await harness.invoke("sh", "cancel");
	assert.equal(harness.latestState().deferredPrompts.length, 1);
	assert.deepEqual(await harness.beforeSwitch(), { cancel: true });
});

test("cancel returns multiple deferred prompts to the active source session in FIFO order", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	await harness.start();
	await harness.invoke("sh");
	await harness.input("source first");
	await harness.input("source second");
	await harness.invoke("sh", "cancel");
	assert.equal(harness.latestState().deliveryPending, "source");
	await runAcceptedDelivery(harness);
	const delivered = harness.sentHistory.filter((message) => message.content === "source first" || message.content === "source second");
	assert.deepEqual(delivered.map((message) => message.content), ["source first", "source second"]);
	assert.deepEqual(await harness.input("normal after cancellation"), { action: "continue" });
	assert.equal(await harness.beforeSwitch(), undefined);
});

test("cancel delivery rejection preserves the current and remaining source FIFO for retry", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	await harness.start();
	await harness.invoke("sh");
	await harness.input("retry first");
	await harness.input("retry second");
	await harness.invoke("sh", "cancel");
	// Discard the now-stale readiness message so the private delivery command is next.
	await harness.dispatchNext();
	harness.setSendThrows(true);
	await harness.dispatchNext();
	assert.deepEqual(harness.latestState().deferredPrompts.map((prompt: { text: string }) => prompt.text), ["retry first", "retry second"]);
	assert.equal(harness.latestState().deliveryPaused, true);
	assert.deepEqual(await harness.beforeSwitch(), { cancel: true });
	harness.setSendThrows(false);
	await harness.invoke("sh", "recover");
	await runAcceptedDelivery(harness);
	const delivered = harness.sentHistory.filter((message) => message.content === "retry first" || message.content === "retry second");
	assert.deepEqual(delivered.map((message) => message.content), ["retry first", "retry second"]);
});

test("input persistence failure restores interactive text and uses a truthful RPC fail-safe", async (t) => {
	const interactive = createHarness();
	t.after(interactive.cleanup);
	await interactive.start();
	await interactive.invoke("sh");
	interactive.setPersistFailure(true);
	assert.deepEqual(await interactive.input("exact editor text"), { action: "handled" });
	assert.equal(interactive.editorText, "exact editor text");
	assert.equal(interactive.latestState().deferredPrompts.length, 0);
	assert.match(interactive.notifications.at(-1)?.message ?? "", /restored to the editor/);

	const rpc = createHarness();
	t.after(rpc.cleanup);
	await rpc.start();
	await rpc.invoke("sh");
	rpc.setPersistFailure(true);
	assert.deepEqual(await rpc.input("rpc must continue", "rpc"), { action: "continue" });
	assert.deepEqual(await rpc.input("another RPC request", "rpc"), { action: "continue" }, "interception is deactivated in memory even while persistence remains unavailable");
	assert.match(rpc.notifications.at(-1)?.message ?? "", /will continue in the source session/);
});

test("writer retries are delayed, bounded, durable, and manually restartable with stale IDs rejected", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const harness = createHarness({ config: { writerRetryLimit: 3, writerRetryDelaySeconds: 1 } });
	t.after(harness.cleanup);
	let writing = await reachWriting(harness);
	const staleIds = [writing.submitId];
	for (let attempt = 1; attempt <= 4; attempt += 1) {
		await harness.finishAgent("");
		assert.equal(harness.latestState().handoff.attempt, attempt);
		if (attempt === 4) break;
		assert.equal(harness.sent.length, 0, "the next writer is not dispatched before the delay");
		t.mock.timers.tick(1_000);
		await waitFor(() => harness.latestState().handoff.attempt === attempt + 1);
		writing = harness.latestState().handoff;
		assert.equal(writing.attempt, attempt + 1);
		staleIds.push(writing.submitId);
		await harness.dispatchNext();
	}
	assert.equal(harness.latestState().handoff.paused, true);
	assert.equal(harness.latestState().handoff.totalAttempts, 4);
	assert.match(harness.notifications.at(-1)?.message ?? "", /exhausted 3 automatic retries/);
	await harness.invoke("sh", "retry");
	assert.equal(harness.latestState().handoff.attempt, 1);
	assert.equal(harness.latestState().handoff.totalAttempts, 5);
	assert.equal(staleIds.includes(harness.latestState().handoff.submitId), false);
	for (const id of staleIds) {
		await assert.rejects(harness.callTool("submit_session_handoff", { id, content: validHandoff() }), /Stale or unknown/);
	}
});

test("setup failure cleans the artifact and keeps deferred prompts recoverable", async (t) => {
	const harness = createHarness({ setupFailure: new Error("persist failed") });
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await harness.input("survive setup failure");
	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	await harness.finishAgent("");
	await harness.dispatchNext();
	const replacement = harness.replacement!;
	assert.equal(replacement.latestState().deliveryPending, "replacement");
	assert.equal(replacement.latestState().deliveryPaused, true);
	assert.deepEqual(replacement.latestState().deferredPrompts.map((prompt: { text: string }) => prompt.text), ["survive setup failure"]);
	assert.match(replacement.notifications.at(-1)?.message ?? "", /\/sh recover/);
	await replacement.invoke("sh", "recover");
	await runAcceptedDelivery(replacement);
	assert.equal(replacement.sentHistory.some((message) => message.content === "survive setup failure"), true);
	await assertMissing(handoffDirectory(writing.token));
});

test("handoff read failure returns deferred prompts to recoverable source delivery", async (t) => {
	const harness = createHarness();
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await harness.input("survive read failure");
	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	await harness.finishAgent("");
	await unlink(handoffPath(writing.token));
	await harness.dispatchNext();
	assert.equal(harness.latestState().deliveryPending, "source");
	assert.equal(harness.latestState().deliveryPaused, true);
	assert.match(harness.notifications.at(-1)?.message ?? "", /\/sh recover/);
	await harness.invoke("sh", "recover");
	await runAcceptedDelivery(harness);
	assert.equal(harness.sentHistory.some((message) => message.content === "survive read failure"), true);
});

test("hard cancel remains final when it races with an in-flight session replacement", async (t) => {
	let releaseReplacement!: () => void;
	let markStarted!: () => void;
	const gate = new Promise<void>((resolve) => { releaseReplacement = resolve; });
	const started = new Promise<void>((resolve) => { markStarted = resolve; });
	const harness = createHarness({ newSessionGate: gate, newSessionStarted: markStarted });
	t.after(harness.cleanup);
	const writing = await reachWriting(harness);
	await harness.callTool("submit_session_handoff", { id: writing.submitId, content: validHandoff() });
	await harness.finishAgent("");
	const transition = harness.dispatchNext();
	await started;
	await harness.invoke("sh", "cancel");
	releaseReplacement();
	await transition;

	assert.equal(harness.latestState().handoff, undefined);
	assert.equal(harness.latestState().banner, "cancelled");
	assert.equal(harness.replacement?.latestState().handoff, undefined);
	assert.equal(harness.replacement?.latestState().banner, "cancelled");
	assert.equal(harness.replacement?.sent.length, 0, "the raced replacement never starts automatic continuation");
	assert.equal(harness.replacement?.widgets.get("pi-simple-handoff")?.[0], "Session Handoff Cancelled");
	assert.equal(harness.replacement?.widgetColors.get("pi-simple-handoff"), "error");
	assert.match(harness.replacement?.notifications.at(-1)?.message ?? "", /Cancelled during the session switch/);
});

test("a rejected or cancelled replacement remains retryable without opening a second replacement", async (t) => {
	const rejected = createHarness({ throwNewSession: new Error("setup rejected") });
	t.after(rejected.cleanup);
	const rejectedWriting = await reachWriting(rejected);
	await rejected.callTool("submit_session_handoff", { id: rejectedWriting.submitId, content: validHandoff() });
	await rejected.finishAgent("");
	await rejected.dispatchNext();
	assert.equal(rejected.replacement, undefined);
	assert.equal(rejected.latestState().handoff.status, "ready");
	assert.equal(rejected.latestState().cleanupToken, undefined);

	const invalidated = createHarness({ throwAfterSourceInvalidated: new Error("replacement runtime failed") });
	t.after(invalidated.cleanup);
	const invalidatedWriting = await reachWriting(invalidated);
	await invalidated.callTool("submit_session_handoff", { id: invalidatedWriting.submitId, content: validHandoff() });
	await invalidated.finishAgent("");
	await invalidated.dispatchNext();
	assert.equal(invalidated.replacement, undefined);
	assert.equal(invalidated.latestState().handoff.status, "ready", "durable state remains retryable without touching stale source APIs");
	assert.equal(invalidated.latestState().cleanupToken, undefined);

	const cancelled = createHarness({ cancelNewSession: true });
	t.after(cancelled.cleanup);
	const cancelledWriting = await reachWriting(cancelled);
	await cancelled.callTool("submit_session_handoff", { id: cancelledWriting.submitId, content: validHandoff() });
	await cancelled.finishAgent("");
	await cancelled.dispatchNext();
	assert.equal(cancelled.replacement, undefined);
	assert.equal(cancelled.latestState().handoff.status, "ready");
	assert.match(cancelled.notifications.at(-1)?.message ?? "", /switch was cancelled/);
	await cancelled.invoke("sh", "retry");
	assert.match(cancelled.sent[0]?.content ?? "", /^\/session-handoff-open-new /);
});

test("cleanup state is independent, source ownership remains strict, and normal work stays available", async (t) => {
	const token = makeHandoffToken("source-session");
	await createPrivateHandoffDirectory(token);
	await writeValidatedHandoff(token, validHandoff());
	t.after(async () => {
		await (await import("node:fs/promises")).rm(handoffDirectory(token), { recursive: true, force: true });
		await (await import("node:fs/promises")).rm(`${handoffDirectory(token)}-cleanup`, { recursive: true, force: true });
	});
	const entries = [{
		type: "custom",
		customType: STATE_ENTRY,
		data: { warnedAtWarning: false, automaticHandoffSuppressed: false, cleanupToken: token, banner: "finished" },
	}];
	const replacement = createHarness({ entries, sessionId: "replacement-session" });
	await replacement.start();
	assert.equal(replacement.latestState().cleanupToken, undefined);
	assert.deepEqual(await replacement.input("normal work"), { action: "continue" });
	await assertMissing(handoffDirectory(token));

	const sourceToken = makeHandoffToken("source-session");
	const sourceEntries = [{ type: "custom", customType: STATE_ENTRY, data: { handoff: { status: "ready", token: sourceToken } } }];
	assert.equal(restoreState(sourceEntries, "replacement-session").handoff, undefined);
});
