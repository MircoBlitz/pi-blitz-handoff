import type { ExtensionState } from "./state.ts";

export type HandoffWidgetColor = "warning" | "success" | "error";

export type HandoffWidget = {
	color: HandoffWidgetColor;
	text: string;
};

export type HandoffWidgetProgress = {
	readinessCheckActive: boolean;
	continueInSeconds?: number | undefined;
	writerRetryInSeconds?: number | undefined;
};

const SEPARATOR = " · ";

function withDeferred(status: string, count: number): string {
	return count > 0 ? `${status}${SEPARATOR}Deferred prompts: ${count}` : status;
}

function running(stage: string, step: number, status: string, deferredCount = 0): HandoffWidget {
	return {
		color: "warning",
		text: ["Session Handoff Running", `${stage} (${step}/7)`, withDeferred(status, deferredCount)].join(SEPARATOR),
	};
}

export function handoffWidget(
	state: ExtensionState,
	progress: HandoffWidgetProgress = { readinessCheckActive: false },
): HandoffWidget | undefined {
	const deferredCount = state.deferredPrompts.length;
	if (state.handoff?.status === "pending") {
		const seconds = progress.continueInSeconds;
		if (progress.readinessCheckActive) return running("Checking readiness", 2, "Readiness check running", deferredCount);
		return running("Preparing readiness check", 1, seconds === undefined ? "Starting readiness check" : `Continue in ${seconds}s`, deferredCount);
	}
	if (state.handoff?.status === "writing") {
		if (state.handoff.paused) {
			return running("Writing focused context", 3, `Writer paused after ${state.handoff.attempt} attempts; run /sh retry or /sh cancel`, deferredCount);
		}
		const retry = progress.writerRetryInSeconds;
		const status = retry === undefined
			? `Creating handoff (attempt ${state.handoff.attempt})`
			: `Writer retry in ${retry}s`;
		return running("Writing focused context", 3, status, deferredCount);
	}
	if (state.handoff?.status === "ready") return running("Handoff validated", 4, "Opening fresh session", deferredCount);
	if (state.handoff?.status === "transitioning") return running("Opening fresh session", 5, "Switching session", deferredCount);
	if (state.deliveryPending) return running(
		"Deliver deferred prompts",
		6,
		state.deliveryPaused
			? "Delivery paused; run /sh recover"
			: deferredCount > 0 ? "Delivering FIFO turns" : "Starting continuation",
		deferredCount,
	);
	if (state.banner === "finished" && state.cleanupToken) return running("Finalizing fresh session", 7, "Cleaning private artifact", deferredCount);
	if (state.banner === "finished") return { color: "success", text: ["Session Handoff Finished", "Complete (7/7)"].join(SEPARATOR) };
	if (state.banner === "cancelled") return { color: "error", text: withDeferred("Session Handoff Cancelled", deferredCount) };
	if (state.banner === "error") return { color: "error", text: withDeferred("Session Handoff Error", deferredCount) };
	if (deferredCount > 0) return { color: "warning", text: `Deferred prompts: ${deferredCount}` };
	return undefined;
}
