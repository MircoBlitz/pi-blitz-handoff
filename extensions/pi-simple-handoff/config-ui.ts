import { DynamicBorder, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	Container,
	Input,
	Key,
	matchesKey,
	type SettingItem,
	type SelectItem,
	SelectList,
	SettingsList,
	type SettingsListTheme,
	Text,
} from "@earendil-works/pi-tui";
import {
	MAX_READINESS_RETRY_SECONDS,
	MAX_WRITER_RETRY_LIMIT,
	MAX_WRITER_RETRY_SECONDS,
	MIN_READINESS_RETRY_SECONDS,
	MIN_WRITER_RETRY_LIMIT,
	MIN_WRITER_RETRY_SECONDS,
	saveSimpleHandoffConfig,
	type SimpleHandoffConfig,
} from "./config.ts";
import { validateThresholds } from "./core.ts";

export const READINESS_RETRY_SECOND_OPTIONS = [15, 30, 60, 120, 180] as const;

export function isReadinessRetryPreset(seconds: number): boolean {
	return READINESS_RETRY_SECOND_OPTIONS.some((option) => option === seconds);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function validateConfigDraft(config: SimpleHandoffConfig): void {
	validateThresholds({ warningThreshold: config.kvWarningPercent, criticalThreshold: config.selfHandoffPercent });
	if (!Number.isFinite(config.automaticSessionHandoffPercent) || config.automaticSessionHandoffPercent < 0 || config.automaticSessionHandoffPercent > 100) {
		throw new Error("Automatic handoff threshold must be between 0 and 100.");
	}
	if (!Number.isInteger(config.readinessRetrySeconds) || config.readinessRetrySeconds < MIN_READINESS_RETRY_SECONDS || config.readinessRetrySeconds > MAX_READINESS_RETRY_SECONDS) {
		throw new Error(`Readiness retry time must be an integer between ${MIN_READINESS_RETRY_SECONDS} and ${MAX_READINESS_RETRY_SECONDS} seconds.`);
	}
	if (!Number.isInteger(config.writerRetryLimit) || config.writerRetryLimit < MIN_WRITER_RETRY_LIMIT || config.writerRetryLimit > MAX_WRITER_RETRY_LIMIT) {
		throw new Error(`Writer retry limit must be an integer between ${MIN_WRITER_RETRY_LIMIT} and ${MAX_WRITER_RETRY_LIMIT}.`);
	}
	if (!Number.isInteger(config.writerRetryDelaySeconds) || config.writerRetryDelaySeconds < MIN_WRITER_RETRY_SECONDS || config.writerRetryDelaySeconds > MAX_WRITER_RETRY_SECONDS) {
		throw new Error(`Writer retry delay must be an integer between ${MIN_WRITER_RETRY_SECONDS} and ${MAX_WRITER_RETRY_SECONDS} seconds.`);
	}
}

export function registerConfigCommand(
	pi: ExtensionAPI,
	config: SimpleHandoffConfig,
	saveConfig: (value: SimpleHandoffConfig) => Promise<void> = saveSimpleHandoffConfig,
): void {
	pi.registerCommand("shconfig", {
		description: "Configure Simple Handoff",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/shconfig requires TUI mode.", "error");
				return;
			}
			const draft = { ...config };
			const shouldSave = await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
				const numberEditor = (
					label: string,
					value: string,
					minimum: number,
					maximum: number,
					unit: "%" | "seconds" | "retries",
					select: (value?: string) => void,
				): Component => {
					const input = new Input();
					input.handleInput(value);
					const error = new Text("", 1, 0);
					input.onSubmit = (entered) => {
						const number = Number(entered.trim());
						if (!Number.isFinite(number) || number < minimum || number > maximum || (unit !== "%" && !Number.isInteger(number))) {
							error.setText(theme.fg("error", `Enter ${unit === "%" ? "a number" : "an integer"} from ${minimum} through ${maximum}.`));
							tui.requestRender();
							return;
						}
						select(String(number));
					};
					input.onEscape = () => select();
					const editor = new Container();
					editor.addChild(new Text(theme.fg("accent", theme.bold(label)), 1, 1));
					editor.addChild(new Text(theme.fg("dim", `Allowed range: ${minimum}–${maximum}${unit === "%" ? "%" : unit === "seconds" ? " seconds" : " retries"}`), 1, 0));
					editor.addChild(input);
					editor.addChild(error);
					editor.addChild(new Text(theme.fg("dim", "enter apply • esc back"), 1, 1));
					return {
						render: (width) => editor.render(width),
						invalidate: () => editor.invalidate(),
						handleInput: (data) => input.handleInput(data),
					};
				};
				const readinessRetryEditor = (
					value: string,
					select: (value?: string) => void,
				): Component => {
					const currentSeconds = Number.parseInt(value, 10);
					if (!isReadinessRetryPreset(currentSeconds)) {
						const editor = new Container();
						editor.addChild(new Text(theme.fg("accent", theme.bold("Readiness retry time")), 1, 1));
						editor.addChild(new Text(`Custom value: ${value}`, 1, 0));
						editor.addChild(new Text(theme.fg("muted", "This value was set directly in the JSON configuration and will not be overwritten here."), 1, 1));
						editor.addChild(new Text(theme.fg("dim", "esc back"), 1, 1));
						return {
							render: (width) => editor.render(width),
							invalidate: () => editor.invalidate(),
							handleInput: (data) => { if (matchesKey(data, Key.escape)) select(); },
						};
					}
					const options: SelectItem[] = READINESS_RETRY_SECOND_OPTIONS.map((seconds) => ({
						value: `${seconds} seconds`,
						label: `${seconds} seconds`,
					}));
					const list = new SelectList(options, options.length, {
						selectedPrefix: (text) => theme.fg("accent", text),
						selectedText: (text) => theme.fg("accent", text),
						description: (text) => theme.fg("muted", text),
						scrollInfo: (text) => theme.fg("dim", text),
						noMatch: (text) => theme.fg("warning", text),
					});
					const selectedIndex = options.findIndex((option) => option.value === value);
					if (selectedIndex >= 0) list.setSelectedIndex(selectedIndex);
					list.onSelect = (option) => select(option.value);
					list.onCancel = () => select();
					const editor = new Container();
					editor.addChild(new Text(theme.fg("accent", theme.bold("Readiness retry time")), 1, 1));
					editor.addChild(list);
					editor.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc back"), 1, 1));
					return {
						render: (width) => editor.render(width),
						invalidate: () => editor.invalidate(),
						handleInput: (data) => list.handleInput(data),
					};
				};
				const items: SettingItem[] = [
					{ id: "kvWarningPercent", label: "Context warning", description: "Shown once when context usage reaches this percentage.", currentValue: String(draft.kvWarningPercent), submenu: (value, select) => numberEditor("Context warning", value, 1, 100, "%", select) },
					{ id: "selfHandoffPercent", label: "Critical warning", description: "Shown after every settled turn from this percentage onward.", currentValue: String(draft.selfHandoffPercent), submenu: (value, select) => numberEditor("Critical warning", value, 1, 100, "%", select) },
					{ id: "automaticSessionHandoff", label: "Automatic Session Handoff", description: "Persistently authorize the extension to start handoffs itself.", currentValue: draft.automaticSessionHandoff ? "enabled" : "disabled", values: ["enabled", "disabled"] },
					{ id: "automaticSessionHandoffPercent", label: "Automatic threshold", description: "Effective from 50–100%; 0–49 keeps automatic handoff inactive.", currentValue: String(draft.automaticSessionHandoffPercent), submenu: (value, select) => numberEditor("Automatic threshold", value, 0, 100, "%", select) },
					{ id: "readinessRetrySeconds", label: "Readiness retry time", description: "Countdown before readiness is checked again.", currentValue: `${draft.readinessRetrySeconds} seconds`, submenu: readinessRetryEditor },
					{ id: "writerRetryLimit", label: "Writer retry limit", description: "Automatic retries after the initial writer attempt.", currentValue: String(draft.writerRetryLimit), submenu: (value, select) => numberEditor("Writer retry limit", value, MIN_WRITER_RETRY_LIMIT, MAX_WRITER_RETRY_LIMIT, "retries", select) },
					{ id: "writerRetryDelaySeconds", label: "Writer retry delay", description: "Delay between automatic writer attempts.", currentValue: String(draft.writerRetryDelaySeconds), submenu: (value, select) => numberEditor("Writer retry delay", value, MIN_WRITER_RETRY_SECONDS, MAX_WRITER_RETRY_SECONDS, "seconds", select) },
					{ id: "save", label: "Save and reload", currentValue: "press enter", values: ["press enter"] },
					{ id: "cancel", label: "Cancel", currentValue: "press enter", values: ["press enter"] },
				];
				const container = new Container();
				container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Simple Handoff Configuration")), 1, 1));
				const settingsTheme: SettingsListTheme = {
					cursor: theme.fg("accent", "> "),
					label: (text, selected) => selected ? theme.fg("accent", text) : text,
					value: (text, selected) => theme.fg(selected ? "accent" : "muted", text),
					description: (text) => theme.fg("muted", text),
					hint: (text) => theme.fg("dim", text),
				};
				const formError = new Text("", 1, 0);
				const list = new SettingsList(items, 10, settingsTheme, (id, value) => {
					formError.setText("");
					if (id === "kvWarningPercent") draft.kvWarningPercent = Number(value);
					else if (id === "selfHandoffPercent") draft.selfHandoffPercent = Number(value);
					else if (id === "automaticSessionHandoff") draft.automaticSessionHandoff = value === "enabled";
					else if (id === "automaticSessionHandoffPercent") draft.automaticSessionHandoffPercent = Number(value);
					else if (id === "readinessRetrySeconds") draft.readinessRetrySeconds = Number.parseInt(value, 10);
					else if (id === "writerRetryLimit") draft.writerRetryLimit = Number.parseInt(value, 10);
					else if (id === "writerRetryDelaySeconds") draft.writerRetryDelaySeconds = Number.parseInt(value, 10);
					else if (id === "cancel") done(false);
					else if (id === "save") {
						try {
							validateConfigDraft(draft);
							done(true);
						} catch (error) {
							formError.setText(theme.fg("error", errorMessage(error)));
						}
					}
					tui.requestRender();
				}, () => done(false));
				container.addChild(list);
				container.addChild(formError);
				container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter edit/select • esc cancel"), 1, 1));
				container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
				return {
					render: (width) => container.render(width),
					invalidate: () => container.invalidate(),
					handleInput: (data) => { list.handleInput?.(data); tui.requestRender(); },
				};
			}, { overlay: true, overlayOptions: { anchor: "center", width: 72, minWidth: 56, maxHeight: "85%", margin: 1 } });
			if (!shouldSave) return;
			try {
				await saveConfig(draft);
				ctx.ui.notify("Simple Handoff configuration saved. Reloading…", "info");
				await ctx.reload();
			} catch (error) {
				ctx.ui.notify(`Could not save Simple Handoff configuration: ${errorMessage(error)}`, "error");
			}
		},
	});
}
