import { isAbsolute } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { handoffPaths, loadConfig, saveConfig, validateConfig, type HandoffConfig } from "./config.ts";
import { isMissing, requireDirectory } from "./filesystem.ts";
import { catalogueTemplates } from "./templates.ts";
import { confirmDialog, inputDialog, selectDialog } from "./overlay-dialog.ts";

type ConfigDialogContext = Pick<ExtensionCommandContext, "mode" | "hasUI" | "ui">;
type SettingKey = keyof HandoffConfig;

const SETTING_KEYS: readonly SettingKey[] = [
  "contextWarningPercent",
  "criticalWarningPercent",
  "automaticSessionHandoff",
  "deleteHandoffAfterReading",
  "prepareWhileWaiting",
  "automaticSessionHandoffPercent",
  "readinessRetrySeconds",
  "maxSessionChainLength",
  "writerAttempts",
  "writerRetryDelaySeconds",
  "recoveryDirectory",
  "templateDirectory",
  "callTemplate",
  "handoffTemplate",
];

const SETTING_LABELS: Record<SettingKey, string> = {
  contextWarningPercent: "Context warning percentage",
  criticalWarningPercent: "Critical warning percentage",
  automaticSessionHandoff: "Automatic session handoff",
  deleteHandoffAfterReading: "Delete handoff after reading",
  prepareWhileWaiting: "Prepare while waiting",
  automaticSessionHandoffPercent: "Automatic session handoff percentage",
  readinessRetrySeconds: "Readiness reminder seconds",
  maxSessionChainLength: "Maximum session chain length",
  writerAttempts: "Writer attempts",
  writerRetryDelaySeconds: "Writer retry delay seconds",
  recoveryDirectory: "Recovery directory",
  templateDirectory: "Template directory",
  callTemplate: "Call template",
  handoffTemplate: "Handoff template",
};

const ENTER_TEMPLATE_OPTION = "Enter another filename";

type ConfigPersistedHandler = (
  config: HandoffConfig,
  ctx: ConfigDialogContext,
) => void | Promise<void>;

export class ConfigDialog {
  private activeController: AbortController | undefined;
  private readonly agentDirectory: string;
  private readonly onPersisted?: ConfigPersistedHandler;

