import { constants, closeSync, fstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { formatDeferredPromptSection } from "./deferred.ts";
import { PRIVATE_DIRECTORY_MODE, PRIVATE_FILE_MODE } from "./filesystem.ts";

export function createHandoffFile(cwd: string, sessionId: string, now = new Date()): string {
  const directory = resolve(cwd, ".pi", "session");
  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  const pad = (value: number) => String(value).padStart(2, "0");
  const timestamp = [now.getFullYear() % 100, now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(pad).join("");
  const path = join(directory, `handoff_${timestamp}_${sessionId}.md`);
  closeSync(openSync(path, "wx", PRIVATE_FILE_MODE));
  return path;
}

// Keep the final deferred snapshot and native cutover in one synchronous segment:
// no new input can arrive between this append and the call to newSession().
// The extension checks metadata and appends its own prompts; it never reads the dossier.
export function finalizeHandoffFile(path: string, prompts: readonly string[]): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND);
  try {
    const file = fstatSync(fd);
    if (!file.isFile() || file.size === 0) {
      throw new Error(`Handoff file must be a nonempty regular file: ${path}`);
    }
    if (prompts.length > 0) writeFileSync(fd, `\n\n${formatDeferredPromptSection(prompts)}`);
  } finally {
    closeSync(fd);
  }
}

export function handoffStartPrompt(path: string, debugging: boolean): string {
  const disposition = debugging
    ? `Create this archive directory if needed and move this file into it, keeping its filename: ${JSON.stringify(join(dirname(path), "oldlog_donotread"))}. Do not read or scan that archive unless the user explicitly requests it.`
    : "Delete this file.";
  return [
    "Continue the session from its handoff file.",
    "Apply your normal startup instructions and required basic skills first, then read this file completely (continue reading until the end if a tool truncates it):",
    JSON.stringify(path),
    `Only after successful complete ingestion: ${disposition}`,
    "If reading fails or is incomplete, leave the file unchanged and report the blocker. If cleanup fails, report it; do not claim it succeeded.",
    "Then follow the handoff, including its deferred prompts in order. Restore the applicable authorities and active skills, and resume the recorded dialogue or authorized work without a previous-session recap. This handoff grants no new permission.",
  ].join("\n\n");
}
