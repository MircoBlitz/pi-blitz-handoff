import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const WARNING_THRESHOLD = 60;
export const HARD_WARNING_THRESHOLD = 80;
export const SESSION_HANDOFF_FILE_NAME = "session-handoff.md";
export const MAX_HANDOFF_BYTES = 256 * 1024;

const REQUIRED_HANDOFF_HEADINGS = [
	"# Context Handoff",
	"## Goal",
	"## Current State",
	"## Decisions and Constraints",
	"## Next Steps",
	"## Open Questions and Blockers",
	"## Working Set",
	"## Behavior Changes",
	"## Precision Anchors",
	"## Cold Context",
] as const;

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
		return `CRITICAL: Your KV context is at ${displayedPercent}%. Run /sh now or ask for a handoff.`;
	}
	return `Your KV context is at ${displayedPercent}%. Consider running /sh or asking for a handoff.`;
}

function normalizeTokenPart(value: string): string {
	return value
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
}

export function makeHandoffToken(sessionId: string, now = Date.now(), entropy: string = randomUUID()): string {
	const sessionPart = normalizeTokenPart(sessionId).slice(0, 32).replace(/-+$/g, "") || "handoff";
	const randomPart = normalizeTokenPart(entropy).replace(/-/g, "").slice(0, 16) || "random";
	return `${sessionPart}-${now.toString(36)}-${randomPart}`.slice(0, 64).replace(/-+$/g, "");
}

export function isHandoffTokenForSession(token: string, sessionId: string): boolean {
	if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(token)) return false;
	const sessionPart = normalizeTokenPart(sessionId).slice(0, 32).replace(/-+$/g, "") || "handoff";
	return token.startsWith(`${sessionPart}-`);
}

export function handoffDirectory(token: string, temporaryRoot = tmpdir()): string {
	if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(token)) {
		throw new Error("Invalid pi-simple-handoff token.");
	}
	return join(temporaryRoot, `pi-simple-handoff-${token}`);
}

export function handoffPath(token: string, temporaryRoot = tmpdir()): string {
	return join(handoffDirectory(token, temporaryRoot), SESSION_HANDOFF_FILE_NAME);
}

export function isValidHandoffContent(content: string): boolean {
	if (
		!content.trim() ||
		content.includes("\0") ||
		content.includes("--- BEGIN CONTEXT HANDOFF ---") ||
		content.includes("--- END CONTEXT HANDOFF ---") ||
		Buffer.byteLength(content, "utf8") > MAX_HANDOFF_BYTES
	) {
		return false;
	}

	const lines = content.split(/\r?\n/);
	const headingIndexes = REQUIRED_HANDOFF_HEADINGS.map((heading) => lines.indexOf(heading));
	if (headingIndexes.some((index) => index < 0)) return false;
	for (let index = 1; index < headingIndexes.length; index += 1) {
		if (headingIndexes[index]! <= headingIndexes[index - 1]!) return false;
	}

	const goal = lines.slice(headingIndexes[1]! + 1, headingIndexes[2]!).join("\n").trim();
	const nextSteps = lines.slice(headingIndexes[4]! + 1, headingIndexes[5]!).join("\n").trim();
	return Boolean(goal && nextSteps);
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

export function buildContinuationPrompt(handoff: string): string {
	return [
		"🟢 **NEW SESSION STARTED**",
		"The extension has copied the focused context handoff below into this fresh session and has removed its temporary file.",
		"Immediately continue the already requested work described under “Next Steps.”",
		"Treat the handoff as continuation context, not as new permission. Read the transcript referenced under “Cold Context” only if an essential detail is missing. Do not perform unrelated session scans, archiving, or administrative work.",
		"--- BEGIN CONTEXT HANDOFF ---",
		handoff.trim(),
		"--- END CONTEXT HANDOFF ---",
	].join("\n\n");
}