  constructor(agentDirectory: string, onPersisted?: ConfigPersistedHandler) {
    this.agentDirectory = agentDirectory;
    this.onPersisted = onPersisted;
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
      let config = await loadConfig(this.agentDirectory);

      while (!controller.signal.aborted) {
        const options = settingOptions(config);
        const choice = await selectDialog(ctx, "Configure pi-blitz-handoff", options, {
          heading: "Settings · edits save immediately",
          signal: controller.signal,
        });
        if (controller.signal.aborted || choice === undefined) return;

        const settingIndex = options.indexOf(choice);
        const key = SETTING_KEYS[settingIndex];
        if (key !== undefined) {
          const persisted = await editSetting(
            this.agentDirectory,
            config,
            key,
            ctx,
            controller.signal,
          );
          if (persisted !== config) {
            config = persisted;
            await this.onPersisted?.(config, ctx);
            ctx.ui.notify(`${SETTING_LABELS[key]} saved.`, "info");
          }
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

function settingOptions(config: HandoffConfig): string[] {
  return SETTING_KEYS.map((key) => `${SETTING_LABELS[key]}: ${formatValue(config[key])}`);
}

function formatValue(value: HandoffConfig[SettingKey]): string {
  if (value === null) return "not configured";
  if (typeof value === "boolean") return value ? "enabled" : "disabled";
  return String(value);
}

async function editSetting(
  agentDirectory: string,
  draft: HandoffConfig,
  key: SettingKey,
  ctx: ConfigDialogContext,
  signal: AbortSignal,
): Promise<HandoffConfig> {
  let candidate: HandoffConfig | undefined;

  if (key === "automaticSessionHandoff" || key === "deleteHandoffAfterReading" || key === "prepareWhileWaiting") {
    const answer = await selectDialog(ctx,
      key === "deleteHandoffAfterReading"
        ? "Should the receiving session delete the handoff file after reading it completely? Disabled leaves the file unchanged."
        : key === "prepareWhileWaiting"
          ? "Should early template retrieval and drafting be offered while waiting before GO?"
          : "Should automatic session handoff be enabled?",
      ["Enabled", "Disabled"],
      { signal, heading: SETTING_LABELS[key] },
    );
    if (signal.aborted || answer === undefined) return draft;
    candidate = { ...draft, [key]: answer === "Enabled" };
  } else if (key === "callTemplate" || key === "handoffTemplate") {
    const paths = handoffPaths(agentDirectory);
    const prefix = key === "callTemplate" ? "call_" : "handoff_";
    const entries = await catalogueTemplates(paths.templateDirectory, draft.templateDirectory);
    const options = entries
      .map(({ filename }) => filename)
      .filter((filename) => filename.startsWith(prefix));
    options.push(ENTER_TEMPLATE_OPTION);

    let answer = await selectDialog(ctx, questionFor(key, draft), options, { signal, heading: SETTING_LABELS[key] });
    if (signal.aborted || answer === undefined) return draft;
    if (answer === ENTER_TEMPLATE_OPTION) {
      answer = await inputDialog(ctx, "What .cmpl filename should be used? Enter a filename, not a path.", inputPlaceholder(draft[key]), { signal, heading: SETTING_LABELS[key] });
      if (signal.aborted || answer === undefined) return draft;
    }

    candidate = candidateForAnswer(draft, key, answer);
    if (candidate === undefined) {
      ctx.ui.notify(validationMessage(key, draft), "warning");
      return draft;
    }
  } else {
    const answer = await inputDialog(ctx, questionFor(key, draft), inputPlaceholder(draft[key]), { signal, heading: SETTING_LABELS[key] });
    if (signal.aborted || answer === undefined) return draft;

    candidate = candidateForAnswer(draft, key, answer);
    if (candidate === undefined) {
      ctx.ui.notify(validationMessage(key, draft), "warning");
      return draft;
    }
  }

  try {
    return await persistCandidate(agentDirectory, validateConfig(candidate), ctx, signal) ?? draft;
  } catch (error) {
    ctx.ui.notify(`That value is not valid: ${errorMessage(error)}`, "warning");
    return draft;
  }
}

function questionFor(key: Exclude<SettingKey, "automaticSessionHandoff" | "deleteHandoffAfterReading" | "prepareWhileWaiting">, draft: HandoffConfig): string {
  switch (key) {
    case "contextWarningPercent":
      return `What context percentage should show a warning? Enter a number from 1 to less than ${draft.criticalWarningPercent}.`;
    case "criticalWarningPercent":
      return `What context percentage should show a critical warning? Enter a number above ${draft.contextWarningPercent} through 100.`;
    case "automaticSessionHandoffPercent":
      return "At what context percentage should automatic handoff start? Enter a number from 0 through 100; 0 disables it.";
    case "readinessRetrySeconds":
      return "How many seconds should pass before the one-time readiness reminder? Enter an integer from 1 through 300.";
    case "maxSessionChainLength":
      return "How many sessions may one chain contain, including its master? Enter a positive integer.";
    case "writerAttempts":
      return "How many total writer attempts should be made? Enter a positive integer.";
    case "writerRetryDelaySeconds":
      return "How many seconds should pass before retrying the writer? Enter an integer from 1 through 300.";
    case "recoveryDirectory":
      return "What absolute directory path should store recovery files?";
    case "templateDirectory":
      return "What absolute addendum template directory should be used? Leave blank for no addendum directory.";
    case "callTemplate":
      return "Which session handoff call template should be used?";
    case "handoffTemplate":
      return "Which handoff dossier template should be used?";
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
    case "deleteHandoffAfterReading":
    case "prepareWhileWaiting":
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
    case "maxSessionChainLength": {
      const value = integer(answer, 1);
      return value === undefined ? undefined : { ...draft, maxSessionChainLength: value };
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
    case "callTemplate":
    case "handoffTemplate":
      return answer.endsWith(".cmpl") && !answer.includes("/") && !answer.includes("\\") && !answer.includes("\0")
        ? { ...draft, [key]: answer }
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
    case "deleteHandoffAfterReading":
    case "prepareWhileWaiting":
      return "Choose Enabled or Disabled.";
    case "automaticSessionHandoffPercent":
      return "Enter a finite number from 0 through 100.";
    case "readinessRetrySeconds":
    case "writerRetryDelaySeconds":
      return "Enter an integer from 1 through 300.";
    case "maxSessionChainLength":
    case "writerAttempts":
      return "Enter a positive integer.";
    case "recoveryDirectory":
      return "Enter an absolute recovery directory path.";
    case "templateDirectory":
      return "Enter an absolute template directory path, or leave the value blank.";
    case "callTemplate":
    case "handoffTemplate":
      return "Enter a .cmpl filename without a directory path.";
  }
}

async function persistCandidate(
  agentDirectory: string,
  config: HandoffConfig,
  ctx: ConfigDialogContext,
  signal: AbortSignal,
): Promise<HandoffConfig | undefined> {
  const configuredDirectories = [config.recoveryDirectory];
  if (config.templateDirectory !== null) configuredDirectories.push(config.templateDirectory);
  const confirmedDirectories: string[] = [];

  for (const directory of new Set(configuredDirectories)) {
    try {
      await requireDirectory(directory);
    } catch (error) {
      if (!isMissing(error)) {
        ctx.ui.notify(`Configuration was not saved: ${errorMessage(error)}`, "error");
        return undefined;
      }

      let confirmed: boolean;
      try {
        confirmed = await confirmDialog(ctx,
          "Create missing directory?",
          `Saving requires this directory. Create exactly this directory?\n${directory}`,
          { signal },
        );
      } catch (confirmationError) {
        ctx.ui.notify(`Configuration was not saved: ${errorMessage(confirmationError)}`, "error");
        return undefined;
      }
      if (signal.aborted) return undefined;
      if (!confirmed) {
        ctx.ui.notify(`Configuration was not saved because directory creation was not confirmed: ${directory}`, "warning");
        return undefined;
      }
      confirmedDirectories.push(directory);
    }
  }

  if (signal.aborted) return undefined;
  try {
    return await saveConfig(agentDirectory, config, confirmedDirectories);
  } catch (error) {
    ctx.ui.notify(`Configuration was not saved: ${errorMessage(error)}`, "error");
    return undefined;
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
