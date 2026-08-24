import { join } from "node:path";

export const WARNING_THRESHOLD = 60;
export const HARD_WARNING_THRESHOLD = 80;
export const SESSION_HANDOFF_FILE_NAME = "session-handoff.md";

export type HandoffThresholds = {
	warningThreshold: number;
	criticalThreshold: number;
};

export const DEFAULT_THRESHOLDS: HandoffThresholds = {
	warningThreshold: WARNING_THRESHOLD,
	criticalThreshold: HARD_WARNING_THRESHOLD,
};

export type WarningLevel = "warning" | "error";

export function validateThresholds(thresholds: HandoffThresholds): HandoffThresholds {
	const { warningThreshold, criticalThreshold } = thresholds;
	if (
		!Number.isFinite(warningThreshold) ||
		!Number.isFinite(criticalThreshold) ||
		warningThreshold < 1 ||
		warningThreshold >= criticalThreshold ||
		criticalThreshold > 100
	) {
		throw new Error("pi-simple-handoff thresholds must satisfy 1 <= warningThreshold < criticalThreshold <= 100.");
	}
	return thresholds;
}

export function warningLevel(
	percent: number | null,
	warnedAtWarning: boolean,
	thresholds: HandoffThresholds = DEFAULT_THRESHOLDS,
): WarningLevel | undefined {
	if (percent === null || !Number.isFinite(percent) || percent < thresholds.warningThreshold) return undefined;
	if (percent >= thresholds.criticalThreshold) return "error";
	if (!warnedAtWarning) return "warning";
	return undefined;
}

export function formatWarning(percent: number, level: WarningLevel): string {
	const displayedPercent = Math.max(0, Math.min(100, Math.floor(percent)));
	if (level === "error") {
		return `CRITICAL: Your KV context is at ${displayedPercent}%. Run /simplehandoff or /sh now.`;
	}
	return `Your KV context is at ${displayedPercent}%. Consider running /simplehandoff or /sh.`;
}

export function makeHandoffToken(sessionId: string, now = Date.now()): string {
	const normalized = `${sessionId}-${now.toString(36)}`
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/g, "");
	return normalized || `handoff-${now.toString(36)}`;
}

export function handoffPath(cwd: string, token: string): string {
	return join(cwd, ".pi", "session-handoff", token, SESSION_HANDOFF_FILE_NAME);
}

export function buildHandoffCreationPrompt(sessionPath: string, sourceSessionPath?: string): string {
	const coldContext = sourceSessionPath
		? `Under “Cold Context”, include only this reference: \`${sourceSessionPath}\`. It is an emergency source and must not be read automatically.`
		: "Under “Cold Context”, state that no transcript reference is available.";

	return [
		"🟡 **HANDOFF STARTED**",
		"Create exactly one focused context handoff in the current main agent. Do not use subagents or delegation. Do no further work except writing this file.",
		`Write the handoff to \`${sessionPath}\`. Do not read or update project indexes, todo files, behavior files, registries, or archives. Do not run tests or scan sessions.`,
		"Write the entire handoff directly in English. Do not add a separate translation step.",
		"The handoff should resemble a good compaction but be weighted toward what comes next: keep the past only as detailed as necessary and describe the concrete continuation as completely and precisely as possible. Do not write a conversation log, hidden reasoning, repetition, or secrets.",
		"Use exactly this structure:",
		"# Context Handoff",
		"## Goal\nThe current user goal and desired end state.",
		"## Current State\nOnly results, changes, and findings needed to continue.",
		"## Decisions and Constraints\nDecisions, requirements, permissions, and explicitly excluded work that still apply.",
		"## Next Steps\nThe already requested continuation in concrete order. Make this the most detailed section.",
		"## Open Questions and Blockers\nOnly genuinely unresolved points. Do not invent new tasks.",
		"## Working Set\nRelevant files, URLs, commands, artifacts, and precise technical anchors.",
		"## Behavior Changes\nOnly user preferences added or changed in this session. If there are none, write “None.”",
		"## Precision Anchors\nQuote a few critical user statements verbatim when paraphrasing could lose meaning or tone. Otherwise write “None.”",
		`## Cold Context\n${coldContext}`,
		"The handoff carries an existing request; it grants no new permission. End immediately after successfully writing the file. The extension will then open a fresh session automatically.",
	].join("\n\n");
}

export function buildContinuationPrompt(sessionPath: string): string {
	return [
		"🟢 **NEW SESSION STARTED**",
		`First, read only the context handoff at \`${sessionPath}\` in full.`,
		`Then delete exactly this file: \`${sessionPath}\`. Permission to delete it is granted.`,
		"Immediately continue the already requested work described under “Next Steps.”",
		"Read the transcript referenced under “Cold Context” only if a detail essential to continuing is missing from the handoff. Do not perform any other session scans, archiving, or administrative work.",
	].join("\n\n");
}
