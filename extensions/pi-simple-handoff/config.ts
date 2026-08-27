import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { HandoffThresholds } from "./core.ts";

export const CONFIG_FILE_NAME = "pi-simple-handoff.json";

export type SimpleHandoffConfig = {
	kvWarningPercent: number;
	selfHandoffPercent: number;
};

export const DEFAULT_CONFIG: SimpleHandoffConfig = {
	kvWarningPercent: 60,
	selfHandoffPercent: 80,
};

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
			: Number(values.kvWarningPercent),
		selfHandoffPercent: values.selfHandoffPercent === undefined
			? DEFAULT_CONFIG.selfHandoffPercent
			: Number(values.selfHandoffPercent),
	};
	const unknownKeys = Object.keys(values).filter(
		(key) => key !== "kvWarningPercent" && key !== "selfHandoffPercent",
	);
	if (unknownKeys.length > 0) {
		throw new Error(`${path} contains unknown setting(s): ${unknownKeys.join(", ")}.`);
	}
	return config;
}

export function loadHandoffThresholds(agentDirectory = piAgentDirectory()): HandoffThresholds {
	const config = loadSimpleHandoffConfig(agentDirectory);
	return {
		warningThreshold: config.kvWarningPercent,
		criticalThreshold: config.selfHandoffPercent,
	};
}
