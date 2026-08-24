import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	MAX_HANDOFF_BYTES,
	SESSION_HANDOFF_FILE_NAME,
	buildContinuationPrompt,
	buildHandoffCreationPrompt,
	formatWarning,
	handoffDirectory,
	handoffPath,
	isHandoffTokenForSession,
	isValidHandoffContent,
	makeHandoffToken,
	validateThresholds,
	warningLevel,
} from "./core.ts";
import { HANDOFF_THRESHOLDS } from "./config.ts";

const STATE_ENTRY = "pi-simple-handoff-state";
const OPEN_COMMAND = "session-handoff-open-new";

type HandoffJob = {
	token: string;
	status: "writing" | "ready" | "transitioning";
};

type ExtensionState = {
	version: 1;
	warnedAtWarning: boolean;
	handoff?: HandoffJob;
};

const DEFAULT_STATE: ExtensionState = {
	version: 1,
	warnedAtWarning: false,
};

function parseHandoff(value: unknown, sessionId: string): HandoffJob | undefined {
	if (!value || typeof value !== "object") return undefined;
	const handoff = value as Record<string, unknown>;
	if (
		typeof handoff.token !== "string" ||
		!isHandoffTokenForSession(handoff.token, sessionId) ||
		(handoff.status !== "writing" && handoff.status !== "ready" && handoff.status !== "transitioning")
	) {
		return undefined;
	}
	return { token: handoff.token, status: handoff.status };
}

function restoreState(entries: readonly unknown[], sessionId: string): ExtensionState {
	let state = { ...DEFAULT_STATE };
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry as {
			type?: unknown;
			customType?: unknown;
			data?: Record<string, unknown>;
		};
		if (candidate.type !== "custom" || candidate.customType !== STATE_ENTRY || !candidate.data) continue;
		const handoff = candidate.data.version === 1 ? parseHandoff(candidate.data.handoff, sessionId) : undefined;
		state = {
			version: 1,
			warnedAtWarning: candidate.data.warnedAtWarning === true,
			...(handoff ? { handoff } : {}),
		};
	}
	return state;
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function isPrivateDirectory(metadata: Awaited<ReturnType<typeof lstat>>): boolean {
	return metadata.isDirectory() && !metadata.isSymbolicLink() && (BigInt(metadata.mode) & 0o077n) === 0n;
}

async function createPrivateHandoffDirectory(token: string): Promise<void> {
	const directory = handoffDirectory(token);
	await mkdir(directory, { mode: 0o700 });
	if (!isPrivateDirectory(await lstat(directory))) {
		throw new Error("Handoff directory is not a private regular directory.");
	}
}

async function readValidatedHandoff(token: string): Promise<string> {
	const directory = handoffDirectory(token);
	const directoryMetadata = await lstat(directory);
	if (!isPrivateDirectory(directoryMetadata)) {
		throw new Error("Handoff directory is not a private regular directory.");
	}

	const handle = await open(handoffPath(token), constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_HANDOFF_BYTES) {
			throw new Error("Handoff file is missing, unsafe, empty, or too large.");
		}

		const buffer = Buffer.alloc(MAX_HANDOFF_BYTES + 1);
		let bytesRead = 0;
		while (bytesRead < buffer.length) {
			const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
			if (result.bytesRead === 0) break;
			bytesRead += result.bytesRead;
		}
		if (bytesRead > MAX_HANDOFF_BYTES) throw new Error("Handoff file is too large.");

		const currentDirectoryMetadata = await lstat(directory);
		if (
			!isPrivateDirectory(currentDirectoryMetadata) ||
			currentDirectoryMetadata.dev !== directoryMetadata.dev ||
			currentDirectoryMetadata.ino !== directoryMetadata.ino
		) {
			throw new Error("Handoff directory changed while it was being read.");
		}

		const content = buffer.subarray(0, bytesRead).toString("utf8");
		if (!isValidHandoffContent(content)) {
			throw new Error("Handoff file is incomplete or malformed.");
		}
		return content;
	} finally {
		await handle.close();
	}
}

