import { resolve } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { handoffPaths, loadConfig } from "./config.ts";
import {
  loadProjectTemplateAssignments,
  removeProjectTemplateAssignment,
  saveProjectTemplateAssignment,
  type ProjectTemplateAssignment,
} from "./project-templates.ts";
import {
  CALL_DEFAULT_TEMPLATE,
  catalogueTemplates,
  HANDOFF_DEFAULT_TEMPLATE,
} from "./templates.ts";

const AUTODISCOVER_OPTION = "<Autodiscover>";
const DEFAULT_OPTION = "<Default>";

type ProjectTemplateDialogContext = Pick<ExtensionCommandContext, "cwd" | "hasUI" | "ui">;
type TemplateRole = "callTemplate" | "handoffTemplate";

export class ProjectTemplateDialog {
  private activeController: AbortController | undefined;
  private readonly agentDirectory: string;

  constructor(agentDirectory: string) {
    this.agentDirectory = agentDirectory;
  }

  discard(): void {
    this.activeController?.abort();
  }

  async run(ctx: ProjectTemplateDialogContext): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify("Project template selection requires an interactive UI.", "error");
      return;
    }
    if (this.activeController !== undefined) {
      ctx.ui.notify("A project template dialog is already active.", "warning");
      return;
    }

    const controller = new AbortController();
    this.activeController = controller;
    const paths = handoffPaths(this.agentDirectory);
    const directory = resolve(ctx.cwd);

    try {
      const config = await loadConfig(this.agentDirectory);
      const entries = await catalogueTemplates(paths.templateDirectory, config.templateDirectory);
      const filenames = entries.map(({ filename }) => filename);
      const initial = (await loadProjectTemplateAssignments(paths.projectTemplatesFile)).get(directory);
      const current = initial === undefined
        ? "Current exact assignment: none"
        : `Current exact assignment: Call ${displaySelection(initial.callTemplate)}, Handoff ${displaySelection(initial.handoffTemplate)}`;

      const callChoice = await ctx.ui.select(
        `${current}\nWhich Call Template should ${directory} and its descendants use?`,
        roleOptions(filenames, "call_", CALL_DEFAULT_TEMPLATE),
        { signal: controller.signal },
      );
      if (controller.signal.aborted || callChoice === undefined) return;
      await commitRole(ctx, paths.projectTemplatesFile, directory, "callTemplate", selectedFilename(callChoice, CALL_DEFAULT_TEMPLATE));

      const handoffChoice = await ctx.ui.select(
        `Which Handoff Template should ${directory} and its descendants use?`,
        roleOptions(filenames, "handoff_", HANDOFF_DEFAULT_TEMPLATE),
        { signal: controller.signal },
      );
      if (controller.signal.aborted || handoffChoice === undefined) return;
      await commitRole(ctx, paths.projectTemplatesFile, directory, "handoffTemplate", selectedFilename(handoffChoice, HANDOFF_DEFAULT_TEMPLATE));
    } catch (error) {
      if (!controller.signal.aborted) {
        ctx.ui.notify(`Could not configure project templates: ${errorMessage(error)}`, "error");
      }
    } finally {
      if (this.activeController === controller) this.activeController = undefined;
    }
  }
}

async function commitRole(
  ctx: ProjectTemplateDialogContext,
  file: string,
  directory: string,
  role: TemplateRole,
  selection: string | null,
): Promise<void> {
  const existing = (await loadProjectTemplateAssignments(file)).get(directory);
  const assignment: ProjectTemplateAssignment = existing === undefined
    ? { callTemplate: null, handoffTemplate: null }
    : { ...existing };
  assignment[role] = selection;

  if (assignment.callTemplate === null && assignment.handoffTemplate === null) {
    const removed = await removeProjectTemplateAssignment(file, directory);
    ctx.ui.notify(
      removed
        ? `Project template assignment removed: ${directory}`
        : `No exact project template assignment exists for ${directory}; nothing was changed.`,
      "info",
    );
    return;
  }

  await saveProjectTemplateAssignment(file, directory, assignment);
  const label = role === "callTemplate" ? "Call" : "Handoff";
  ctx.ui.notify(`Project ${label} Template saved for ${directory}: ${displaySelection(selection)}.`, "info");
}

function roleOptions(
  filenames: readonly string[],
  prefix: "call_" | "handoff_",
  defaultFilename: string,
): string[] {
  return [
    AUTODISCOVER_OPTION,
    DEFAULT_OPTION,
    ...filenames.filter((filename) => filename.startsWith(prefix) && filename !== defaultFilename),
  ];
}

function selectedFilename(choice: string, defaultFilename: string): string | null {
  if (choice === AUTODISCOVER_OPTION) return null;
  return choice === DEFAULT_OPTION ? defaultFilename : choice;
}

function displaySelection(filename: string | null): string {
  return filename ?? AUTODISCOVER_OPTION;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
