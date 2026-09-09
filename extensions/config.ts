import { readFile } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";

import { atomicWriteFile, ensureDirectory, isMissing, requireDirectory } from "./filesystem.ts";

export interface HandoffConfig {
  contextWarningPercent: number;
  criticalWarningPercent: number;
  automaticSessionHandoff: boolean;
  automaticSessionHandoffPercent: number;
  readinessRetrySeconds: number;
  writerAttempts: number;
  writerRetryDelaySeconds: number;
  recoveryDirectory: string;
  templateDirectory: string | null;
  callTemplate: string;
  handoffTemplate: string;
}

export interface HandoffPaths {
  baseDirectory: string;
  configFile: string;
  projectTemplatesFile: string;
  recoveryDirectory: string;
  templateDirectory: string;
}

const CONFIG_KEYS = [
  "contextWarningPercent",
  "criticalWarningPercent",
  "automaticSessionHandoff",
  "automaticSessionHandoffPercent",
  "readinessRetrySeconds",
  "writerAttempts",
  "writerRetryDelaySeconds",
  "recoveryDirectory",
  "templateDirectory",
  "callTemplate",
  "handoffTemplate",
] as const;

export function handoffPaths(agentDirectory: string): HandoffPaths {
  const baseDirectory = join(agentDirectory, "pi-blitz-handoff");
  return {
    baseDirectory,
    configFile: join(baseDirectory, "config.json"),
    projectTemplatesFile: join(baseDirectory, "project-templates.json"),
    recoveryDirectory: join(baseDirectory, "recovery"),
    templateDirectory: join(baseDirectory, "templates"),
  };
}

export function defaultConfig(agentDirectory: string): HandoffConfig {
  const paths = handoffPaths(agentDirectory);
  return {
    contextWarningPercent: 60,
    criticalWarningPercent: 90,
    automaticSessionHandoff: false,
    automaticSessionHandoffPercent: 70,
    readinessRetrySeconds: 60,
    writerAttempts: 3,
    writerRetryDelaySeconds: 30,
    recoveryDirectory: `${paths.recoveryDirectory}${sep}`,
    templateDirectory: null,
    callTemplate: "call_default.cmpl",
    handoffTemplate: "handoff_default.cmpl",
  };
}

export function validateConfig(value: unknown): HandoffConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Configuration must be an object");
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [...CONFIG_KEYS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error("Configuration must contain exactly the supported settings");
  }

  const contextWarningPercent = numberSetting(record, "contextWarningPercent");
  const criticalWarningPercent = numberSetting(record, "criticalWarningPercent");
  if (!(contextWarningPercent >= 1 && contextWarningPercent < criticalWarningPercent && criticalWarningPercent <= 100)) {
    throw new Error("Warning percentages must satisfy 1 <= contextWarningPercent < criticalWarningPercent <= 100");
  }

  const automaticSessionHandoff = booleanSetting(record, "automaticSessionHandoff");
  const automaticSessionHandoffPercent = numberSetting(record, "automaticSessionHandoffPercent");
  if (automaticSessionHandoffPercent < 0 || automaticSessionHandoffPercent > 100) {
    throw new Error("automaticSessionHandoffPercent must be from 0 through 100");
  }

  const readinessRetrySeconds = integerSetting(record, "readinessRetrySeconds", 1, 300);
  const writerAttempts = integerSetting(record, "writerAttempts", 1);
  const writerRetryDelaySeconds = integerSetting(record, "writerRetryDelaySeconds", 1, 300);
  const recoveryDirectory = absoluteDirectorySetting(record, "recoveryDirectory");

  const templateValue = record.templateDirectory;
  if (templateValue !== null && (typeof templateValue !== "string" || !isAbsolute(templateValue))) {
    throw new Error("templateDirectory must be null or an absolute path");
  }

  const callTemplate = templateSetting(record, "callTemplate");
  const handoffTemplate = templateSetting(record, "handoffTemplate");

  return {
    contextWarningPercent,
    criticalWarningPercent,
    automaticSessionHandoff,
    automaticSessionHandoffPercent,
    readinessRetrySeconds,
    writerAttempts,
    writerRetryDelaySeconds,
    recoveryDirectory,
    templateDirectory: templateValue,
    callTemplate,
    handoffTemplate,
  };
}

export async function loadConfig(agentDirectory: string): Promise<HandoffConfig> {
  const { configFile } = handoffPaths(agentDirectory);
  try {
    const persisted = JSON.parse(await readFile(configFile, "utf8")) as unknown;
    return validateConfig(withLegacyCallTemplate(persisted));
  } catch (error) {
    if (isMissing(error)) {
      return defaultConfig(agentDirectory);
    }
    throw error;
  }
}

export async function saveConfig(
  agentDirectory: string,
  value: unknown,
  confirmedDirectories: readonly string[] = [],
): Promise<HandoffConfig> {
  const config = validateConfig(value);
  const paths = handoffPaths(agentDirectory);
  await ensureDirectory(paths.baseDirectory);

  const configuredDirectories = [config.recoveryDirectory];
  if (config.templateDirectory !== null) {
    configuredDirectories.push(config.templateDirectory);
  }
  const confirmed = new Set(confirmedDirectories);

  for (const directory of configuredDirectories) {
    try {
      await requireDirectory(directory);
    } catch (error) {
      if (!isMissing(error) || !confirmed.has(directory)) {
        throw error;
      }
      await ensureDirectory(directory);
    }
  }

  await atomicWriteFile(paths.configFile, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

function withLegacyCallTemplate(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (record.callTemplate !== undefined) return value;
  const legacyKeys = CONFIG_KEYS.filter((key) => key !== "callTemplate").sort();
  const actualKeys = Object.keys(record).sort();
  if (actualKeys.length !== legacyKeys.length || actualKeys.some((key, index) => key !== legacyKeys[index])) {
    return value;
  }
  return { ...record, callTemplate: "call_default.cmpl" };
}

function templateSetting(record: Record<string, unknown>, name: "callTemplate" | "handoffTemplate"): string {
  const value = record[name];
  if (
    typeof value !== "string" ||
    !value.endsWith(".cmpl") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new Error(`${name} must be a .cmpl filename, not a path`);
  }
  return value;
}

function numberSetting(record: Record<string, unknown>, name: string): number {
  const value = record[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function booleanSetting(record: Record<string, unknown>, name: string): boolean {
  const value = record[name];
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be a boolean`);
  }
  return value;
}

function integerSetting(record: Record<string, unknown>, name: string, minimum: number, maximum?: number): number {
  const value = record[name];
  if (!Number.isInteger(value) || (value as number) < minimum || (maximum !== undefined && (value as number) > maximum)) {
    const range = maximum === undefined ? `at least ${minimum}` : `from ${minimum} through ${maximum}`;
    throw new Error(`${name} must be an integer ${range}`);
  }
  return value as number;
}

function absoluteDirectorySetting(record: Record<string, unknown>, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}