async function cleanupHandoff(token: string): Promise<void> {
	const directory = handoffDirectory(token);
	let directoryMetadata: Awaited<ReturnType<typeof lstat>>;
	try {
		directoryMetadata = await lstat(directory);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return;
		throw error;
	}

	if (directoryMetadata.isSymbolicLink()) {
		await unlink(directory);
		return;
	}
	if (!isPrivateDirectory(directoryMetadata)) return;

	const quarantine = `${directory}-cleanup-${randomUUID()}`;
	await rename(directory, quarantine);
	const quarantinedMetadata = await lstat(quarantine);
	if (
		!isPrivateDirectory(quarantinedMetadata) ||
		quarantinedMetadata.dev !== directoryMetadata.dev ||
		quarantinedMetadata.ino !== directoryMetadata.ino
	) {
		return;
	}

	const path = `${quarantine}/${SESSION_HANDOFF_FILE_NAME}`;
	const isolatedFile = `${directory}-file-cleanup-${randomUUID()}`;
	let movedFile = false;
	try {
		await rename(path, isolatedFile);
		movedFile = true;
	} catch (error) {
		if (errorCode(error) !== "ENOENT") throw error;
	}

	if (movedFile) {
		const currentQuarantineMetadata = await lstat(quarantine);
		if (
			!isPrivateDirectory(currentQuarantineMetadata) ||
			currentQuarantineMetadata.dev !== directoryMetadata.dev ||
			currentQuarantineMetadata.ino !== directoryMetadata.ino
		) {
			await rename(isolatedFile, path).catch(() => undefined);
			return;
		}
		const metadata = await lstat(isolatedFile);
		if (metadata.isFile() || metadata.isSymbolicLink()) await unlink(isolatedFile);
	}

	try {
		await rmdir(quarantine);
	} catch (error) {
		if (errorCode(error) !== "ENOTEMPTY") throw error;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default function simpleHandoffExtension(pi: ExtensionAPI) {
	const thresholds = validateThresholds(HANDOFF_THRESHOLDS);
	let state: ExtensionState = { ...DEFAULT_STATE };
	let transitionInProgress = false;
	const persist = () => pi.appendEntry(STATE_ENTRY, state);
	const clearHandoff = () => {
		const { handoff: _handoff, ...clearedState } = state;
		state = clearedState;
		persist();
	};
	const autonomousGuidance = `During explicitly user-authorized autonomous work, choose your own handoff cutoff between ${thresholds.warningThreshold}% and ${thresholds.criticalThreshold}% context usage. Use session_handoff status to monitor usage, and start the handoff at your chosen cutoff without waiting for the user. Never infer autonomous permission merely from a long task.`;
	const advanceHandoff = async (ctx: { ui: { notify(message: string, level: "error"): void } }) => {
		if (!state.handoff) return false;
		const { token } = state.handoff;
		try {
			await readValidatedHandoff(token);
			if (state.handoff.status !== "ready") {
				state = { ...state, handoff: { token, status: "ready" } };
				persist();
			}
			pi.sendUserMessage(`/${OPEN_COMMAND} ${token}`, {
				deliverAs: "followUp",
				expandPromptTemplates: true,
			});
		} catch (error) {
			await cleanupHandoff(token).catch(() => undefined);
			clearHandoff();
			ctx.ui.notify(`Handoff failed: ${errorMessage(error)}`, "error");
		}
		return true;
	};

	pi.on("session_start", async (_event, ctx) => {
		state = restoreState(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId());
		transitionInProgress = false;
		await advanceHandoff(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (transitionInProgress) return;
		const token = state.handoff?.token;
		if (!token) return;
		await cleanupHandoff(token).catch(() => undefined);
		clearHandoff();
	});

	pi.on("session_before_compact", () => {
		if (state.handoff || transitionInProgress) return { cancel: true };
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (await advanceHandoff(ctx)) return;

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

			if (state.handoff || transitionInProgress) {
				return {
					content: [{ type: "text", text: "A handoff is already in progress." }],
					details: { queued: false, percent, ...thresholds },
				};
			}

			pi.sendUserMessage("/simplehandoff", {
				deliverAs: "followUp",
				expandPromptTemplates: true,
			});
			return {
				content: [{ type: "text", text: "Queued /simplehandoff. Stop current work and let the handoff flow continue." }],
				details: { queued: true, percent, ...thresholds },
			};
		},
	});

	const registerHandoffCommand = (name: string, description: string) => {
		pi.registerCommand(name, {
			description,
			handler: async (_args, ctx) => {
				await ctx.waitForIdle();
				if (state.handoff || transitionInProgress) {
					ctx.ui.notify("A handoff is already in progress.", "warning");
					return;
				}

				const token = makeHandoffToken(ctx.sessionManager.getSessionId());
				state = { ...state, handoff: { token, status: "writing" } };
				persist();

				try {
					await createPrivateHandoffDirectory(token);
					pi.sendUserMessage(buildHandoffCreationPrompt(handoffPath(token), ctx.sessionManager.getSessionFile()));
				} catch (error) {
					await cleanupHandoff(token).catch(() => undefined);
					clearHandoff();
					ctx.ui.notify(`Could not start handoff: ${errorMessage(error)}`, "error");
				}
			},
		});
	};

	registerHandoffCommand("simplehandoff", "Write a focused context handoff and continue in a fresh session");
	registerHandoffCommand("sh", "Short alias for /simplehandoff");

	pi.registerCommand(OPEN_COMMAND, {
		description: "Open the fresh session after a completed handoff",
		handler: async (args, ctx) => {
			const token = args.trim();
			if (
				transitionInProgress ||
				!state.handoff ||
				state.handoff.status !== "ready" ||
				state.handoff.token !== token ||
				!isHandoffTokenForSession(token, ctx.sessionManager.getSessionId())
			) {
				ctx.ui.notify("No matching completed context handoff is available.", "error");
				return;
			}

			let handoff: string;
			try {
				handoff = await readValidatedHandoff(token);
			} catch (error) {
				await cleanupHandoff(token).catch(() => undefined);
				clearHandoff();
				ctx.ui.notify(`Could not open handoff: ${errorMessage(error)}`, "error");
				return;
			}

			const sourceSessionPath = ctx.sessionManager.getSessionFile();
			const continuationPrompt = buildContinuationPrompt(handoff);
			state = { ...state, handoff: { token, status: "transitioning" } };
			persist();
			transitionInProgress = true;
			let handoffDurableInReplacement = false;

			try {
				const result = await ctx.newSession({
					...(sourceSessionPath ? { parentSession: sourceSessionPath } : {}),
					setup: async (sessionManager) => {
						sessionManager.appendMessage({
							role: "user",
							content: [{ type: "text", text: continuationPrompt }],
							timestamp: Date.now(),
						});
					},
					withSession: async (replacementCtx) => {
						try {
							await replacementCtx.sendUserMessage("Continue the handed-off work now.");
							handoffDurableInReplacement = true;
						} catch (error) {
							replacementCtx.ui.notify(
								"The handoff is preserved above, but automatic continuation failed. Send another message to retry.",
								"error",
							);
							throw error;
						}
					},
				});

				if (result.cancelled) {
					clearHandoff();
					await cleanupHandoff(token);
					ctx.ui.notify("The automatic session switch was cancelled. Run /simplehandoff to try again.", "warning");
				} else {
					await cleanupHandoff(token);
				}
			} catch (error) {
				if (handoffDurableInReplacement) {
					await cleanupHandoff(token).catch(() => undefined);
				} else {
					try {
						state = { ...state, handoff: { token, status: "ready" } };
						persist();
						ctx.ui.notify(`Session handoff failed: ${errorMessage(error)} Run the queued handoff command again to retry.`, "error");
					} catch {
						// The source session can recover its persisted transitioning job when resumed.
					}
				}
			} finally {
				transitionInProgress = false;
			}
		},
	});
}
