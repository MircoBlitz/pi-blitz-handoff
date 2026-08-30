import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DEFAULT_THRESHOLDS, type HandoffThresholds } from "./core.ts";

export const CONFIG_FILE_NAME = "pi-simple-handoff.json";
export const MIN_AUTOMATIC_HANDOFF_PERCENT = 50;

export type SimpleHandoffConfig = {
	kvWarningPercent: number;
	selfHandoffPercent: number;
	automaticSessionHandoff: boolean;
	automaticSessionHandoffPercent: number;
};

export const DEFAULT_CONFIG: SimpleHandoffConfig = {
	kvWarningPercent: DEFAULT_THRESHOLDS.warningThreshold,
	selfHandoffPercent: DEFAULT_THRESHOLDS.criticalThreshold,
	automaticSessionHandoff: false,
	automaticSessionHandoffPercent: 60,
};

function validateAutomaticSessionHandoff(value: unknown, path: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`${path} automaticSessionHandoff must be true or false.`);
	}
	return value;
}

function validateNumber(value: unknown, path: string, setting: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${path} ${setting} must be a finite JSON number.`);
	}
	return value;
}

function validateAutomaticSessionHandoffPercent(value: unknown, path: string): number {
	const percent = validateNumber(value, path, "automaticSessionHandoffPercent");
	if (percent < 0 || percent > 100) {
		throw new Error(`${path} automaticSessionHandoffPercent must be between 0 and 100.`);
	}
	return percent;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

export function piAgentDirectory(environment: NodeJS.ProcessEnv = process.env): string {
	const configured = environment.PI_CODING_AGENT_DIR?.trim();
	if (!configured) return join(homedir(), ".pi", "agent");
	const expanded = expandHome(configured);
	return isAbsolute(expanded) ? expanded : resolve(expanded);
}

export function simpleHandoffConfigPath(agentDirectory = piAgentDirectory()): string {
	return join(agentDirectory, "extensions", CONFIG_FILE_NAME);
}

export function loadSimpleHandoffConfig(agentDirectory = piAgentDirectory()): SimpleHandoffConfig {
	const path = simpleHandoffConfigPath(agentDirectory);
	if (!existsSync(path)) return { ...DEFAULT_CONFIG };

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not read ${path}: ${message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${path} must contain a JSON object.`);
	}

	const values = parsed as Record<string, unknown>;
	const config: SimpleHandoffConfig = {
		kvWarningPercent: values.kvWarningPercent === undefined
			? DEFAULT_CONFIG.kvWarningPercent
			: validateNumber(values.kvWarningPercent, path, "kvWarningPercent"),
		selfHandoffPercent: values.selfHandoffPercent === undefined
			? DEFAULT_CONFIG.selfHandoffPercent
			: validateNumber(values.selfHandoffPercent, path, "selfHandoffPercent"),
		automaticSessionHandoff: values.automaticSessionHandoff === undefined
			? DEFAULT_CONFIG.automaticSessionHandoff
			: validateAutomaticSessionHandoff(values.automaticSessionHandoff, path),
		automaticSessionHandoffPercent: values.automaticSessionHandoffPercent === undefined
			? DEFAULT_CONFIG.automaticSessionHandoffPercent
			: validateAutomaticSessionHandoffPercent(values.automaticSessionHandoffPercent, path),
	};
	const unknownKeys = Object.keys(values).filter(
		(key) => key !== "kvWarningPercent" &&
			key !== "selfHandoffPercent" &&
			key !== "automaticSessionHandoff" &&
			key !== "automaticSessionHandoffPercent",
	);
	if (unknownKeys.length > 0) {
		throw new Error(`${path} contains unknown setting(s): ${unknownKeys.join(", ")}.`);
	}
	return config;
}

export async function saveSimpleHandoffConfig(
	config: SimpleHandoffConfig,
	agentDirectory = piAgentDirectory(),
): Promise<void> {
	const path = simpleHandoffConfigPath(agentDirectory);
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
			mode: 0o600,
		});
		await rename(temporaryPath, path);
	} catch (error) {
		await unlink(temporaryPath).catch(() => undefined);
		throw error;
	}
}

export function loadHandoffThresholds(agentDirectory = piAgentDirectory()): HandoffThresholds {
	const config = loadSimpleHandoffConfig(agentDirectory);
	return {
		warningThreshold: config.kvWarningPercent,
		criticalThreshold: config.selfHandoffPercent,
	};
}
