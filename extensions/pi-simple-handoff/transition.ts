import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildContinuationPrompt, MAX_HANDOFF_BYTES } from "./core.ts";
import { cleanupHandoff, readValidatedHandoff, writeValidatedHandoff } from "./filesystem.ts";
import { STATE_ENTRY, type ExtensionState } from "./state.ts";

export const OPEN_COMMAND = "session-handoff-open-new";
export const DELIVERY_COMMAND = "session-handoff-deliver-next";

type Ui = ExtensionContext["ui"];

export type ReplacementTransfer = { state: ExtensionState; cancelled: boolean };

export type TransitionController = {
	getState(): ExtensionState;
	beginReplacementTransfer(): ReplacementTransfer;
	commit(state: ExtensionState, ui: Ui): void;
	isTransitioning(): boolean;
	setTransitioning(value: boolean): void;
	setOwnSessionSwitch(value: boolean): void;
	getActiveWritingId(): string | undefined;
	setActiveWritingId(value: string | undefined): void;
	restoreWriterTools(): void;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function replacementState(source: ExtensionState, overrides: Partial<ExtensionState>): ExtensionState {
	return {
		warnedAtWarning: false,
		automaticHandoffSuppressed: false,
		deferredPrompts: source.deferredPrompts.map((prompt) => ({
			...prompt,
			...(prompt.images ? { images: prompt.images.map((image) => ({ ...image })) } : {}),
		})),
		nextDeferredSequence: source.nextDeferredSequence,
		...overrides,
	};
}

async function persistReplacement(
	ctx: { sendMessage: (message: { customType: string; content: never[]; display: boolean; details: ExtensionState }, options: { triggerTurn: boolean }) => Promise<void> },
	state: ExtensionState,
): Promise<void> {
	await ctx.sendMessage({ customType: STATE_ENTRY, content: [], display: false, details: state }, { triggerTurn: false });
}

export function queueSessionTransition(pi: ExtensionAPI, token: string): void {
	pi.sendUserMessage(`/${OPEN_COMMAND} ${token}`, { deliverAs: "followUp", expandPromptTemplates: true });
}

export function registerTransition(pi: ExtensionAPI, controller: TransitionController): void {
	pi.registerTool({
		name: "submit_session_handoff",
		label: "Submit Session Handoff",
		description: "Deliver the complete structured Markdown handoff to pi-simple-handoff. The extension validates the current submission ID and owns all temporary-file creation, serving, and deletion.",
		parameters: Type.Object({
			id: Type.String({ description: "Exact submission ID from the current handoff prompt" }),
			content: Type.String({ maxLength: MAX_HANDOFF_BYTES, description: "Complete structured Markdown handoff" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const handoff = controller.getState().handoff;
			if (!handoff || handoff.status !== "writing" || handoff.submitId !== params.id || controller.getActiveWritingId() !== params.id) {
				throw new Error("Stale or unknown handoff submission ID. No file was written.");
			}
			await writeValidatedHandoff(handoff.token, params.content);
			const current = controller.getState();
			if (current.handoff?.status !== "writing" || current.handoff.submitId !== params.id) {
				await cleanupHandoff(handoff.token).catch(() => undefined);
				throw new Error("The handoff was cancelled before submission completed.");
			}
			controller.setActiveWritingId(undefined);
			controller.restoreWriterTools();
			controller.commit({ ...current, handoff: { status: "ready", token: handoff.token } }, ctx.ui);
			let queued = true;
			try {
				queueSessionTransition(pi, handoff.token);
			} catch (error) {
				queued = false;
				ctx.ui.notify(`The handoff was stored, but the session switch could not be queued: ${errorMessage(error)} Run /sh retry.`, "error");
			}
			return {
				content: [{ type: "text", text: queued
					? "The handoff was accepted and stored by the extension. The fresh-session transition is queued."
					: "The handoff was accepted and stored by the extension. The fresh-session transition needs /sh retry." }],
				details: { accepted: true, queued },
				terminate: true,
			};
		},
	});

	pi.registerCommand(OPEN_COMMAND, {
		description: "Open the fresh session after a validated handoff",
		handler: async (args, ctx) => {
			const token = args.trim();
			const sourceState = controller.getState();
			if (controller.isTransitioning() || sourceState.handoff?.status !== "ready" || sourceState.handoff.token !== token) {
				ctx.ui.notify("No matching completed context handoff is available.", "error");
				return;
			}
			let handoff: string;
			try {
				handoff = await readValidatedHandoff(token);
			} catch (error) {
				const hasDeferredPrompts = sourceState.deferredPrompts.length > 0;
				controller.commit({
					...sourceState,
					handoff: undefined,
					cleanupToken: token,
					banner: "error",
					...(hasDeferredPrompts ? { deliveryPending: "source", deliveryPaused: true } : {}),
				}, ctx.ui);
				ctx.ui.notify(`Could not open the validated handoff: ${errorMessage(error)} The artifact was preserved; run /sh cleanup after inspection.${hasDeferredPrompts ? " Deferred prompts remain recoverable with /sh recover." : ""}`, "error");
				return;
			}

			const sourceSessionPath = ctx.sessionManager.getSessionFile();
			controller.setTransitioning(true);
			const transfer = controller.beginReplacementTransfer();
			controller.setOwnSessionSwitch(true);
			let replacementStarted = false;
			let setupState: ExtensionState | undefined;
			let setupError: unknown;
			try {
				const result = await ctx.newSession({
					...(sourceSessionPath ? { parentSession: sourceSessionPath } : {}),
					setup: async (sessionManager) => {
						replacementStarted = true;
						const latest = transfer.state;
						const cancelled = transfer.cancelled;
						const base = replacementState(latest, {
							handoff: undefined,
							cleanupToken: token,
							deliveryPending: undefined,
							deliveryPaused: undefined,
							...(cancelled ? { banner: "cancelled" } : {}),
						});
						try {
							sessionManager.appendCustomEntry(STATE_ENTRY, base);
							if (!cancelled) {
								sessionManager.appendMessage({
									role: "user",
									content: [{ type: "text", text: buildContinuationPrompt(handoff) }],
									timestamp: Date.now(),
								});
							}
							setupState = {
								...base,
								...(cancelled && base.deferredPrompts.length === 0
									? {}
									: { deliveryPending: "replacement" as const }),
							};
							sessionManager.appendCustomEntry(STATE_ENTRY, setupState);
						} catch (error) {
							setupError = error;
							const hasDeferredPrompts = base.deferredPrompts.length > 0;
							setupState = {
								...base,
								banner: "error",
								...(hasDeferredPrompts ? { deliveryPending: "replacement", deliveryPaused: true } : {}),
							};
							try { sessionManager.appendCustomEntry(STATE_ENTRY, setupState); } catch { /* withSession persists the failure when possible */ }
						}
					},
					withSession: async (replacementCtx) => {
						const fallbackHasDeferredPrompts = sourceState.deferredPrompts.length > 0;
						let current = setupState ?? replacementState(sourceState, {
							handoff: undefined,
							cleanupToken: token,
							banner: "error",
							...(fallbackHasDeferredPrompts ? { deliveryPending: "replacement", deliveryPaused: true } : {}),
						});
						try {
							// This custom message activates recovery in the replacement extension instance.
							// Delivery itself is owned by that instance's private command handler.
							await persistReplacement(replacementCtx, current);
						} catch (error) {
							replacementCtx.ui.notify(`The replacement recovery state could not be checkpointed: ${errorMessage(error)} Restart the replacement session to retry its persisted state.`, "error");
							return;
						}
						try {
							await cleanupHandoff(token);
							current = { ...current, cleanupToken: undefined };
							try {
								await persistReplacement(replacementCtx, current);
							} catch (error) {
								replacementCtx.ui.notify(`Private cleanup completed, but its checkpoint failed: ${errorMessage(error)} Restarting may retry the already-idempotent cleanup.`, "error");
							}
						} catch (error) {
							replacementCtx.ui.notify(`Private handoff cleanup failed: ${errorMessage(error)} Run /sh cleanup to retry.`, "error");
						}
						if (setupError) {
							replacementCtx.ui.notify(`The handoff replacement could not be initialized: ${errorMessage(setupError)} No continuation was started.${current.deliveryPending ? " Deferred prompts remain recoverable with /sh recover." : ""}`, "error");
							return;
						}
						if (!current.deliveryPending) {
							replacementCtx.ui.notify("Session Handoff Cancelled during the session switch. No automatic continuation was started.", "error");
						}
					},
				});
				if (replacementStarted) return;
				controller.setOwnSessionSwitch(false);
				if (!controller.isTransitioning() || !result.cancelled) return;
				controller.setTransitioning(false);
				controller.commit({ ...sourceState, handoff: { status: "ready", token } }, ctx.ui);
				ctx.ui.notify("The session switch was cancelled. Run /sh retry or /sh cancel.", "warning");
			} catch {
				// Once newSession() has been invoked, Pi may already have invalidated every
				// source-session API even when replacement setup never starts. The durable
				// source state deliberately remains `ready`, so reopening it can retry safely.
				controller.setOwnSessionSwitch(false);
				controller.setTransitioning(false);
			}
		},
	});
}
