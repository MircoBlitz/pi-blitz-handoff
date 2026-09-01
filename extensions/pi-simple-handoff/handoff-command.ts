import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionState } from "./state.ts";

export type HandoffCommandController = {
	getState(): ExtensionState;
	isTransitioning(): boolean;
	retryCleanup(ctx: ExtensionCommandContext): Promise<void>;
	retryDelivery(ctx: ExtensionCommandContext): void;
	retryWriting(ctx: ExtensionCommandContext): Promise<void>;
	retryReadiness(ctx: ExtensionCommandContext): void;
	retryTransition(ctx: ExtensionCommandContext): void;
	cancel(ctx: ExtensionCommandContext): Promise<void>;
	start(ctx: ExtensionCommandContext): Promise<void>;
};

export function registerHandoffCommand(pi: ExtensionAPI, controller: HandoffCommandController): void {
	pi.registerCommand("sh", {
		description: "Start, retry, recover, cancel, or clean up a focused context handoff",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			const state = controller.getState();
			if (action === "cleanup") {
				if (!state.cleanupToken) ctx.ui.notify("No private handoff cleanup is pending.", "info");
				else await controller.retryCleanup(ctx);
				return;
			}
			if (action === "retry") {
				if (state.deliveryPending) ctx.ui.notify("Deferred prompt delivery uses /sh recover.", "warning");
				else if (state.handoff?.status === "writing") await controller.retryWriting(ctx);
				else if (state.handoff?.status === "pending") controller.retryReadiness(ctx);
				else if (state.handoff?.status === "ready") controller.retryTransition(ctx);
				else ctx.ui.notify("No handoff step is waiting for a retry.", "warning");
				return;
			}
			if (action === "recover") {
				if (!state.deliveryPending) ctx.ui.notify("No deferred prompt delivery is waiting for recovery.", "warning");
				else controller.retryDelivery(ctx);
				return;
			}
			if (action === "cancel") {
				if (!state.handoff && !controller.isTransitioning() && !state.deliveryPending && state.deferredPrompts.length === 0) {
					ctx.ui.notify("No active or deferred handoff work can be cancelled.", "warning");
					return;
				}
				await controller.cancel(ctx);
				return;
			}
			if (action) {
				ctx.ui.notify("Usage: /sh, /sh retry, /sh recover, /sh cancel, or /sh cleanup.", "warning");
				return;
			}
			if (state.handoff || controller.isTransitioning() || state.cleanupToken || state.deliveryPending || state.deferredPrompts.length > 0) {
				ctx.ui.notify(state.cleanupToken
					? "Private handoff cleanup is still pending. Run /sh cleanup before starting another handoff."
					: state.deliveryPending
						? "Deferred prompt delivery is pending. Use /sh recover or /sh cancel."
						: "A handoff is already running. Use /sh retry or /sh cancel.", "warning");
				return;
			}
			await controller.start(ctx);
		},
	});
}
