import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export async function ensureDirectory(path: string): Promise<void> {
  try {
    const existing = await stat(path);
    if (!existing.isDirectory()) {
      throw new Error(`Not a directory: ${path}`);
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
    await mkdir(path, { mode: PRIVATE_DIRECTORY_MODE, recursive: true });
  }
}

export async function requireDirectory(path: string): Promise<void> {
  const existing = await stat(path);
  if (!existing.isDirectory()) {
    throw new Error(`Not a directory: ${path}`);
  }
}

export async function atomicWriteFile(path: string, content: string | Uint8Array): Promise<void> {
  const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`);

  try {
    await writeFile(temporaryPath, content, { flag: "wx", mode: PRIVATE_FILE_MODE });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
