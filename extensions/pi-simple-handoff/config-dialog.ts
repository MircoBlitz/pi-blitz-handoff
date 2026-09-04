import { isAbsolute } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { loadConfig, saveConfig, validateConfig, type HandoffConfig } from "./config.ts";
import { isMissing, requireDirectory } from "./filesystem.ts";

type ConfigDialogContext = Pick<ExtensionCommandContext, "hasUI" | "ui">;
type SettingKey = keyof HandoffConfig;

const SETTING_KEYS: readonly SettingKey[] = [
  "contextWarningPercent",
  "criticalWarningPercent",
  "automaticSessionHandoff",
  "automaticSessionHandoffPercent",
  "readinessRetrySeconds",
  "writerAttempts",
  "writerRetryDelaySeconds",
  "recoveryDirectory",
  "templateDirectory",
  "handoffTemplate",
];

const SETTING_LABELS: Record<SettingKey, string> = {
  contextWarningPercent: "Context warning percentage",
  criticalWarningPercent: "Critical warning percentage",
  automaticSessionHandoff: "Automatic session handoff",
  automaticSessionHandoffPercent: "Automatic session handoff percentage",
  readinessRetrySeconds: "Readiness retry seconds",
  writerAttempts: "Writer attempts",
  writerRetryDelaySeconds: "Writer retry delay seconds",
  recoveryDirectory: "Recovery directory",
  templateDirectory: "Template directory",
  handoffTemplate: "Handoff template",
};

const SAVE_OPTION = "Save configuration";
const CANCEL_OPTION = "Cancel configuration";

export class ConfigDialog {
  private activeController: AbortController | undefined;
  private readonly agentDirectory: string;

  constructor(agentDirectory: string) {
    this.agentDirectory = agentDirectory;
  }

  get isActive(): boolean {
    return this.activeController !== undefined;
  }

  discard(): void {
    this.activeController?.abort();
  }

  async run(ctx: ConfigDialogContext): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify("Configuration requires an interactive UI.", "error");
      return;
    }
    if (this.activeController !== undefined) {
      ctx.ui.notify("A configuration dialog is already active.", "warning");
      return;
    }

    const controller = new AbortController();
    this.activeController = controller;

    try {
      let draft = { ...(await loadConfig(this.agentDirectory)) };

      while (!controller.signal.aborted) {
        const options = settingOptions(draft);
        const choice = await ctx.ui.select("Configure pi-simple-handoff", options, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;

        if (choice === undefined || choice === CANCEL_OPTION) {
          ctx.ui.notify("Configuration changes discarded.", "info");
          return;
        }
        if (choice === SAVE_OPTION) {
          if (await saveDraft(this.agentDirectory, draft, ctx, controller.signal)) {
            ctx.ui.notify("Configuration saved.", "info");
            return;
          }
          continue;
        }

        const settingIndex = options.indexOf(choice);
        const key = SETTING_KEYS[settingIndex];
        if (key !== undefined) {
          draft = await editSetting(draft, key, ctx, controller.signal);
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        ctx.ui.notify(`Could not open configuration: ${errorMessage(error)}`, "error");
      }
    } finally {
      if (this.activeController === controller) {
        this.activeController = undefined;
      }
    }
  }
}

function settingOptions(draft: HandoffConfig): string[] {
  return [
    ...SETTING_KEYS.map((key) => `${SETTING_LABELS[key]}: ${formatValue(draft[key])}`),
    SAVE_OPTION,
    CANCEL_OPTION,
  ];
}

function formatValue(value: HandoffConfig[SettingKey]): string {
  if (value === null) return "not configured";
  if (typeof value === "boolean") return value ? "enabled" : "disabled";
  return String(value);
}

async function editSetting(
  draft: HandoffConfig,
  key: SettingKey,
  ctx: ConfigDialogContext,
  signal: AbortSignal,
): Promise<HandoffConfig> {
  let candidate: HandoffConfig | undefined;

  if (key === "automaticSessionHandoff") {
    const answer = await ctx.ui.select(
      "Should automatic session handoff be enabled?",
      ["Enabled", "Disabled"],
      { signal },
    );
    if (signal.aborted || answer === undefined) return draft;
    candidate = { ...draft, automaticSessionHandoff: answer === "Enabled" };
  } else {
    const answer = await ctx.ui.input(questionFor(key, draft), inputPlaceholder(draft[key]), { signal });
    if (signal.aborted || answer === undefined) return draft;

    candidate = candidateForAnswer(draft, key, answer);
    if (candidate === undefined) {
      ctx.ui.notify(validationMessage(key, draft), "warning");
      return draft;
    }
  }

  try {
    return validateConfig(candidate);
  } catch (error) {
    ctx.ui.notify(`That value is not valid: ${errorMessage(error)}`, "warning");
    return draft;
  }
}

function questionFor(key: Exclude<SettingKey, "automaticSessionHandoff">, draft: HandoffConfig): string {
  switch (key) {
    case "contextWarningPercent":
      return `What context percentage should show a warning? Enter a number from 1 to less than ${draft.criticalWarningPercent}.`;
    case "criticalWarningPercent":
      return `What context percentage should show a critical warning? Enter a number above ${draft.contextWarningPercent} through 100.`;
    case "automaticSessionHandoffPercent":
      return "At what context percentage should automatic handoff start? Enter a number from 0 through 100; 0 disables it.";
    case "readinessRetrySeconds":
      return "How many seconds should pass before retrying readiness? Enter an integer from 1 through 300.";
    case "writerAttempts":
      return "How many total writer attempts should be made? Enter a positive integer.";
    case "writerRetryDelaySeconds":
      return "How many seconds should pass before retrying the writer? Enter an integer from 1 through 300.";
    case "recoveryDirectory":
      return "What absolute directory path should store recovery files?";
    case "templateDirectory":
      return "What absolute addendum template directory should be used? Leave blank for no addendum directory.";
    case "handoffTemplate":
      return "What .cmpl filename should be used as the handoff template? Enter a filename, not a path.";
  }
}

