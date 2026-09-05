import { readdir, readFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { atomicWriteFile, ensureDirectory, isMissing } from "./filesystem.ts";

export interface TemplateCatalogueEntry {
  filename: string;
  path: string;
  source: "managed" | "addendum";
}

export interface TemplateFailure {
  path: string;
  reason: string;
}

export interface ResolvedTemplate {
  path: string;
  content: string;
  failures: TemplateFailure[];
}

export interface TemplateDirectories {
  managedDirectory: string;
  addendumDirectory: string | null;
}

export function shippedDefaultPath(): string {
  return fileURLToPath(new URL("../../default.cmpl", import.meta.url));
}

export async function synchronizeManagedDefault(
  managedDirectory: string,
  packageDefault = shippedDefaultPath(),
  now = new Date(),
): Promise<{ status: "equal" | "installed" | "updated"; backupPath?: string }> {
  await ensureDirectory(managedDirectory);
  const source = await readFile(packageDefault);
  const managedPath = join(managedDirectory, "default.cmpl");

  let current: Buffer;
  try {
    current = await readFile(managedPath);
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
    await atomicWriteFile(managedPath, source);
    return { status: "installed" };
  }

  if (current.equals(source)) {
    return { status: "equal" };
  }

  const timestamp = now.toISOString().replaceAll(":", "-");
  const backupPath = join(managedDirectory, `default.cmpl.backup-${timestamp}`);
  await rename(managedPath, backupPath);
  await atomicWriteFile(managedPath, source);
  return { status: "updated", backupPath };
}

export async function catalogueTemplates(
  managedDirectory: string,
  addendumDirectory: string | null,
): Promise<TemplateCatalogueEntry[]> {
  const entries = new Map<string, TemplateCatalogueEntry>();

  for (const filename of await templateNames(managedDirectory)) {
    entries.set(filename, { filename, path: join(managedDirectory, filename), source: "managed" });
  }
  if (addendumDirectory !== null) {
    for (const filename of await templateNames(addendumDirectory)) {
      entries.set(filename, { filename, path: join(addendumDirectory, filename), source: "addendum" });
    }
  }

  return [...entries.values()].sort((left, right) => left.filename.localeCompare(right.filename));
}

export async function resolveTemplate(
  selectedFilename: string,
  directories: TemplateDirectories,
): Promise<ResolvedTemplate> {
  if (!isTemplateFilename(selectedFilename)) {
    throw new Error("Selected template must be a .cmpl filename, not a path");
  }

  const failures: TemplateFailure[] = [];
  const attempted = new Set<string>();

  if (directories.addendumDirectory !== null) {
    const addendumSelected = join(directories.addendumDirectory, selectedFilename);
    const selected = await attemptTemplate(addendumSelected, failures, attempted, true);
    if (selected.status === "valid") {
      return { path: selected.path, content: selected.content, failures };
    }
    if (selected.status !== "missing") {
      return resolveDefaults(directories, failures, attempted);
    }
  }

  const managedSelected = await attemptTemplate(
    join(directories.managedDirectory, selectedFilename),
    failures,
    attempted,
  );
  if (managedSelected.status === "valid") {
    return { path: managedSelected.path, content: managedSelected.content, failures };
  }

  return resolveDefaults(directories, failures, attempted);
}

async function resolveDefaults(
  directories: TemplateDirectories,
  failures: TemplateFailure[],
  attempted: Set<string>,
): Promise<ResolvedTemplate> {
  const candidates: string[] = [];
  if (directories.addendumDirectory !== null) {
    candidates.push(join(directories.addendumDirectory, "default.cmpl"));
  }
  candidates.push(join(directories.managedDirectory, "default.cmpl"));

  for (const candidate of candidates) {
    const result = await attemptTemplate(candidate, failures, attempted);
    if (result.status === "valid") {
      return { path: result.path, content: result.content, failures };
    }
  }

  const details = failures.map((failure) => `${failure.path}: ${failure.reason}`).join("; ");
  throw new Error(`No valid handoff template found${details.length === 0 ? "" : `: ${details}`}`);
}

type TemplateAttempt =
  | { status: "valid"; path: string; content: string }
  | { status: "missing" | "failed" };

async function attemptTemplate(
  path: string,
  failures: TemplateFailure[],
  attempted: Set<string>,
  ignoreMissing = false,
): Promise<TemplateAttempt> {
  const candidate = resolve(path);
  if (attempted.has(candidate)) {
    return { status: "failed" };
  }
  attempted.add(candidate);

  try {
    const content = await readFile(candidate, "utf8");
    if (content.length === 0) {
      failures.push({ path: candidate, reason: "template is empty" });
      return { status: "failed" };
    }
    return { status: "valid", path: candidate, content };
  } catch (error) {
    if (ignoreMissing && isMissing(error)) {
      return { status: "missing" };
    }
    failures.push({ path: candidate, reason: errorMessage(error) });
    return { status: isMissing(error) ? "missing" : "failed" };
  }
}

async function templateNames(directory: string): Promise<string[]> {
  const names = await readdir(directory);
  const valid: string[] = [];
  for (const name of names) {
    if (!isTemplateFilename(name)) {
      continue;
    }
    try {
      if ((await readFile(join(directory, name))).length > 0) {
        valid.push(name);
      }
    } catch {
      // Invalid catalogue entries are omitted; resolution reports candidate failures.
    }
  }
  return valid;
}

function isTemplateFilename(value: string): boolean {
  return value.endsWith(".cmpl") && !value.includes("/") && !value.includes("\\") && !value.includes("\0");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
