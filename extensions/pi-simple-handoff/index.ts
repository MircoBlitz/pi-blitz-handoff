import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	buildContinuationPrompt,
	buildHandoffCreationPrompt,
	formatWarning,
	handoffPath,
	makeHandoffToken,
	validateThresholds,
	warningLevel,
} from "./core.ts";
import { HANDOFF_THRESHOLDS } from "./config.ts";

const STATE_ENTRY = "pi-simple-handoff-state";
const OPEN_COMMAND = "session-handoff-open-new";

type HandoffJob = {
	token: string;
	path: string;
	sourceSessionPath?: string;
	status: "writing" | "ready";
};

type ExtensionState = {
	version: 5;
	warnedAtWarning: boolean;
	handoff?: HandoffJob;
};

const DEFAULT_STATE: ExtensionState = {
	version: 5,
	warnedAtWarning: false,
};

function parseHandoff(value: unknown): HandoffJob | undefined {
	if (!value || typeof value !== "object") return undefined;
	const handoff = value as Record<string, unknown>;
	if (
		typeof handoff.token !== "string" ||
		typeof handoff.path !== "string" ||
		(handoff.sourceSessionPath !== undefined && typeof handoff.sourceSessionPath !== "string") ||
		(handoff.status !== "writing" && handoff.status !== "ready")
	) {
		return undefined;
	}
	return {
		token: handoff.token,
		path: handoff.path,
		...(typeof handoff.sourceSessionPath === "string" ? { sourceSessionPath: handoff.sourceSessionPath } : {}),
		status: handoff.status,
	};
}

function restoreState(entries: readonly unknown[]): ExtensionState {
	let state = { ...DEFAULT_STATE };
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as {
			type?: unknown;
			customType?: unknown;
			data?: Record<string, unknown>;
		};
		if (candidate.type !== "custom" || candidate.customType !== STATE_ENTRY || !candidate.data) continue;
		state = {
			version: 5,
			warnedAtWarning: candidate.data.warnedAtWarning === true,
			...(candidate.data.version === 5 && parseHandoff(candidate.data.handoff)
				? { handoff: parseHandoff(candidate.data.handoff) }
				: {}),
		};
	}
	return state;
}

async function fileIsReady(path: string): Promise<boolean> {
	try {
		const metadata = await stat(path);
		return metadata.isFile() && Boolean((await readFile(path, "utf8")).trim());
	} catch {
		return false;
	}
}

export default function simpleHandoffExtension(pi: ExtensionAPI) {
	const thresholds = validateThresholds(HANDOFF_THRESHOLDS);
	let state: ExtensionState = { ...DEFAULT_STATE };
	const persist = () => pi.appendEntry(STATE_ENTRY, state);
	const autonomousGuidance = `During explicitly user-authorized autonomous work, choose your own handoff cutoff between ${thresholds.warningThreshold}% and ${thresholds.criticalThreshold}% context usage. Use session_handoff status to monitor usage, and start the handoff at your chosen cutoff without waiting for the user. Never infer autonomous permission merely from a long task.`;

	pi.on("session_start", (_event, ctx) => {
		state = restoreState(ctx.sessionManager.getBranch());
	});

	pi.on("session_before_compact", () => {
		if (state.handoff) return { cancel: true };
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (state.handoff?.status === "writing") {
			const { token, path, sourceSessionPath } = state.handoff;
			if (!(await fileIsReady(path))) {
				state = { ...state, handoff: undefined };
				persist();
				ctx.ui.notify("Handoff failed: the context handoff is missing or empty.", "error");
				return;
			}

			state = {
				...state,
				handoff: {
					token,
					path,
					...(sourceSessionPath ? { sourceSessionPath } : {}),
					status: "ready",
				},
			};
			persist();
			pi.sendUserMessage(`/${OPEN_COMMAND} ${token}`, {
				deliverAs: "followUp",
				expandPromptTemplates: true,
			});
			return;
		}

		if (!ctx.hasUI) return;
		const percent = ctx.getContextUsage()?.percent ?? null;
		const level = warningLevel(percent, state.warnedAtWarning, thresholds);
		if (!level || percent === null) return;

		if (!state.warnedAtWarning) {
			state = { ...state, warnedAtWarning: true };
			persist();
		}
		ctx.ui.notify(formatWarning(percent, level), level);
	});

	pi.registerTool({
		name: "session_handoff",
		label: "Session Handoff",
		description: `Inspect context usage or start pi-simple-handoff's focused handoff into a genuinely fresh session. The configured handoff window is ${thresholds.warningThreshold}% to ${thresholds.criticalThreshold}%. ${autonomousGuidance} Outside explicitly authorized autonomous work, start only when the user requests it.`,
		promptSnippet: `Inspect context usage or start a focused fresh-session handoff (${thresholds.warningThreshold}–${thresholds.criticalThreshold}% window)`,
		promptGuidelines: [autonomousGuidance],
		parameters: Type.Object({
			action: StringEnum(["status", "start"] as const, {
				description: "Check current usage and configured thresholds, or queue the handoff now",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const percent = ctx.getContextUsage()?.percent ?? null;
			if (params.action === "status") {
				const usage = percent === null ? "unavailable" : `${percent.toFixed(1)}%`;
				return {
					content: [{
						type: "text",
						text: `Current context usage: ${usage}. Configured handoff window: ${thresholds.warningThreshold}% to ${thresholds.criticalThreshold}%.`,
					}],
					details: { percent, ...thresholds },
				};
			}

			if (state.handoff) {
				return {
					content: [{ type: "text", text: "A handoff is already in progress." }],
					details: { queued: false, percent, ...thresholds },
				};
			}

			pi.sendUserMessage("/handoff", {
				deliverAs: "followUp",
				expandPromptTemplates: true,
			});
			return {
				content: [{ type: "text", text: "Queued /handoff. Stop current work and let the handoff flow continue." }],
				details: { queued: true, percent, ...thresholds },
			};
		},
	});

	pi.registerCommand("handoff", {
		description: "Write a focused context handoff and continue in a fresh session",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();
			if (state.handoff) {
				ctx.ui.notify("A handoff is already in progress.", "warning");
				return;
			}

			const token = makeHandoffToken(ctx.sessionManager.getSessionId());
			const path = handoffPath(ctx.cwd, token);
			const sourceSessionPath = ctx.sessionManager.getSessionFile();
			await mkdir(dirname(path), { recursive: true });
			state = {
				...state,
				handoff: {
					token,
					path,
					...(sourceSessionPath ? { sourceSessionPath } : {}),
					status: "writing",
				},
			};
			persist();
			pi.sendUserMessage(buildHandoffCreationPrompt(path, sourceSessionPath));
		},
	});

	pi.registerCommand(OPEN_COMMAND, {
		description: "Open the fresh session after a completed handoff",
		handler: async (args, ctx) => {
			const token = args.trim();
			if (!state.handoff || state.handoff.status !== "ready" || state.handoff.token !== token) {
				ctx.ui.notify("No matching completed context handoff is available.", "error");
				return;
			}

			const { path, sourceSessionPath } = state.handoff;
			const continuationPrompt = buildContinuationPrompt(path);
			const result = await ctx.newSession({
				parentSession: sourceSessionPath,
				withSession: async (replacementCtx) => {
					await replacementCtx.sendUserMessage(continuationPrompt);
				},
			});
			if (!result.cancelled) return;

			state = { ...state, handoff: undefined };
			persist();
			ctx.ui.notify("The automatic session switch was cancelled.", "warning");
		},
	});
}
