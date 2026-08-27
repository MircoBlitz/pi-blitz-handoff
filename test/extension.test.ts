import assert from "node:assert/strict";
import { access, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import simpleHandoffExtension from "../extensions/pi-simple-handoff/index.ts";
import { handoffDirectory, handoffPath } from "../extensions/pi-simple-handoff/core.ts";

type AnyHandler = (...args: unknown[]) => unknown;
type CommandHandler = (args: string, ctx: Record<string, unknown>) => Promise<void>;

type HarnessOptions = {
	sessionId?: string;
	branch?: unknown[];
	newSession?: (options: Record<string, unknown>) => Promise<{ cancelled: boolean }>;
};

function validHandoff(): string {
	return `# Context Handoff

## Goal
Finish the release review.

## Current State
The implementation is ready for validation.

## Decisions and Constraints
Do not expand scope.

## Next Steps
Run the remaining checks.

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

function createHarness(options: HarnessOptions = {}) {
	const sessionId = options.sessionId ?? `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const branch = options.branch ?? [];
	const entries: Array<{ type: string; customType: string; data: unknown }> = [];
	const sent: Array<{ content: unknown; options?: unknown }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const replacementMessages: unknown[] = [];
	const events = new Map<string, AnyHandler[]>();
	const commands = new Map<string, { handler: CommandHandler }>();
	const tools = new Map<string, Record<string, unknown>>();

	const sessionManager = {
		getBranch: () => branch,
		getSessionId: () => sessionId,
		getSessionFile: () => `/sessions/${sessionId}.jsonl`,
	};

	const defaultNewSession = async (newSessionOptions: Record<string, unknown>) => {
		const setup = newSessionOptions.setup as ((manager: Record<string, unknown>) => Promise<void>) | undefined;
		const withSession = newSessionOptions.withSession as ((ctx: Record<string, unknown>) => Promise<void>) | undefined;
		await setup?.({ appendMessage: (message: unknown) => replacementMessages.push(message) });
		await withSession?.({
			sendUserMessage: async (message: unknown) => {
				replacementMessages.push(message);
			},
			ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
		});
		return { cancelled: false };
	};

	const ctx: Record<string, unknown> = {
		hasUI: true,
		waitForIdle: async () => undefined,
		getContextUsage: () => ({ percent: 25 }),
		sessionManager,
		newSession: options.newSession ?? defaultNewSession,
		ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
	};

	const pi = {
		on(name: string, handler: AnyHandler) {
			events.set(name, [...(events.get(name) ?? []), handler]);
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
		sendUserMessage(content: unknown, sendOptions?: unknown) {
			sent.push({ content, options: sendOptions });
		},
		registerCommand(name: string, definition: { handler: CommandHandler }) {
			commands.set(name, definition);
		},
		registerTool(definition: Record<string, unknown>) {
			tools.set(String(definition.name), definition);
		},
	};

	simpleHandoffExtension(pi as never);

	return {
		sessionId,
		entries,
		sent,
		notifications,
		replacementMessages,
		events,
		commands,
		tools,
		ctx,
		async start() {
			await events.get("session_start")?.[0]?.({}, ctx);
		},
		async invoke(name: string, args = "") {
			const command = commands.get(name);
			assert.ok(command, `missing command ${name}`);
			await command.handler(args, ctx);
		},
		async settle() {
			await events.get("agent_settled")?.[0]?.({}, ctx);
		},
		latestState() {
			return entries.at(-1)?.data as { handoff?: { token: string; status: string } } | undefined;
		},
		async cleanup() {
			const token = this.latestState()?.handoff?.token;
			if (token) await rm(handoffDirectory(token), { recursive: true, force: true });
		},
	};
}

async function assertMissing(path: string): Promise<void> {
	await assert.rejects(access(path), (error: unknown) => {
		return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
	});
}

test("manual handoff persists context in a fresh session and cleans its private file", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	await harness.start();
	await harness.invoke("sh");

	const writing = harness.latestState()?.handoff;
	assert.equal(writing?.status, "writing");
	assert.equal(harness.sent.length, 1);
	await writeFile(handoffPath(writing!.token), validHandoff(), "utf8");
	await harness.settle();
	assert.equal(harness.latestState()?.handoff?.status, "ready");
	assert.match(String(harness.sent.at(-1)?.content), /^\/session-handoff-open-new /);

	await harness.invoke("session-handoff-open-new", writing!.token);
	assert.equal(harness.latestState()?.handoff?.status, "transitioning");
	assert.equal(harness.replacementMessages.length, 2);
	assert.match(JSON.stringify(harness.replacementMessages[0]), /BEGIN CONTEXT HANDOFF/);
	assert.equal(harness.replacementMessages[1], "Continue the handed-off work now.");
	await assertMissing(handoffPath(writing!.token));
	await assertMissing(handoffDirectory(writing!.token));
});

test("cancelled session replacement clears state and temporary data", async (t) => {
	const harness = createHarness({ newSession: async () => ({ cancelled: true }) });
	t.after(() => harness.cleanup());
	await harness.start();
	await harness.invoke("sh");
	const token = harness.latestState()?.handoff?.token;
	assert.ok(token);
	await writeFile(handoffPath(token), validHandoff(), "utf8");
	await harness.settle();
	await harness.invoke("session-handoff-open-new", token);
	assert.equal(harness.latestState()?.handoff, undefined);
	await assertMissing(handoffPath(token));
	assert.match(harness.notifications.at(-1)?.message ?? "", /cancelled/);
});

test("session replacement errors preserve a retryable handoff", async (t) => {
	const harness = createHarness({
		newSession: async () => {
			throw new Error("switch failed");
		},
	});
	t.after(() => harness.cleanup());
	await harness.start();
	await harness.invoke("sh");
	const token = harness.latestState()?.handoff?.token;
	assert.ok(token);
	await writeFile(handoffPath(token), validHandoff(), "utf8");
	await harness.settle();
	await harness.invoke("session-handoff-open-new", token);
	assert.equal(harness.latestState()?.handoff?.status, "ready");
	await access(handoffPath(token));
	assert.deepEqual(await harness.events.get("session_before_compact")?.[0]?.({}, harness.ctx), { cancel: true });
	assert.match(harness.notifications.at(-1)?.message ?? "", /retry/);
});

test("setup failures retain the handoff for source-session recovery", async (t) => {
	const harness = createHarness({
		newSession: async (newSessionOptions) => {
			const setup = newSessionOptions.setup as (manager: Record<string, unknown>) => Promise<void>;
			await setup({ appendMessage: () => { throw new Error("persist failed"); } });
			return { cancelled: false };
		},
	});
	t.after(() => harness.cleanup());
	await harness.start();
	await harness.invoke("sh");
	const token = harness.latestState()?.handoff?.token;
	assert.ok(token);
	await writeFile(handoffPath(token), validHandoff(), "utf8");
	await harness.settle();
	await harness.invoke("session-handoff-open-new", token);
	assert.equal(harness.latestState()?.handoff?.status, "ready");
	await access(handoffPath(token));
});

test("automatic continuation failures retain the source recovery file", async (t) => {
	const harness = createHarness({
		newSession: async (newSessionOptions) => {
			const setup = newSessionOptions.setup as (manager: Record<string, unknown>) => Promise<void>;
			const withSession = newSessionOptions.withSession as (ctx: Record<string, unknown>) => Promise<void>;
			await setup({ appendMessage: () => undefined });
			await withSession({
				sendUserMessage: async () => { throw new Error("continuation failed"); },
				ui: { notify: () => undefined },
			});
			return { cancelled: false };
		},
	});
	t.after(() => harness.cleanup());
	await harness.start();
	await harness.invoke("sh");
	const token = harness.latestState()?.handoff?.token;
	assert.ok(token);
	await writeFile(handoffPath(token), validHandoff(), "utf8");
	await harness.settle();
	await harness.invoke("session-handoff-open-new", token);
	assert.equal(harness.latestState()?.handoff?.status, "ready");
	await access(handoffPath(token));
});

test("malformed and symlinked handoffs are rejected without touching their targets", async (t) => {
	const malformed = createHarness();
	t.after(() => malformed.cleanup());
	await malformed.start();
	await malformed.invoke("sh");
	const malformedToken = malformed.latestState()?.handoff?.token;
	assert.ok(malformedToken);
	await writeFile(handoffPath(malformedToken), "# Context Handoff\n\n## Goal\npartial", "utf8");
	await malformed.settle();
	assert.equal(malformed.latestState()?.handoff, undefined);
	await assertMissing(handoffPath(malformedToken));

	const linked = createHarness();
	t.after(() => linked.cleanup());
	await linked.start();
	await linked.invoke("sh");
	const linkedToken = linked.latestState()?.handoff?.token;
	assert.ok(linkedToken);
	const target = `${handoffDirectory(linkedToken)}-target`;
	t.after(() => rm(target, { force: true }));
	await writeFile(target, validHandoff(), "utf8");
	await symlink(target, handoffPath(linkedToken));
	await linked.settle();
	assert.equal(linked.latestState()?.handoff, undefined);
	await access(target);
	await assertMissing(handoffPath(linkedToken));
});

test("cleanup never traverses a symlinked handoff directory", async (t) => {
	const sessionId = "linked-directory-session";
	const token = `${sessionId}-abc`;
	const targetDirectory = `${handoffDirectory(token)}-target`;
	const targetFile = `${targetDirectory}/session-handoff.md`;
	await mkdir(targetDirectory, { mode: 0o700 });
	await writeFile(targetFile, validHandoff(), "utf8");
	await symlink(targetDirectory, handoffDirectory(token));
	const harness = createHarness({
		sessionId,
		branch: [{
			type: "custom",
			customType: "pi-simple-handoff-state",
			data: { version: 1, warnedAtWarning: false, handoff: { token, status: "ready" } },
		}],
	});
	t.after(() => rm(targetDirectory, { recursive: true, force: true }));
	await harness.start();
	await access(targetFile);
	await assertMissing(handoffDirectory(token));
});

test("restored state accepts only tokens bound to the current session", async () => {
	const sessionId = "trusted-session";
	const harness = createHarness({
		sessionId,
		branch: [{
			type: "custom",
			customType: "pi-simple-handoff-state",
			data: {
				version: 1,
				warnedAtWarning: false,
				handoff: { token: "other-session-abc", status: "writing", path: "/etc/passwd" },
			},
		}],
	});
	await harness.start();
	assert.equal(await harness.events.get("session_before_compact")?.[0]?.({}, harness.ctx), undefined);
	await harness.settle();
	assert.equal(harness.sent.length, 0);
});

test("a restored ready handoff is requeued and can complete", async (t) => {
	const sessionId = "restored-session";
	const token = `${sessionId}-abc`;
	await mkdir(handoffDirectory(token), { mode: 0o700 });
	await writeFile(handoffPath(token), validHandoff(), "utf8");
	const harness = createHarness({
		sessionId,
		branch: [{
			type: "custom",
			customType: "pi-simple-handoff-state",
			data: { version: 1, warnedAtWarning: false, handoff: { token, status: "ready" } },
		}],
	});
	t.after(() => rm(handoffDirectory(token), { recursive: true, force: true }));
	await harness.start();
	assert.equal(harness.sent.at(-1)?.content, `/session-handoff-open-new ${token}`);
	await harness.invoke("session-handoff-open-new", token);
	await assertMissing(handoffDirectory(token));
});

test("session shutdown clears an unfinished handoff and its private data", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	await harness.start();
	await harness.invoke("sh");
	const token = harness.latestState()?.handoff?.token;
	assert.ok(token);
	await harness.events.get("session_shutdown")?.[0]?.({}, harness.ctx);
	assert.equal(harness.latestState()?.handoff, undefined);
	await assertMissing(handoffDirectory(token));
});

