import { randomUUID } from "node:crypto";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { MIN_AUTOMATIC_HANDOFF_PERCENT, type SimpleHandoffConfig } from "./config.ts";
import { buildHandoffCreationPrompt, formatWarning, makeHandoffToken, validateThresholds, warningLevel } from "./core.ts";
import { cleanupHandoff, createPrivateHandoffDirectory, readValidatedHandoff } from "./filesystem.ts";
import { buildReadinessPrompt, createReadinessIds, lastAssistantText, messageText, parseReadinessAnswer, type ReadinessIds } from "./readiness.ts";
import { registerHandoffCommand } from "./handoff-command.ts";
import { registerPublicTool } from "./public-tool.ts";
import { DEFAULT_STATE, STATE_ENTRY, type DeferredPrompt, type ExtensionState, restoreState } from "./state.ts";
import { DELIVERY_COMMAND, queueSessionTransition, registerTransition, type ReplacementTransfer } from "./transition.ts";
import { handoffWidget } from "./widget.ts";

const WIDGET = "pi-simple-handoff";
const GENERIC_CONTINUATION = "Continue the handed-off work now.";
type Ui = ExtensionContext["ui"];
type FlowContext = ExtensionContext;

function promptContent(prompt: DeferredPrompt): string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
	if (!prompt.images?.length) return prompt.text;
	return [{ type: "text", text: prompt.text }, ...prompt.images];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function registerHandoffFlow(pi: ExtensionAPI, config: SimpleHandoffConfig): void {
	const thresholds = validateThresholds({ warningThreshold: config.kvWarningPercent, criticalThreshold: config.selfHandoffPercent });
	const configuredAutomaticPercent = config.automaticSessionHandoffPercent;
	const automaticPercent = config.automaticSessionHandoff && configuredAutomaticPercent >= MIN_AUTOMATIC_HANDOFF_PERCENT
		? configuredAutomaticPercent
		: 0;
	let state: ExtensionState = { ...DEFAULT_STATE, deferredPrompts: [] };
	let replacementTransfer: ReplacementTransfer | undefined;
	let transitionInProgress = false;
	let ownSessionSwitch = false;
	let activeReadiness: ReadinessIds | undefined;
	let readinessOutcome: { ids: ReadinessIds; answer: "go" | "wait" | "invalid" } | undefined;
	let activeWritingId: string | undefined;
	let writerEndedId: string | undefined;
	let writerToolsBeforeRestriction: string[] | undefined;
	let readinessTimer: ReturnType<typeof setTimeout> | undefined;
	let writerTimer: ReturnType<typeof setTimeout> | undefined;
	let countdownTimer: ReturnType<typeof setTimeout> | undefined;
	let deliveryCommandQueued = false;
	let deliveryDraining = false;
	const readinessRetryMs = config.readinessRetrySeconds * 1000;
	const writerRetryMs = config.writerRetryDelaySeconds * 1000;

	const persist = () => pi.appendEntry(STATE_ENTRY, state);
	const persistState = (next: ExtensionState) => {
		const previous = state;
		state = next;
		try {
			persist();
			if (replacementTransfer) replacementTransfer.state = state;
		} catch (error) {
			state = previous;
			throw error;
		}
	};
	const restrictWriterTools = () => {
		if (writerToolsBeforeRestriction) return;
		writerToolsBeforeRestriction = pi.getActiveTools();
		pi.setActiveTools(["submit_session_handoff"]);
	};
	const restoreWriterTools = () => {
		const tools = writerToolsBeforeRestriction;
		if (!tools) return;
		writerToolsBeforeRestriction = undefined;
		pi.setActiveTools(tools);
	};
	const clearTimers = () => {
		if (readinessTimer) clearTimeout(readinessTimer);
		if (writerTimer) clearTimeout(writerTimer);
		if (countdownTimer) clearTimeout(countdownTimer);
		readinessTimer = undefined;
		writerTimer = undefined;
		countdownTimer = undefined;
	};
	const secondsUntil = (deadline: number | undefined) => deadline === undefined
		? undefined
		: Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
	const renderWidget = (ui: Ui) => {
		const pendingRetryAt = state.handoff?.status === "pending" ? state.handoff.retryAt : undefined;
		const writerRetryAt = state.handoff?.status === "writing" ? state.handoff.retryAt : undefined;
		const widget = handoffWidget(state, {
			readinessCheckActive: activeReadiness !== undefined,
			continueInSeconds: secondsUntil(pendingRetryAt),
			writerRetryInSeconds: secondsUntil(writerRetryAt),
		});
		ui.setWidget(WIDGET, widget
			? (_tui, theme) => ({
				render: (width) => [truncateToWidth(theme.fg(widget.color, widget.text), width)],
				invalidate() {},
			})
			: undefined);
	};
	const updateCountdown = (ui: Ui) => {
		if (countdownTimer) clearTimeout(countdownTimer);
		countdownTimer = undefined;
		const retryAt = state.handoff?.status === "pending" || state.handoff?.status === "writing"
			? state.handoff.retryAt
			: undefined;
		if (retryAt === undefined) return;
		renderWidget(ui);
		const remaining = retryAt - Date.now();
		if (remaining <= 0) return;
		countdownTimer = setTimeout(() => updateCountdown(ui), Math.min(1000, remaining));
		countdownTimer.unref();
	};
	const pauseDelivery = (ui: Ui, message: string) => {
		state = { ...state, deliveryPaused: true, banner: "error" };
		try { persist(); } catch { /* the last durable FIFO remains the recovery source */ }
		renderWidget(ui);
		ui.notify(`${message} The current and remaining prompts are preserved; run /sh recover.`, "error");
	};
	const scheduleDelivery = (ui: Ui) => {
		if (!state.deliveryPending || state.deliveryPaused || deliveryCommandQueued || deliveryDraining) return;
		deliveryCommandQueued = true;
		try {
			pi.sendUserMessage(`/${DELIVERY_COMMAND}`, { deliverAs: "followUp", expandPromptTemplates: true });
		} catch (error) {
			deliveryCommandQueued = false;
			pauseDelivery(ui, `Deferred delivery could not be scheduled: ${errorMessage(error)}.`);
		}
	};
	const drainNextDeferredPrompt = (ctx: FlowContext) => {
		deliveryCommandQueued = false;
		if (deliveryDraining || !state.deliveryPending) return;
		deliveryDraining = true;
		try {
			const target = state.deliveryPending;
			const next = state.deferredPrompts[0];
			if (target === "source" && !next) {
				persistState({ ...state, deliveryPending: undefined, deliveryPaused: undefined, banner: "cancelled" });
				renderWidget(ctx.ui);
				return;
			}
			try {
				pi.sendUserMessage(next ? promptContent(next) : GENERIC_CONTINUATION, {
					deliverAs: "followUp",
					expandPromptTemplates: false,
				});
			} catch (error) {
				pauseDelivery(ctx.ui, `Deferred prompt delivery was rejected: ${errorMessage(error)}.`);
				return;
			}

			const remaining = next
				? state.deferredPrompts.filter((prompt) => prompt.sequence !== next.sequence)
				: state.deferredPrompts;
			const complete = remaining.length === 0;
			const checkpoint: ExtensionState = {
				...state,
				deferredPrompts: remaining,
				deliveryPaused: undefined,
				...(complete
					? { deliveryPending: undefined, banner: target === "replacement" ? "finished" as const : "cancelled" as const }
					: {}),
			};
			try {
				persistState(checkpoint);
			} catch (error) {
				pauseDelivery(ctx.ui, `The accepted prompt could not be checkpointed: ${errorMessage(error)}. It may replay on retry.`);
				return;
			}
			renderWidget(ctx.ui);
		} finally {
			deliveryDraining = false;
		}
		if (state.deliveryPending) scheduleDelivery(ctx.ui);
	};
	const setError = (message: string, ui: Ui) => {
		restoreWriterTools();
		state = { ...state, handoff: undefined, banner: "error" };
		persist();
		renderWidget(ui);
		ui.notify(message, "error");
	};
	const restoreLatestState = (ctx: { sessionManager: { getBranch(): readonly unknown[]; getSessionId(): string } }) => {
		state = restoreState(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId());
	};

	const armReadinessTimer = (ctx: FlowContext) => {
		if (readinessTimer) clearTimeout(readinessTimer);
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "pending" || handoff.retryAt === undefined) return;
		const check = () => {
			const current = state.handoff;
			if (!current || current.status !== "pending" || activeReadiness) return;
			if (!ctx.isIdle()) {
				readinessTimer = setTimeout(check, 250);
				readinessTimer.unref();
				return;
			}
			const ids = createReadinessIds();
			state = { ...state, handoff: { status: "pending", ...ids, retryAt: Date.now() + readinessRetryMs } };
			persist();
			renderWidget(ctx.ui);
			updateCountdown(ctx.ui);
			pi.sendUserMessage(buildReadinessPrompt({ goId: ids.goId, waitId: ids.waitId }), { deliverAs: "followUp", expandPromptTemplates: false });
			armReadinessTimer(ctx);
		};
		readinessTimer = setTimeout(check, Math.max(0, handoff.retryAt - Date.now()));
		readinessTimer.unref();
		updateCountdown(ctx.ui);
	};
	const dispatchInitialReadiness = (ctx: FlowContext) => {
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "pending") return;
		state = { ...state, handoff: { ...handoff, retryAt: Date.now() + readinessRetryMs } };
		persist();
		renderWidget(ctx.ui);
		updateCountdown(ctx.ui);
		pi.sendUserMessage(buildReadinessPrompt(handoff), { deliverAs: "followUp", expandPromptTemplates: false });
		armReadinessTimer(ctx);
	};
	const scheduleReadinessRetry = (ctx: FlowContext, message: string) => {
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "pending") return;
		state = { ...state, handoff: { ...handoff, retryAt: Date.now() + readinessRetryMs } };
		persist();
		renderWidget(ctx.ui);
		ctx.ui.notify(message, "warning");
		armReadinessTimer(ctx);
	};

	const sendWriterPrompt = (ctx: FlowContext) => {
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "writing") return;
		restrictWriterTools();
		renderWidget(ctx.ui);
		pi.sendUserMessage(buildHandoffCreationPrompt(handoff.submitId, ctx.sessionManager.getSessionFile()), {
			deliverAs: "followUp",
			expandPromptTemplates: false,
		});
	};
	const beginWriting = async (ctx: FlowContext) => {
		if (readinessTimer) clearTimeout(readinessTimer);
		readinessTimer = undefined;
		const token = makeHandoffToken(ctx.sessionManager.getSessionId());
		state = {
			...state,
			handoff: { status: "writing", token, submitId: randomUUID(), attempt: 1, totalAttempts: 1 },
			banner: undefined,
		};
		persist();
		restrictWriterTools();
		renderWidget(ctx.ui);
		try {
			await createPrivateHandoffDirectory(token);
			sendWriterPrompt(ctx);
		} catch (error) {
			await cleanupHandoff(token).catch(() => undefined);
			setError(`Could not start the handoff writer: ${errorMessage(error)} Run /sh to retry.`, ctx.ui);
		}
	};
	const launchWriterRetry = async (ctx: FlowContext, resetCycle: boolean) => {
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "writing") return;
		if (activeWritingId === handoff.submitId) {
			ctx.ui.notify("The current handoff writer is still running.", "warning");
			return;
		}
		if (writerTimer) clearTimeout(writerTimer);
		writerTimer = undefined;
		try {
			await cleanupHandoff(handoff.token);
			await createPrivateHandoffDirectory(handoff.token);
			state = {
				...state,
				handoff: {
					status: "writing",
					token: handoff.token,
					submitId: randomUUID(),
					attempt: resetCycle ? 1 : handoff.attempt + 1,
					totalAttempts: handoff.totalAttempts + 1,
				},
			};
			writerEndedId = undefined;
			persist();
			sendWriterPrompt(ctx);
		} catch (error) {
			setError(`Could not reset the handoff writer safely: ${errorMessage(error)} The unsafe artifact was preserved. Use /sh cancel or fix it before retrying.`, ctx.ui);
		}
	};
	const armWriterTimer = (ctx: FlowContext) => {
		if (writerTimer) clearTimeout(writerTimer);
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "writing" || handoff.retryAt === undefined || handoff.paused) return;
		const check = () => {
			const current = state.handoff;
			if (!current || current.status !== "writing" || current.retryAt === undefined || current.paused) return;
			if (!ctx.isIdle()) {
				writerTimer = setTimeout(check, 250);
				writerTimer.unref();
				return;
			}
			void launchWriterRetry(ctx, false);
		};
		writerTimer = setTimeout(check, Math.max(0, handoff.retryAt - Date.now()));
		writerTimer.unref();
		updateCountdown(ctx.ui);
	};
	const scheduleWriterRetry = (ctx: FlowContext) => {
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "writing") return;
		activeWritingId = undefined;
		writerEndedId = undefined;
		restoreWriterTools();
		if (handoff.attempt > config.writerRetryLimit) {
			state = { ...state, handoff: { ...handoff, retryAt: undefined, paused: true } };
			persist();
			renderWidget(ctx.ui);
			ctx.ui.notify(`The handoff writer exhausted ${config.writerRetryLimit} automatic retries. Run /sh retry or /sh cancel.`, "error");
			return;
		}
		state = { ...state, handoff: { ...handoff, retryAt: Date.now() + writerRetryMs, paused: undefined } };
		persist();
		renderWidget(ctx.ui);
		ctx.ui.notify(`The handoff writer ended without an accepted submission. Retrying in ${config.writerRetryDelaySeconds} seconds.`, "warning");
		armWriterTimer(ctx);
	};
	const retryWriting = async (ctx: FlowContext) => {
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "writing") return;
		try {
			await readValidatedHandoff(handoff.token);
			restoreWriterTools();
			state = { ...state, handoff: { status: "ready", token: handoff.token } };
			persist();
			renderWidget(ctx.ui);
			queueSessionTransition(pi, handoff.token);
			return;
		} catch {
			// Only an extension-validated artifact can bypass regeneration.
		}
		if (!handoff.retryAt && !handoff.paused && activeWritingId === handoff.submitId) {
			ctx.ui.notify("The current handoff writer is still running.", "warning");
			return;
		}
		await launchWriterRetry(ctx, handoff.paused === true);
	};
	const retryCleanup = async (ui: Ui) => {
		const token = state.cleanupToken;
		if (!token) return true;
		try {
			await cleanupHandoff(token);
			state = { ...state, cleanupToken: undefined };
			persist();
			renderWidget(ui);
			return true;
		} catch (error) {
			ui.notify(`Private handoff cleanup failed: ${errorMessage(error)} Normal work remains available; run /sh cleanup to retry.`, "error");
			return false;
		}
	};
	const newPendingState = () => {
		const ids = createReadinessIds();
		state = { ...state, handoff: { status: "pending", ...ids }, banner: undefined };
		persist();
	};
	const startHandoff = (ctx: FlowContext) => {
		newPendingState();
		renderWidget(ctx.ui);
		ctx.ui.notify("Session Handoff Pending — waiting for current agent and subagent work to settle.", "warning");
		dispatchInitialReadiness(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		clearTimers();
		activeReadiness = undefined;
		readinessOutcome = undefined;
		activeWritingId = undefined;
		writerEndedId = undefined;
		transitionInProgress = false;
		ownSessionSwitch = false;
		deliveryCommandQueued = false;
		deliveryDraining = false;
		restoreLatestState(ctx);
		renderWidget(ctx.ui);
		if (ctx.hasUI && configuredAutomaticPercent > 0 && configuredAutomaticPercent < MIN_AUTOMATIC_HANDOFF_PERCENT) {
			ctx.ui.notify(`Automatic Session Handoff is deactivated: ${configuredAutomaticPercent}% is too low; use 50–100%.`, "warning");
		}
		await retryCleanup(ctx.ui);
		if (state.deliveryPending) {
			if (state.deliveryPaused) {
				state = { ...state, deliveryPaused: undefined };
				persist();
				renderWidget(ctx.ui);
			}
			scheduleDelivery(ctx.ui);
			return;
		}
		if (state.handoff?.status === "pending") {
			if (state.handoff.retryAt === undefined) dispatchInitialReadiness(ctx);
			else armReadinessTimer(ctx);
			return;
		}
		if (state.handoff?.status === "writing") {
			const writing = state.handoff;
			try {
				await readValidatedHandoff(writing.token);
				state = { ...state, handoff: { status: "ready", token: writing.token } };
				persist();
				queueSessionTransition(pi, writing.token);
			} catch {
				if (writing.paused) renderWidget(ctx.ui);
				else if (writing.retryAt !== undefined) armWriterTimer(ctx);
				else scheduleWriterRetry(ctx);
			}
			return;
		}
		if (state.handoff?.status === "ready") queueSessionTransition(pi, state.handoff.token);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearTimers();
		restoreWriterTools();
		ctx.ui.setWidget(WIDGET, undefined);
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "custom" || event.message.customType !== STATE_ENTRY) return;
		restoreLatestState(ctx);
		renderWidget(ctx.ui);
		if (state.deliveryPending && !state.deliveryPaused) scheduleDelivery(ctx.ui);
	});

	pi.on("session_before_switch", (_event, ctx) => {
		if (ownSessionSwitch) {
			ownSessionSwitch = false;
			return;
		}
		if (state.handoff || transitionInProgress || state.deferredPrompts.length > 0) {
			ctx.ui.notify("Session change blocked while Simple Handoff owns active or deferred work. Use /sh cancel first.", "warning");
			return { cancel: true };
		}
	});
	pi.on("session_before_fork", (_event, ctx) => {
		if (state.handoff || transitionInProgress || state.deferredPrompts.length > 0) {
			ctx.ui.notify("Fork blocked while Simple Handoff owns active or deferred work. Use /sh cancel first.", "warning");
			return { cancel: true };
		}
	});
	pi.on("session_before_compact", () => {
		if (state.handoff?.status === "writing" || state.handoff?.status === "ready" || state.handoff?.status === "transitioning") return { cancel: true };
	});

	pi.on("input", (event, ctx) => {
		if (event.source === "extension" && event.text.startsWith("🟡 **HANDOFF READINESS CHECK**")) {
			const handoff = state.handoff;
			if (!handoff || handoff.status !== "pending" || event.text !== buildReadinessPrompt(handoff)) return { action: "handled" };
			return { action: "continue" };
		}
		if (event.source === "extension" && event.text.startsWith("🟡 **HANDOFF STARTED**")) {
			const handoff = state.handoff;
			if (!handoff || handoff.status !== "writing" || event.text !== buildHandoffCreationPrompt(handoff.submitId, ctx.sessionManager.getSessionFile())) return { action: "handled" };
			activeWritingId = handoff.submitId;
			writerEndedId = undefined;
			return { action: "continue" };
		}
		if (event.source === "extension") return { action: "continue" };
		if (state.banner && state.deferredPrompts.length === 0 && !state.deliveryPending) {
			const previous = state;
			state = { ...state, banner: undefined };
			try { persist(); } catch { state = previous; }
			renderWidget(ctx.ui);
		}
		if (!state.handoff && !transitionInProgress && !state.deliveryPending) return { action: "continue" };
		const prompt = {
			sequence: state.nextDeferredSequence,
			text: event.text,
			...(event.images?.length ? { images: event.images.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType })) } : {}),
		};
		try {
			persistState({
				...state,
				deferredPrompts: [...state.deferredPrompts, prompt],
				nextDeferredSequence: state.nextDeferredSequence + 1,
			});
		} catch (error) {
			if (event.source === "interactive") {
				ctx.ui.setEditorText(event.text);
				renderWidget(ctx.ui);
				ctx.ui.notify(`The prompt could not be deferred: ${errorMessage(error)}. Its exact text was restored to the editor; attached images could not be restored by Pi's editor API.`, "error");
				return { action: "handled" };
			}
			clearTimers();
			restoreWriterTools();
			activeReadiness = undefined;
			readinessOutcome = undefined;
			activeWritingId = undefined;
			writerEndedId = undefined;
			transitionInProgress = false;
			ownSessionSwitch = false;
			const handoff = state.handoff;
			const token = handoff && "token" in handoff ? handoff.token : undefined;
			state = {
				...state,
				handoff: undefined,
				...(token ? { cleanupToken: token } : {}),
				deliveryPending: state.deferredPrompts.length > 0 ? "source" : undefined,
				deliveryPaused: state.deferredPrompts.length > 0 ? true : undefined,
				automaticHandoffSuppressed: true,
				banner: "error",
			};
			try { persist(); } catch { /* persistence is the failure being surfaced */ }
			renderWidget(ctx.ui);
			ctx.ui.notify(`The RPC prompt could not be persisted for handoff: ${errorMessage(error)}. Handoff interception was deactivated and this request will continue in the source session.`, "error");
			return { action: "continue" };
		}
		renderWidget(ctx.ui);
		ctx.ui.notify(`Session Handoff active; deferred prompts: ${state.deferredPrompts.length}`, "warning");
		return { action: "handled" };
	});

	pi.on("context", (event, ctx) => {
		const readinessPrompt = state.handoff?.status === "pending" ? buildReadinessPrompt(state.handoff) : undefined;
		const writingPrompt = state.handoff?.status === "writing" ? buildHandoffCreationPrompt(state.handoff.submitId, ctx.sessionManager.getSessionFile()) : undefined;
		return {
			messages: event.messages.filter((message) => {
				if (message.role !== "user") return true;
				const text = messageText(message);
				if (text?.startsWith("🟡 **HANDOFF READINESS CHECK**")) return text === readinessPrompt;
				if (text?.startsWith("🟡 **HANDOFF STARTED**")) return text === writingPrompt;
				return true;
			}),
		};
	});

	pi.on("before_agent_start", (event, ctx) => {
		const handoff = state.handoff;
		if (handoff?.status === "pending" && event.prompt === buildReadinessPrompt(handoff)) {
			if (readinessTimer) clearTimeout(readinessTimer);
			readinessTimer = undefined;
			state = { ...state, handoff: { ...handoff, retryAt: undefined } };
			persist();
			activeReadiness = { goId: handoff.goId, waitId: handoff.waitId };
			readinessOutcome = undefined;
			renderWidget(ctx.ui);
		}
	});

	pi.on("tool_call", (event) => {
		if (state.handoff?.status === "writing" && event.toolName !== "submit_session_handoff") {
			return { block: true, reason: "Session Handoff is running; only submit_session_handoff is allowed.", terminate: true };
		}
	});

	pi.on("agent_end", (event) => {
		if (activeWritingId && state.handoff?.status === "writing" && state.handoff.submitId === activeWritingId) {
			writerEndedId = activeWritingId;
			return;
		}
		const ids = activeReadiness;
		if (!ids || readinessOutcome) return;
		const handoff = state.handoff;
		if (!handoff || handoff.status !== "pending" || handoff.goId !== ids.goId || handoff.waitId !== ids.waitId) return;
		readinessOutcome = { ids, answer: parseReadinessAnswer(lastAssistantText(event.messages) ?? "", ids) };
		activeReadiness = undefined;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const outcome = readinessOutcome;
		if (outcome) {
			readinessOutcome = undefined;
			const handoff = state.handoff;
			if (handoff?.status === "pending" && handoff.goId === outcome.ids.goId && handoff.waitId === outcome.ids.waitId) {
				if (outcome.answer === "go") {
					await beginWriting(ctx);
					return;
				}
				const message = outcome.answer === "wait"
					? `Session Handoff remains pending: the source session reported NOT YET. Readiness will be checked again in ${config.readinessRetrySeconds} seconds.`
					: `Invalid handoff readiness response. It was handled safely as NOT YET; readiness will be checked again in ${config.readinessRetrySeconds} seconds.`;
				scheduleReadinessRetry(ctx, message);
				return;
			}
		}
		if (writerEndedId && state.handoff?.status === "writing" && state.handoff.submitId === writerEndedId) {
			scheduleWriterRetry(ctx);
			return;
		}
		if (!ctx.hasUI || state.handoff || state.cleanupToken || state.deliveryPending || state.deferredPrompts.length > 0 || state.banner) return;
		const percent = ctx.getContextUsage()?.percent ?? null;
		if (!state.automaticHandoffSuppressed && automaticPercent !== 0 && percent !== null && Number.isFinite(percent) && percent >= automaticPercent) {
			newPendingState();
			renderWidget(ctx.ui);
			dispatchInitialReadiness(ctx);
			ctx.ui.notify(`Automatic session handoff pending at ${Math.floor(percent)}%; checking readiness now.`, "warning");
			return;
		}
		const level = warningLevel(percent, state.warnedAtWarning, thresholds);
		if (!level || percent === null) return;
		if (!state.warnedAtWarning) {
			state = { ...state, warnedAtWarning: true };
			persist();
		}
		ctx.ui.notify(formatWarning(percent, level), level);
	});

	pi.registerCommand(DELIVERY_COMMAND, {
		description: "Resume the private durable Simple Handoff FIFO",
		handler: async (_args, ctx) => {
			drainNextDeferredPrompt(ctx);
		},
	});

	registerPublicTool(pi, {
		config,
		thresholds,
		automaticPercent,
		configuredAutomaticPercent,
		isBusy: () => state.cleanupToken ? "cleanup" : state.handoff || transitionInProgress || state.deliveryPending ? "handoff" : undefined,
		start: startHandoff,
	});

	registerHandoffCommand(pi, {
		getState: () => state,
		isTransitioning: () => transitionInProgress,
		retryCleanup: async (ctx) => { await retryCleanup(ctx.ui); },
		retryDelivery: (ctx) => {
			if (!state.deliveryPending) return;
			try {
				persistState({ ...state, deliveryPaused: undefined, banner: state.deliveryPending === "source" ? "cancelled" : undefined });
				renderWidget(ctx.ui);
				scheduleDelivery(ctx.ui);
			} catch (error) {
				pauseDelivery(ctx.ui, `Deferred delivery retry could not be checkpointed: ${errorMessage(error)}.`);
			}
		},
		retryWriting,
		retryReadiness: (ctx) => {
			if (readinessTimer) clearTimeout(readinessTimer);
			readinessTimer = undefined;
			activeReadiness = undefined;
			readinessOutcome = undefined;
			newPendingState();
			dispatchInitialReadiness(ctx);
		},
		retryTransition: (ctx) => {
			const handoff = state.handoff;
			if (!handoff || handoff.status !== "ready") return;
			queueSessionTransition(pi, handoff.token);
			renderWidget(ctx.ui);
		},
		cancel: async (ctx) => {
			if (!state.handoff && !transitionInProgress && state.deliveryPending === "replacement") {
				ctx.ui.notify("The source session has already been replaced. Deferred prompts remain in this session; run /sh recover to resume them.", "warning");
				return;
			}
			const handoff = state.handoff;
			const token = handoff && "token" in handoff ? handoff.token : undefined;
			const activated = handoff?.status === "writing" || handoff?.status === "ready" || handoff?.status === "transitioning" || transitionInProgress;
			transitionInProgress = false;
			ownSessionSwitch = false;
			if (activated) ctx.abort();
			clearTimers();
			activeReadiness = undefined;
			readinessOutcome = undefined;
			activeWritingId = undefined;
			writerEndedId = undefined;
			restoreWriterTools();
			try {
				persistState({
					...state,
					handoff: undefined,
					deliveryPending: state.deferredPrompts.length > 0 ? "source" : undefined,
					deliveryPaused: undefined,
					automaticHandoffSuppressed: true,
					banner: "cancelled",
				});
				if (replacementTransfer) replacementTransfer.cancelled = true;
			} catch (error) {
				ctx.ui.notify(`Cancellation could not be checkpointed: ${errorMessage(error)}. Deferred prompts were not sent; run /sh cancel again.`, "error");
				renderWidget(ctx.ui);
				return;
			}
			if (token) {
				try {
					await cleanupHandoff(token);
				} catch (error) {
					state = { ...state, cleanupToken: token };
					persist();
					ctx.ui.notify(`Session Handoff was cancelled, but private cleanup failed: ${errorMessage(error)} Run /sh cleanup to retry.`, "error");
				}
			}
			renderWidget(ctx.ui);
			if (state.deliveryPending === "source") scheduleDelivery(ctx.ui);
			const deferred = state.deferredPrompts.length > 0
				? ` Returning ${state.deferredPrompts.length} deferred prompts to the source session in FIFO order.`
				: "";
			ctx.ui.notify(`Session Handoff Cancelled. Late readiness or submission responses are invalid.${deferred}`, "error");
		},
		start: async (ctx) => { startHandoff(ctx); },
	});

	registerTransition(pi, {
		getState: () => state,
		beginReplacementTransfer: () => {
			replacementTransfer = { state, cancelled: false };
			return replacementTransfer;
		},
		commit: (nextState, ui) => {
			persistState(nextState);
			renderWidget(ui);
		},
		isTransitioning: () => transitionInProgress,
		setTransitioning: (value) => { transitionInProgress = value; },
		setOwnSessionSwitch: (value) => { ownSessionSwitch = value; },
		getActiveWritingId: () => activeWritingId,
		setActiveWritingId: (value) => { activeWritingId = value; },
		restoreWriterTools,
	});
}
