import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	type Component,
	Container,
	Input,
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
	Text,
} from "@earendil-works/pi-tui";
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
import {
	MIN_AUTOMATIC_HANDOFF_PERCENT,
	loadSimpleHandoffConfig,
	saveSimpleHandoffConfig,
} from "./config.ts";

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
	const config = loadSimpleHandoffConfig();
	const thresholds = validateThresholds({
		warningThreshold: config.kvWarningPercent,
		criticalThreshold: config.selfHandoffPercent,
	});
	const configuredAutomaticHandoffPercent = config.automaticSessionHandoffPercent;
	const automaticHandoffPercent = config.automaticSessionHandoff &&
		configuredAutomaticHandoffPercent >= MIN_AUTOMATIC_HANDOFF_PERCENT
		? configuredAutomaticHandoffPercent
		: 0;
	let state: ExtensionState = { ...DEFAULT_STATE };
	let transitionInProgress = false;
	const persist = () => pi.appendEntry(STATE_ENTRY, state);
	const clearHandoff = () => {
		const { handoff: _handoff, ...clearedState } = state;
		state = clearedState;
		persist();
	};
	const directRequestGuidance = "When the user explicitly requests a handoff by saying 'handoff', 'hand off', 'simple handoff', 'simple hand off', or an equivalent imperative, call simple_handoff with action=start immediately. Do not start a handoff when the user is merely discussing, questioning, testing, or asking to fix handoff behavior.";
	const autonomousGuidance = automaticHandoffPercent === 0
		? `During explicitly user-authorized autonomous work, choose your own handoff cutoff between ${thresholds.warningThreshold}% and ${thresholds.criticalThreshold}% context usage. Use simple_handoff status to monitor usage, and start the handoff at your chosen cutoff without waiting for the user. Never infer autonomous permission merely from a long task.`
		: `Automatic session handoff is globally authorized and handled by pi-simple-handoff at ${automaticHandoffPercent}% context usage. Do not call simple_handoff merely to manage that automatic transition.`;
	const automaticStatus = automaticHandoffPercent === 0
		? "Automatic session handoff is disabled."
		: `Automatic session handoff is enabled at ${automaticHandoffPercent}%.`;
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
			if (state.handoff?.status === "transitioning" && errorCode(error) === "ENOENT") {
				clearHandoff();
				return true;
			}
			await cleanupHandoff(token).catch(() => undefined);
			clearHandoff();
			ctx.ui.notify(`Handoff failed: ${errorMessage(error)}`, "error");
		}
		return true;
	};

	pi.on("session_start", async (_event, ctx) => {
		state = restoreState(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId());
		transitionInProgress = false;
		if (
			ctx.hasUI &&
			configuredAutomaticHandoffPercent > 0 &&
			configuredAutomaticHandoffPercent < MIN_AUTOMATIC_HANDOFF_PERCENT
		) {
			ctx.ui.notify(
				`Automatic Session Handoff is deactivated: ${configuredAutomaticHandoffPercent}% is too low; use 50–100%.`,
				"warning",
			);
		}
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
		if (
			automaticHandoffPercent !== 0 &&
			percent !== null &&
			Number.isFinite(percent) &&
			percent >= automaticHandoffPercent
		) {
			pi.sendUserMessage("/sh", {
				deliverAs: "followUp",
				expandPromptTemplates: true,
			});
			ctx.ui.notify(`Automatic session handoff queued at ${Math.floor(percent)}%.`, "warning");
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

	pi.registerTool({
		name: "simple_handoff",
		label: "Simple Handoff",
		description: `Inspect context usage or start pi-simple-handoff's focused handoff into a genuinely fresh session. Use action=start when the user asks for a handoff, says "handoff", "hand off", "simple handoff", or "simple hand off" as a request. The configured handoff window is ${thresholds.warningThreshold}% to ${thresholds.criticalThreshold}%. ${automaticStatus} ${autonomousGuidance}`,
		promptSnippet: `Run Simple Handoff when the user requests "handoff", "hand off", "simple handoff", or "simple hand off"; status reports context usage and handoff settings`,

		promptGuidelines: [directRequestGuidance, autonomousGuidance],
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
						text: `Current context usage: ${usage}. Configured handoff window: ${thresholds.warningThreshold}% to ${thresholds.criticalThreshold}%. ${automaticStatus}`,
					}],
					details: {
						percent,
						...thresholds,
						automaticSessionHandoffPercent: automaticHandoffPercent,
						automaticSessionHandoff: config.automaticSessionHandoff,
						configuredAutomaticSessionHandoffPercent: configuredAutomaticHandoffPercent,
					},
				};
			}

			if (state.handoff || transitionInProgress) {
				return {
					content: [{ type: "text", text: "A handoff is already in progress." }],
					details: { queued: false, percent, ...thresholds },
				};
			}

			pi.sendUserMessage("/sh", {
				deliverAs: "followUp",
				expandPromptTemplates: true,
			});
			return {
				content: [{ type: "text", text: "Queued /sh. Stop current work and let the handoff flow continue." }],
				details: { queued: true, percent, ...thresholds },
			};
		},
	});

	pi.registerCommand("shconfig", {
		description: "Configure automatic session handoff",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/shconfig requires TUI mode.", "error");
				return;
			}

			const draft = {
				...config,
				automaticSessionHandoffPercent: Math.min(
					100,
					Math.max(MIN_AUTOMATIC_HANDOFF_PERCENT, config.automaticSessionHandoffPercent),
				),
			};
			const shouldSave = await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
				const createNumberEditor = (
					label: string,
					currentValue: string,
					minimum: number,
					maximum: number,
					selectValue: (value?: string) => void,
				): Component => {
					const input = new Input();
					input.handleInput(currentValue);
					const errorText = new Text("", 1, 0);
					input.onSubmit = (value) => {
						const percent = Number(value.trim());
						if (!Number.isFinite(percent) || percent < minimum || percent > maximum) {
							errorText.setText(theme.fg("error", `Enter a number from ${minimum} through ${maximum}.`));
							tui.requestRender();
							return;
						}
						selectValue(String(percent));
					};
					input.onEscape = () => selectValue();
					const editor = new Container();
					editor.addChild(new Text(theme.fg("accent", theme.bold(label)), 1, 1));
					editor.addChild(new Text(theme.fg("dim", `Allowed range: ${minimum}–${maximum}%`), 1, 0));
					editor.addChild(input);
					editor.addChild(errorText);
					editor.addChild(new Text(theme.fg("dim", "enter apply • esc back"), 1, 1));
					return {
						render: (width: number) => editor.render(width),
						invalidate: () => editor.invalidate(),
						handleInput: (data: string) => input.handleInput(data),
					};
				};

				const items: SettingItem[] = [
					{
						id: "kvWarningPercent",
						label: "Context warning",
						description: "Shown once when context usage reaches this percentage.",
						currentValue: String(draft.kvWarningPercent),
						submenu: (value, selectValue) => createNumberEditor("Context warning", value, 1, 100, selectValue),
					},
					{
						id: "selfHandoffPercent",
						label: "Critical warning",
						description: "Shown after every settled turn from this percentage onward.",
						currentValue: String(draft.selfHandoffPercent),
						submenu: (value, selectValue) => createNumberEditor("Critical warning", value, 1, 100, selectValue),
					},
					{
						id: "automaticSessionHandoff",
						label: "Automatic Session Handoff",
						description: "Persistently authorize the extension to start handoffs itself.",
						currentValue: draft.automaticSessionHandoff ? "enabled" : "disabled",
						values: ["enabled", "disabled"],
					},
					{
						id: "automaticSessionHandoffPercent",
						label: "Automatic threshold",
						description: "Start a handoff after a settled turn reaches this percentage.",
						currentValue: String(draft.automaticSessionHandoffPercent),
						submenu: (value, selectValue) => createNumberEditor("Automatic threshold", value, 50, 100, selectValue),
					},
					{
						id: "save",
						label: "Save and reload",
						currentValue: "press enter",
						values: ["press enter"],
					},
					{
						id: "cancel",
						label: "Cancel",
						currentValue: "press enter",
						values: ["press enter"],
					},
				];
				const container = new Container();
				container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Simple Handoff Configuration")), 1, 1));
				const settingsTheme: SettingsListTheme = {
					cursor: theme.fg("accent", "> "),
					label: (text, selected) => selected ? theme.fg("accent", text) : text,
					value: (text, selected) => theme.fg(selected ? "accent" : "muted", text),
					description: (text) => theme.fg("muted", text),
					hint: (text) => theme.fg("dim", text),
				};
				const formError = new Text("", 1, 0);
				const settingsList = new SettingsList(
					items,
					9,
					settingsTheme,
					(id, newValue) => {
						formError.setText("");
						if (id === "kvWarningPercent") draft.kvWarningPercent = Number(newValue);
						else if (id === "selfHandoffPercent") draft.selfHandoffPercent = Number(newValue);
						else if (id === "automaticSessionHandoff") {
							draft.automaticSessionHandoff = newValue === "enabled";
						} else if (id === "automaticSessionHandoffPercent") {
							draft.automaticSessionHandoffPercent = Number(newValue);
						} else if (id === "cancel") done(false);
						else if (id === "save") {
							try {
								validateThresholds({
									warningThreshold: draft.kvWarningPercent,
									criticalThreshold: draft.selfHandoffPercent,
								});
								done(true);
							} catch {
								formError.setText(theme.fg("error", "Context warning must be lower than critical warning."));
							}
						}
						tui.requestRender();
					},
					() => done(false),
				);
				container.addChild(settingsList);
				container.addChild(formError);
				container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter edit/select • esc cancel"), 1, 1));
				container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));

				return {
					render: (width: number) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data: string) => {
						settingsList.handleInput?.(data);
						tui.requestRender();
					},
				};
			}, {
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 72,
					minWidth: 56,
					maxHeight: "85%",
					margin: 1,
				},
			});
			if (!shouldSave) return;

			try {
				await saveSimpleHandoffConfig(draft);
				ctx.ui.notify("Simple Handoff configuration saved. Reloading…", "info");
				await ctx.reload();
				return;
			} catch (error) {
				ctx.ui.notify(`Could not save Simple Handoff configuration: ${errorMessage(error)}`, "error");
			}
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

	registerHandoffCommand("sh", "Write a focused context handoff and continue in a fresh session");

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
			let setupError: unknown;

			try {
				const result = await ctx.newSession({
					...(sourceSessionPath ? { parentSession: sourceSessionPath } : {}),
					setup: async (sessionManager) => {
						try {
							sessionManager.appendMessage({
								role: "user",
								content: [{ type: "text", text: continuationPrompt }],
								timestamp: Date.now(),
							});
							handoffDurableInReplacement = true;
						} catch (error) {
							setupError = error;
						}
					},
					withSession: async (replacementCtx) => {
						if (setupError) {
							replacementCtx.ui.notify(
								`The handoff could not be persisted: ${errorMessage(setupError)} Resume the source session to retry.`,
								"error",
							);
							return;
						}
						try {
							await replacementCtx.sendUserMessage("Continue the handed-off work now.");
						} catch {
							replacementCtx.ui.notify(
								"The handoff is preserved above, but automatic continuation failed. Send another message to retry.",
								"error",
							);
						}
					},
				});

				if (result.cancelled) {
					clearHandoff();
					await cleanupHandoff(token);
					ctx.ui.notify("The automatic session switch was cancelled. Run /sh to try again.", "warning");
				} else if (handoffDurableInReplacement) {
					await cleanupHandoff(token);
				}
			} catch {
				if (handoffDurableInReplacement) {
					await cleanupHandoff(token).catch(() => undefined);
				}
				// The source session keeps its ready job and private file for recovery.
			} finally {
				transitionInProgress = false;
			}
		},
	});
}