function inputPlaceholder(value: HandoffConfig[SettingKey]): string {
  return value === null ? "Currently not configured" : `Current value: ${String(value)}`;
}

function candidateForAnswer(draft: HandoffConfig, key: SettingKey, answer: string): HandoffConfig | undefined {
  switch (key) {
    case "contextWarningPercent": {
      const value = finiteNumber(answer);
      return value !== undefined && value >= 1 && value < draft.criticalWarningPercent
        ? { ...draft, contextWarningPercent: value }
        : undefined;
    }
    case "criticalWarningPercent": {
      const value = finiteNumber(answer);
      return value !== undefined && value > draft.contextWarningPercent && value <= 100
        ? { ...draft, criticalWarningPercent: value }
        : undefined;
    }
    case "automaticSessionHandoff":
      return undefined;
    case "automaticSessionHandoffPercent": {
      const value = finiteNumber(answer);
      return value !== undefined && value >= 0 && value <= 100
        ? { ...draft, automaticSessionHandoffPercent: value }
        : undefined;
    }
    case "readinessRetrySeconds": {
      const value = integer(answer, 1, 300);
      return value === undefined ? undefined : { ...draft, readinessRetrySeconds: value };
    }
    case "writerAttempts": {
      const value = integer(answer, 1);
      return value === undefined ? undefined : { ...draft, writerAttempts: value };
    }
    case "writerRetryDelaySeconds": {
      const value = integer(answer, 1, 300);
      return value === undefined ? undefined : { ...draft, writerRetryDelaySeconds: value };
    }
    case "recoveryDirectory":
      return isAbsolute(answer) ? { ...draft, recoveryDirectory: answer } : undefined;
    case "templateDirectory":
      return answer === ""
        ? { ...draft, templateDirectory: null }
        : isAbsolute(answer)
          ? { ...draft, templateDirectory: answer }
          : undefined;
    case "handoffTemplate":
      return answer.endsWith(".cmpl") && !answer.includes("/") && !answer.includes("\\") && !answer.includes("\0")
        ? { ...draft, handoffTemplate: answer }
        : undefined;
  }
}

function validationMessage(key: SettingKey, draft: HandoffConfig): string {
  switch (key) {
    case "contextWarningPercent":
      return `Enter a finite number from 1 to less than ${draft.criticalWarningPercent}.`;
    case "criticalWarningPercent":
      return `Enter a finite number above ${draft.contextWarningPercent} through 100.`;
    case "automaticSessionHandoff":
      return "Choose Enabled or Disabled.";
    case "automaticSessionHandoffPercent":
      return "Enter a finite number from 0 through 100.";
    case "readinessRetrySeconds":
    case "writerRetryDelaySeconds":
      return "Enter an integer from 1 through 300.";
    case "writerAttempts":
      return "Enter a positive integer.";
    case "recoveryDirectory":
      return "Enter an absolute recovery directory path.";
    case "templateDirectory":
      return "Enter an absolute template directory path, or leave the value blank.";
    case "handoffTemplate":
      return "Enter a .cmpl filename without a directory path.";
  }
}

async function saveDraft(
  agentDirectory: string,
  draft: HandoffConfig,
  ctx: ConfigDialogContext,
  signal: AbortSignal,
): Promise<boolean> {
  let config: HandoffConfig;
  try {
    config = validateConfig(draft);
  } catch (error) {
    ctx.ui.notify(`Configuration was not saved: ${errorMessage(error)}`, "error");
    return false;
  }

  const configuredDirectories = [config.recoveryDirectory];
  if (config.templateDirectory !== null) configuredDirectories.push(config.templateDirectory);
  const confirmedDirectories: string[] = [];

  for (const directory of new Set(configuredDirectories)) {
    try {
      await requireDirectory(directory);
    } catch (error) {
      if (!isMissing(error)) {
        ctx.ui.notify(`Configuration was not saved: ${errorMessage(error)}`, "error");
        return false;
      }

      const confirmed = await ctx.ui.confirm(
        "Create missing directory?",
        `Saving requires this directory. Create exactly this directory?\n${directory}`,
        { signal },
      );
      if (signal.aborted) return false;
      if (!confirmed) {
        ctx.ui.notify(`Configuration was not saved because directory creation was not confirmed: ${directory}`, "warning");
        return false;
      }
      confirmedDirectories.push(directory);
    }
  }

  if (signal.aborted) return false;
  try {
    await saveConfig(agentDirectory, config, confirmedDirectories);
    return true;
  } catch (error) {
    ctx.ui.notify(`Configuration was not saved: ${errorMessage(error)}`, "error");
    return false;
  }
}

function finiteNumber(answer: string): number | undefined {
  if (answer.trim() === "") return undefined;
  const value = Number(answer);
  return Number.isFinite(value) ? value : undefined;
}

function integer(answer: string, minimum: number, maximum?: number): number | undefined {
  const value = finiteNumber(answer);
  if (value === undefined || !Number.isInteger(value) || value < minimum || (maximum !== undefined && value > maximum)) {
    return undefined;
  }
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
