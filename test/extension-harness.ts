import { rm } from "node:fs/promises";
import { DEFAULT_CONFIG } from "../extensions/pi-simple-handoff/config.ts";
import { handoffDirectory } from "../extensions/pi-simple-handoff/core.ts";
import { registerHandoffFlow } from "../extensions/pi-simple-handoff/handoff-flow.ts";
import { STATE_ENTRY } from "../extensions/pi-simple-handoff/state.ts";

type Handler = (...args: any[]) => unknown;
export type StateEntry = { type: string; customType: string; data: any; details?: any };

export type HarnessOptions = {
	config?: Partial<typeof DEFAULT_CONFIG>;
	contextPercent?: number;
	entries?: StateEntry[];
	sessionId?: string;
	setupFailure?: Error;
	cancelNewSession?: boolean;
	throwNewSession?: Error;
	throwAfterSourceInvalidated?: Error;
	newSessionGate?: Promise<void>;
	newSessionStarted?: () => void;
	sendFailure?: boolean;
	idle?: boolean;
};

export function validHandoff(): string {
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

export function createHarness(options: HarnessOptions = {}) {
	const sessionId = options.sessionId ?? `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const entries = options.entries ?? [];
	const events = new Map<string, Handler[]>();
	const commands = new Map<string, { handler: Handler }>();
	const tools = new Map<string, Record<string, any>>();
	const sent: Array<{ content: any; options?: any }> = [];
	const sentHistory: Array<{ content: any; options?: any }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const widgets = new Map<string, string[] | undefined>();
	const widgetColors = new Map<string, string | undefined>();
	const widgetComponents = new Map<string, { render(width: number): string[] }>();
	let waitCount = 0;
	let abortCount = 0;
	let activeTools = ["read", "bash", "mcp", "simple_handoff", "submit_session_handoff"];
	const activeToolHistory: string[][] = [[...activeTools]];
	let sourceInvalidated = false;
	let sendFailure = options.sendFailure === true;
	let sendThrows = false;
	let persistFailure = false;
	let editorText: string | undefined;
	let idle = options.idle ?? true;
	let replacement: ReturnType<typeof createHarness> | undefined;

	const emit = async (name: string, event: unknown, context = ctx) => {
		let result: unknown;
		for (const handler of events.get(name) ?? []) {
			const current = await handler(event, context);
			if (current !== undefined) result = current;
		}
		return result;
	};

	const ctx: Record<string, any> = {
		mode: "tui",
		hasUI: true,
		waitForIdle: async () => { waitCount += 1; idle = true; },
		isIdle: () => idle,
		getContextUsage: () => ({ percent: options.contextPercent ?? 25 }),
		abort: () => { abortCount += 1; },
		sessionManager: {
			getBranch: () => entries,
			getSessionId: () => sessionId,
			getSessionFile: () => `/sessions/${sessionId}.jsonl`,
		},
		ui: {
			notify: (message: string, level: string) => {
				if (sourceInvalidated) throw new Error("stale source command context UI");
				notifications.push({ message, level });
			},
			setWidget: (key: string, content: string[] | ((tui: unknown, theme: unknown) => { render(width: number): string[] }) | undefined) => {
				if (sourceInvalidated) throw new Error("stale source command context UI");
				if (typeof content !== "function") {
					widgets.set(key, content);
					widgetColors.set(key, undefined);
					widgetComponents.delete(key);
					return;
				}
				let color: string | undefined;
				const component = content({}, {
					fg: (name: string, text: string) => {
						color = name;
						return text;
					},
				});
				widgetComponents.set(key, component);
				widgets.set(key, component.render(200));
				widgetColors.set(key, color);
			},
			custom: async () => false,
			setEditorText: (text: string) => { editorText = text; },
		},
		reload: async () => undefined,
		newSession: async (sessionOptions: Record<string, any>) => {
			const guard = await emit("session_before_switch", { type: "session_before_switch", reason: "new" });
			if ((guard as { cancel?: boolean } | undefined)?.cancel) return { cancelled: true };
			options.newSessionStarted?.();
			if (options.newSessionGate) await options.newSessionGate;
			if (options.cancelNewSession) return { cancelled: true };
			if (options.throwNewSession) throw options.throwNewSession;
			await emit("session_shutdown", { reason: "new" });
			sourceInvalidated = true;
			if (options.throwAfterSourceInvalidated) throw options.throwAfterSourceInvalidated;
			replacement = createHarness({
				...(options.config ? { config: options.config } : {}),
				...(options.contextPercent === undefined ? {} : { contextPercent: options.contextPercent }),
				sessionId: `${sessionId}-replacement`,
			});
			await replacement.start();
			await sessionOptions.setup?.({
				appendMessage: (message: unknown) => {
					if (options.setupFailure) throw options.setupFailure;
					replacement!.messages.push(message);
				},
				appendCustomEntry: (customType: string, data: unknown) => {
					replacement!.entries.push({ type: "custom", customType, data });
				},
			});
			await sessionOptions.withSession?.({
				sendMessage: async (message: any) => {
					replacement!.entries.push({ type: "custom_message", customType: message.customType, details: message.details, data: message.details });
					await replacement!.messageEnd({ role: "custom", ...message });
				},
				sendUserMessage: async (content: any, sendOptions?: any) => {
					replacement!._recordSent(content, sendOptions);
					if (typeof content === "string" && content.startsWith("/")) await replacement!.dispatchNext();
				},
				sessionManager: replacement.ctx.sessionManager,
				ui: replacement.ctx.ui,
			});
			return { cancelled: false };
		},
	};

	const pi = {
		on(name: string, handler: Handler) { events.set(name, [...(events.get(name) ?? []), handler]); },
		appendEntry(customType: string, data: unknown) {
			if (sourceInvalidated) throw new Error("stale source Pi API");
			if (persistFailure) throw new Error("state persistence rejected");
			entries.push({ type: "custom", customType, data });
		},
		sendUserMessage(content: unknown, sendOptions?: unknown) {
			if (sourceInvalidated) throw new Error("stale source Pi API");
			if (sendThrows) throw new Error("sendUserMessage rejected");
			if (sendFailure) return;
			const message = { content: typeof content === "string" ? content : content, options: sendOptions };
			sent.push(message);
			sentHistory.push(message);
		},
		registerCommand(name: string, definition: { handler: Handler }) { commands.set(name, definition); },
		registerTool(definition: Record<string, any>) { tools.set(String(definition.name), definition); },
		getActiveTools() { return [...activeTools]; },
		setActiveTools(names: string[]) {
			activeTools = [...names];
			activeToolHistory.push([...names]);
		},
	};
	registerHandoffFlow(pi as never, { ...DEFAULT_CONFIG, ...options.config });

	const harness = {
		ctx,
		commands,
		entries,
		events,
		messages: [] as unknown[],
		notifications,
		sent,
		sentHistory,
		_recordSent: (content: any, sendOptions?: any) => {
			const message = { content, options: sendOptions };
			sent.push(message);
			sentHistory.push(message);
		},
		tools,
		widgets,
		widgetColors,
		renderWidgetAt: (key: string, width: number) => widgetComponents.get(key)?.render(width),
		get waitCount() { return waitCount; },
		get abortCount() { return abortCount; },
		get activeTools() { return [...activeTools]; },
		activeToolHistory,
		get replacement() { return replacement; },
		get editorText() { return editorText; },
		setSendFailure(value: boolean) { sendFailure = value; },
		setSendThrows(value: boolean) { sendThrows = value; },
		setPersistFailure(value: boolean) { persistFailure = value; },
		setIdle(value: boolean) { idle = value; },
		latestState: () => entries.at(-1)?.data as any,
		start: async () => { await emit("session_start", { reason: "startup" }); },
		invoke: async (name: string, args = "") => { await commands.get(name)?.handler(args, ctx); },
		input: async (text: string, source: "interactive" | "rpc" | "extension" = "interactive", images?: any[]) =>
			await emit("input", { type: "input", text, source, ...(images ? { images } : {}) }),
		prepareNext: async () => {
			const message = sent.shift();
			if (!message) throw new Error("No queued extension message.");
			if (typeof message.content === "string" && message.content.startsWith("/") && message.options?.expandPromptTemplates) {
				const space = message.content.indexOf(" ");
				const name = message.content.slice(1, space < 0 ? undefined : space);
				const args = space < 0 ? "" : message.content.slice(space + 1);
				await harness.invoke(name, args);
				return { content: message.content, startsAgent: false };
			}
			const inputText = typeof message.content === "string"
				? message.content
				: message.content.find((item: any) => item.type === "text")?.text ?? "";
			const inputResult = await harness.input(inputText, "extension") as { action?: string } | undefined;
			if (inputResult?.action === "handled") return { content: message.content, startsAgent: false };
			await emit("before_agent_start", { type: "before_agent_start", prompt: inputText, systemPrompt: "", systemPromptOptions: {} });
			return { content: message.content, startsAgent: true };
		},
		startAgent: async () => { idle = false; await emit("agent_start", { type: "agent_start" }); },
		dispatchNext: async () => {
			const prepared = await harness.prepareNext();
			if (prepared.startsAgent) await harness.startAgent();
			return prepared.content;
		},
		endAgent: async (text: string) => {
			const assistant = { role: "assistant", content: [{ type: "text", text }] };
			await emit("agent_end", { type: "agent_end", messages: [assistant] });
		},
		finishAgent: async (text: string) => {
			const assistant = { role: "assistant", content: [{ type: "text", text }] };
			await emit("agent_end", { type: "agent_end", messages: [assistant] });
			idle = true;
			await emit("agent_settled", { type: "agent_settled" });
		},
		settle: async () => { idle = true; await emit("agent_settled", { type: "agent_settled" }); },
		beforeCompact: async () => await emit("session_before_compact", {}),
		beforeSwitch: async () => await emit("session_before_switch", { type: "session_before_switch", reason: "resume" }),
		beforeFork: async () => await emit("session_before_fork", { type: "session_before_fork", entryId: "entry", position: "before" }),
		filterContext: async (messages: unknown[]) => await emit("context", { messages }),
		toolCall: async (toolName: string) => await emit("tool_call", { toolName }),
		messageEnd: async (message: unknown) => await emit("message_end", { type: "message_end", message }),
		callTool: async (name: string, params: unknown) =>
			await tools.get(name)!.execute("tool-id", params, undefined, undefined, ctx),
		addState: (data: unknown) => entries.push({ type: "custom", customType: STATE_ENTRY, data }),
		cleanup: async () => {
			const states = entries.map((entry) => entry.data).filter(Boolean);
			const tokens = new Set<string>();
			for (const value of states) {
				if (value.handoff?.token) tokens.add(value.handoff.token);
				if (value.cleanupToken) tokens.add(value.cleanupToken);
			}
			for (const token of tokens) {
				await rm(handoffDirectory(token), { recursive: true, force: true });
				await rm(`${handoffDirectory(token)}-cleanup`, { recursive: true, force: true });
			}
			await replacement?.cleanup();
		},
	};
	return harness;
}
