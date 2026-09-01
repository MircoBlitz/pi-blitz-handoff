import { randomUUID } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_THRESHOLDS } from "./core.ts";

export const CONFIG_FILE_NAME = "pi-simple-handoff.json";
export const MIN_AUTOMATIC_HANDOFF_PERCENT = 50;
export const MIN_READINESS_RETRY_SECONDS = 1;
export const MAX_READINESS_RETRY_SECONDS = 300;
export const MIN_WRITER_RETRY_LIMIT = 0;
export const MAX_WRITER_RETRY_LIMIT = 10;
export const MIN_WRITER_RETRY_SECONDS = 1;
export const MAX_WRITER_RETRY_SECONDS = 300;

export type SimpleHandoffConfig = {
	kvWarningPercent: number;
	selfHandoffPercent: number;
	automaticSessionHandoff: boolean;
	automaticSessionHandoffPercent: number;
	readinessRetrySeconds: number;
	writerRetryLimit: number;
	writerRetryDelaySeconds: number;
};

export const DEFAULT_CONFIG: SimpleHandoffConfig = {
	kvWarningPercent: DEFAULT_THRESHOLDS.warningThreshold,
	selfHandoffPercent: DEFAULT_THRESHOLDS.criticalThreshold,
	automaticSessionHandoff: false,
	automaticSessionHandoffPercent: 60,
	readinessRetrySeconds: 30,
	writerRetryLimit: 3,
	writerRetryDelaySeconds: 30,
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

function validateIntegerRange(value: unknown, path: string, setting: string, minimum: number, maximum: number): number {
	const number = validateNumber(value, path, setting);
	if (!Number.isInteger(number) || number < minimum || number > maximum) {
		throw new Error(`${path} ${setting} must be an integer between ${minimum} and ${maximum}.`);
	}
	return number;
}

export function simpleHandoffConfigPath(agentDirectory = getAgentDir()): string {
	return join(agentDirectory, "extensions", CONFIG_FILE_NAME);
}

export function loadSimpleHandoffConfig(agentDirectory = getAgentDir()): SimpleHandoffConfig {
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
		readinessRetrySeconds: values.readinessRetrySeconds === undefined
			? DEFAULT_CONFIG.readinessRetrySeconds
			: validateIntegerRange(values.readinessRetrySeconds, path, "readinessRetrySeconds", MIN_READINESS_RETRY_SECONDS, MAX_READINESS_RETRY_SECONDS),
		writerRetryLimit: values.writerRetryLimit === undefined
			? DEFAULT_CONFIG.writerRetryLimit
			: validateIntegerRange(values.writerRetryLimit, path, "writerRetryLimit", MIN_WRITER_RETRY_LIMIT, MAX_WRITER_RETRY_LIMIT),
		writerRetryDelaySeconds: values.writerRetryDelaySeconds === undefined
			? DEFAULT_CONFIG.writerRetryDelaySeconds
			: validateIntegerRange(values.writerRetryDelaySeconds, path, "writerRetryDelaySeconds", MIN_WRITER_RETRY_SECONDS, MAX_WRITER_RETRY_SECONDS),
	};
	const unknownKeys = Object.keys(values).filter(
		(key) => key !== "kvWarningPercent" &&
			key !== "selfHandoffPercent" &&
			key !== "automaticSessionHandoff" &&
			key !== "automaticSessionHandoffPercent" &&
			key !== "readinessRetrySeconds" &&
			key !== "writerRetryLimit" &&
			key !== "writerRetryDelaySeconds",
	);
	if (unknownKeys.length > 0) {
		throw new Error(`${path} contains unknown setting(s): ${unknownKeys.join(", ")}.`);
	}
	return config;
}

export async function saveSimpleHandoffConfig(
	config: SimpleHandoffConfig,
	agentDirectory = getAgentDir(),
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
