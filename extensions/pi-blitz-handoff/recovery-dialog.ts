import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { deleteRecoveryFile, inspectRecoveryFile } from "./recovery-store.ts";

const SAFE_RECOVERY_FILE_PATTERN = /^[A-Za-z0-9-]+\.md$/;
const RECOVERY_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/;
const CANCEL_RECOVERY = "Cancel recovery";
const INSPECT_CONTENTS = "Inspect complete contents";
const EXECUTE_CONTENTS = "Execute recovered prompts";
const DISCARD_FILE = "Discard recovery file";
const RETURN_TO_LIST = "Return to recovery file list";
const RETURN_TO_ACTIONS = "Return to file actions";

interface RecoveryDialogContext extends Pick<ExtensionCommandContext, "hasUI" | "ui"> {}

type RecoveryDispatch = Pick<ExtensionAPI, "sendUserMessage">["sendUserMessage"];

interface RecoveryFile {
  fileName: string;
  label: string;
}

export class RecoveryDialog {
  private activeController: AbortController | undefined;
  private readonly recoveryDirectory: string;
  private readonly sendUserMessage: RecoveryDispatch;

  constructor(recoveryDirectory: string, sendUserMessage: RecoveryDispatch) {
    this.recoveryDirectory = recoveryDirectory;
    this.sendUserMessage = sendUserMessage;
  }

  get isActive(): boolean {
    return this.activeController !== undefined;
  }

  discard(): void {
    this.activeController?.abort();
  }

  async run(ctx: RecoveryDialogContext): Promise<void> {
    if (!ctx.hasUI) {
      ctx.ui.notify("Recovery requires an interactive UI.", "error");
      return;
    }
    if (this.activeController !== undefined) {
      ctx.ui.notify("A recovery dialog is already active.", "warning");
      return;
    }

    const controller = new AbortController();
    this.activeController = controller;

    try {
      while (!controller.signal.aborted) {
        const files = await listRecoveryFiles(this.recoveryDirectory);
        if (files.length === 0) {
          ctx.ui.notify("No session handoff recovery files remain.", "info");
          return;
        }

        const labels = [...files.map((file) => file.label), CANCEL_RECOVERY];
        const choice = await ctx.ui.select("Recover deferred session handoff prompts", labels, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (choice === undefined || choice === CANCEL_RECOVERY) {
          ctx.ui.notify("Recovery cancelled; all recovery files were retained.", "info");
          return;
        }

        const selected = files.find((file) => file.label === choice);
        if (selected !== undefined) {
          const result = await this.runFileActions(selected.fileName, ctx, controller.signal);
          if (result === "cancel" || result === "executed") return;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        ctx.ui.notify(`Could not list recovery files in ${this.recoveryDirectory}: ${errorMessage(error)}`, "error");
      }
    } finally {
      if (this.activeController === controller) this.activeController = undefined;
    }
  }

  private async runFileActions(
    fileName: string,
    ctx: RecoveryDialogContext,
    signal: AbortSignal,
  ): Promise<"list" | "cancel" | "executed"> {
    while (!signal.aborted) {
      const choice = await ctx.ui.select(
        `Recovery file: ${fileName}`,
        [INSPECT_CONTENTS, EXECUTE_CONTENTS, DISCARD_FILE, RETURN_TO_LIST, CANCEL_RECOVERY],
        { signal },
      );
      if (signal.aborted) return "cancel";
      if (choice === undefined || choice === CANCEL_RECOVERY) {
        ctx.ui.notify("Recovery cancelled; the selected file was retained.", "info");
        return "cancel";
      }
      if (choice === RETURN_TO_LIST) return "list";
      if (choice === DISCARD_FILE) {
        await this.discardFile(fileName, ctx);
        return "list";
      }
      if (choice === INSPECT_CONTENTS) {
        const inspectResult = await this.inspectFile(fileName, ctx, signal);
        if (inspectResult === "cancel") return "cancel";
        continue;
      }
      if (choice === EXECUTE_CONTENTS) {
        return this.executeFile(fileName, ctx);
      }
    }
    return "cancel";
  }

  private async inspectFile(
    fileName: string,
    ctx: RecoveryDialogContext,
    signal: AbortSignal,
  ): Promise<"actions" | "cancel"> {
    const path = join(this.recoveryDirectory, fileName);
    let content: string;
    try {
      content = await inspectRecoveryFile(this.recoveryDirectory, fileName);
    } catch (error) {
      ctx.ui.notify(`Could not read recovery file ${path}; it was retained: ${errorMessage(error)}`, "error");
      return "actions";
    }

    const choice = await ctx.ui.select(
      `Complete contents of ${fileName} (read-only):\n\n${content}`,
      [RETURN_TO_ACTIONS, CANCEL_RECOVERY],
      { signal },
    );
    if (signal.aborted) return "cancel";
    if (choice === CANCEL_RECOVERY || choice === undefined) {
      ctx.ui.notify("Recovery cancelled; the selected file was retained.", "info");
      return "cancel";
    }
    return "actions";
  }

  private async executeFile(
    fileName: string,
    ctx: RecoveryDialogContext,
  ): Promise<"list" | "executed"> {
    const path = join(this.recoveryDirectory, fileName);
    let content: string;
    try {
      content = await inspectRecoveryFile(this.recoveryDirectory, fileName);
    } catch (error) {
      ctx.ui.notify(`Could not read recovery file ${path}; it was retained: ${errorMessage(error)}`, "error");
      return "list";
    }

    try {
      this.sendUserMessage(assembleRecoveryTurn(content));
    } catch (error) {
      ctx.ui.notify(
        `Recovery dispatch failed immediately; ${path} was retained: ${errorMessage(error)}`,
        "error",
      );
      return "list";
    }

    try {
      await deleteRecoveryFile(this.recoveryDirectory, fileName);
      ctx.ui.notify(`Recovery dispatch returned without an immediate error; deleted ${path}.`, "info");
    } catch (error) {
      ctx.ui.notify(
        `Recovery dispatch returned without an immediate error, but ${path} could not be deleted: ${errorMessage(error)}`,
        "error",
      );
    }
    return "executed";
  }

  private async discardFile(fileName: string, ctx: RecoveryDialogContext): Promise<void> {
    const path = join(this.recoveryDirectory, fileName);
    try {
      await deleteRecoveryFile(this.recoveryDirectory, fileName);
      ctx.ui.notify(`Discarded recovery file ${path}.`, "info");
    } catch (error) {
      ctx.ui.notify(`Could not discard recovery file ${path}; it was retained: ${errorMessage(error)}`, "error");
    }
  }
}

export function assembleRecoveryTurn(content: string): string {
  return [
    "Treat the marked entries below as separate sequential user inputs in their stored order. Later entries may update or supersede earlier entries.",
    content,
  ].join("\n\n");
}

async function listRecoveryFiles(recoveryDirectory: string): Promise<RecoveryFile[]> {
  const entries = await readdir(recoveryDirectory, { withFileTypes: true });
  return entries
    .filter((entry) =>
      SAFE_RECOVERY_FILE_PATTERN.test(entry.name) && (entry.isFile() || entry.isSymbolicLink())
    )
    .map((entry) => ({
      fileName: entry.name,
      label: `${recoveryDate(entry.name)} — ${entry.name}`,
    }))
    .sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function recoveryDate(fileName: string): string {
  const match = RECOVERY_DATE_PATTERN.exec(fileName);
  if (match === null) return "Date unavailable";
  const [, year, month, day, hour, minute, second, millisecond] = match;
  const date = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
