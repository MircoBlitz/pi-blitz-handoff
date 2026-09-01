import { isHandoffTokenForSession, isValidHandoffToken } from "./core.ts";

export const STATE_ENTRY = "pi-simple-handoff-state";

export type DeferredPrompt = {
	sequence: number;
	text: string;
	images?: Array<{ type: "image"; data: string; mimeType: string }> | undefined;
};

export type HandoffJob =
	| { status: "pending"; goId: string; waitId: string; retryAt?: number | undefined }
	| {
		status: "writing";
		token: string;
		submitId: string;
		attempt: number;
		totalAttempts: number;
		retryAt?: number | undefined;
		paused?: boolean | undefined;
	}
	| { status: "ready" | "transitioning"; token: string };

export type ExtensionState = {
	warnedAtWarning: boolean;
	automaticHandoffSuppressed: boolean;
	deferredPrompts: DeferredPrompt[];
	nextDeferredSequence: number;
	handoff?: HandoffJob | undefined;
	cleanupToken?: string | undefined;
	deliveryPending?: "replacement" | "source" | undefined;
	deliveryPaused?: boolean | undefined;
	banner?: "finished" | "cancelled" | "error" | undefined;
};

export const DEFAULT_STATE: ExtensionState = {
	warnedAtWarning: false,
	automaticHandoffSuppressed: false,
	deferredPrompts: [],
	nextDeferredSequence: 1,
};

function validId(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9-]{16,64}$/.test(value);
}

function validPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function validRetryAt(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseHandoff(value: unknown, sessionId: string): HandoffJob | undefined {
	if (!value || typeof value !== "object") return undefined;
	const handoff = value as Record<string, unknown>;
	if (handoff.status === "pending") {
		if (!validId(handoff.goId) || !validId(handoff.waitId) || handoff.goId === handoff.waitId) return undefined;
		return {
			status: "pending",
			goId: handoff.goId,
			waitId: handoff.waitId,
			...(validRetryAt(handoff.retryAt) ? { retryAt: handoff.retryAt } : {}),
		};
	}
	if (handoff.status !== "writing" && handoff.status !== "ready" && handoff.status !== "transitioning") return undefined;
	if (typeof handoff.token !== "string" || !isHandoffTokenForSession(handoff.token, sessionId)) return undefined;
	if (handoff.status === "writing") {
		if (!validId(handoff.submitId)) return undefined;
		const attempt = validPositiveInteger(handoff.attempt) ? handoff.attempt : 1;
		const totalAttempts = validPositiveInteger(handoff.totalAttempts) ? handoff.totalAttempts : attempt;
		return {
			status: "writing",
			token: handoff.token,
			submitId: handoff.submitId,
			attempt,
			totalAttempts,
			...(validRetryAt(handoff.retryAt) ? { retryAt: handoff.retryAt } : {}),
			...(handoff.paused === true ? { paused: true } : {}),
		};
	}
	return { status: handoff.status, token: handoff.token };
}

function parseDeferredPrompts(value: unknown): DeferredPrompt[] {
	if (!Array.isArray(value)) return [];
	const prompts: DeferredPrompt[] = [];
	let previousSequence = 0;
	for (const item of value) {
		if (!item || typeof item !== "object") return [];
		const prompt = item as Record<string, unknown>;
		if (!validPositiveInteger(prompt.sequence) || prompt.sequence <= previousSequence || typeof prompt.text !== "string") return [];
		let images: DeferredPrompt["images"];
		if (prompt.images !== undefined) {
			if (!Array.isArray(prompt.images)) return [];
			images = [];
			for (const image of prompt.images) {
				if (!image || typeof image !== "object") return [];
				const candidate = image as Record<string, unknown>;
				if (candidate.type !== "image" || typeof candidate.data !== "string" || typeof candidate.mimeType !== "string") return [];
				images.push({ type: "image", data: candidate.data, mimeType: candidate.mimeType });
			}
		}
		prompts.push({ sequence: prompt.sequence, text: prompt.text, ...(images?.length ? { images } : {}) });
		previousSequence = prompt.sequence;
	}
	return prompts;
}

export function restoreState(entries: readonly unknown[], sessionId: string): ExtensionState {
	let state: ExtensionState = { ...DEFAULT_STATE, deferredPrompts: [] };
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as { type?: unknown; customType?: unknown; data?: Record<string, unknown>; details?: Record<string, unknown> };
		const data = candidate.type === "custom" && candidate.customType === STATE_ENTRY
			? candidate.data
			: candidate.type === "custom_message" && candidate.customType === STATE_ENTRY
				? candidate.details
				: undefined;
		if (!data) continue;
		const handoff = parseHandoff(data.handoff, sessionId);
		const deferredPrompts = parseDeferredPrompts(data.deferredPrompts);
		const largestSequence = deferredPrompts.at(-1)?.sequence ?? 0;
		const nextDeferredSequence = validPositiveInteger(data.nextDeferredSequence) && data.nextDeferredSequence > largestSequence
			? data.nextDeferredSequence
			: largestSequence + 1;
		const cleanupToken = typeof data.cleanupToken === "string" && isValidHandoffToken(data.cleanupToken)
			? data.cleanupToken
			: undefined;
		const banner = data.banner === "finished" || data.banner === "cancelled" || data.banner === "error"
			? data.banner
			: undefined;
		state = {
			warnedAtWarning: data.warnedAtWarning === true,
			automaticHandoffSuppressed: data.automaticHandoffSuppressed === true,
			deferredPrompts,
			nextDeferredSequence,
			...(handoff ? { handoff } : {}),
			...(cleanupToken ? { cleanupToken } : {}),
			...(data.deliveryPending === "source" || data.deliveryPending === "replacement"
				? { deliveryPending: data.deliveryPending }
				: data.deliveryPending === true
					? { deliveryPending: "replacement" as const }
					: {}),
			...(data.deliveryPaused === true ? { deliveryPaused: true } : {}),
			...(banner ? { banner } : {}),
		};
	}

	if (state.handoff?.status === "transitioning") {
		// A persisted transitioning state belongs to the source session. If Pi
		// restarts before replacement setup, retry the same validated transition.
		return { ...state, handoff: { status: "ready", token: state.handoff.token } };
	}
	return state;
}