test("duplicate manual starts are blocked before creating another job", async (t) => {
	const harness = createHarness();
	t.after(() => harness.cleanup());
	await harness.start();
	await harness.invoke("sh");
	const firstToken = harness.latestState()?.handoff?.token;
	await harness.invoke("sh");
	assert.equal(harness.latestState()?.handoff?.token, firstToken);
	assert.equal(harness.sent.length, 1);
	assert.match(harness.notifications.at(-1)?.message ?? "", /already in progress/);
});

test("simple_handoff is discoverable from natural requests and queues the short command", async () => {
	const harness = createHarness();
	await harness.start();
	assert.equal(harness.commands.has("simplehandoff"), false);
	assert.equal(harness.commands.has("sh"), true);
	const tool = harness.tools.get("simple_handoff") as {
		description: string;
		promptGuidelines: string[];
		execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; details: Record<string, unknown> }>;
	};
	assert.match(tool.description, /simple hand off/i);
	assert.match(tool.promptGuidelines.join(" "), /call simple_handoff with action=start immediately/i);
	assert.match(tool.promptGuidelines.join(" "), /merely discussing, questioning, testing, or asking to fix/i);
	const status = await tool.execute("id", { action: "status" }, undefined, undefined, harness.ctx);
	assert.match(status.content[0]!.text, /25\.0%/);
	const start = await tool.execute("id", { action: "start" }, undefined, undefined, harness.ctx);
	assert.equal(start.details.queued, true);
	assert.equal(harness.sent.at(-1)?.content, "/sh");
	assert.deepEqual(harness.sent.at(-1)?.options, {
		deliverAs: "followUp",
		expandPromptTemplates: true,
	});
});
