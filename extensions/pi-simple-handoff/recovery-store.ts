import { readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import { formatDeferredPrompts, type DeferredPromptSnapshot } from "./deferred.ts";
import { atomicWriteFile } from "./filesystem.ts";

const RECOVERY_FILE_PATTERN = /^[A-Za-z0-9-]+\.md$/;

export function normalizeSourceSessionId(sourceSessionPath: string): string {
  const normalized = basename(sourceSessionPath)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "session";
}

export function recoveryFileName(handoffTimestamp: Date, sourceSessionPath: string): string {
  const timestamp = handoffTimestamp.toISOString().replace(/[:.]/g, "-");
  return `${timestamp}-${normalizeSourceSessionId(sourceSessionPath)}.md`;
}

export async function persistDeferredPrompts(
  recoveryDirectory: string,
  snapshot: DeferredPromptSnapshot,
): Promise<string> {
  if (snapshot.prompts.length === 0) {
    throw new Error("Cannot persist an empty deferred-prompt snapshot");
  }

  const fileName = recoveryFileName(snapshot.handoffTimestamp, snapshot.sourceSessionPath);
  await atomicWriteFile(selectedRecoveryPath(recoveryDirectory, fileName), formatDeferredPrompts(snapshot.prompts));
  return fileName;
}

export async function inspectRecoveryFile(recoveryDirectory: string, fileName: string): Promise<string> {
  return readFile(selectedRecoveryPath(recoveryDirectory, fileName), "utf8");
}

export async function deleteRecoveryFile(recoveryDirectory: string, fileName: string): Promise<void> {
  await unlink(selectedRecoveryPath(recoveryDirectory, fileName));
}

function selectedRecoveryPath(recoveryDirectory: string, fileName: string): string {
  if (!RECOVERY_FILE_PATTERN.test(fileName)) {
    throw new Error("Recovery filename must be a filesystem-safe Markdown filename");
  }
  return join(recoveryDirectory, fileName);
}
