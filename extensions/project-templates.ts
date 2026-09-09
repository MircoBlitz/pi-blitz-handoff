import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { atomicWriteFile, ensureDirectory, isMissing } from "./filesystem.ts";
import { isTemplateFilename } from "./templates.ts";

export interface ProjectTemplateAssignment {
  callTemplate: string | null;
  handoffTemplate: string | null;
}

export type ProjectTemplateAssignments = ReadonlyMap<string, ProjectTemplateAssignment>;

export interface ResolvedProjectTemplateAssignment {
  callTemplate: string | null;
  handoffTemplate: string | null;
}

export async function loadProjectTemplateAssignments(
  file: string,
): Promise<ProjectTemplateAssignments> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error) {
    if (isMissing(error)) return new Map();
    throw error;
  }
  return validateProjectTemplateAssignments(value);
}

export function validateProjectTemplateAssignments(value: unknown): ProjectTemplateAssignments {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Project template assignments must be an object");
  }

  const assignments = new Map<string, ProjectTemplateAssignment>();
  for (const [directory, candidate] of Object.entries(value)) {
    if (!isAbsolute(directory)) {
      throw new Error(`Project template directory must be absolute: ${directory}`);
    }
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error(`Project template assignment must be an object: ${directory}`);
    }

    const record = candidate as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== "callTemplate" || keys[1] !== "handoffTemplate") {
      throw new Error(`Project template assignment must contain exactly callTemplate and handoffTemplate: ${directory}`);
    }

    const normalized = resolve(directory);
    if (assignments.has(normalized)) {
      throw new Error(`Duplicate normalized project template directory: ${normalized}`);
    }
    assignments.set(normalized, validateAssignment(directory, {
      callTemplate: record.callTemplate,
      handoffTemplate: record.handoffTemplate,
    }));
  }
  return assignments;
}

export function resolveProjectTemplateAssignment(
  assignments: ProjectTemplateAssignments,
  cwd: string,
): ResolvedProjectTemplateAssignment {
  let directory = resolve(cwd);
  let callTemplate: string | null = null;
  let handoffTemplate: string | null = null;
  while (true) {
    const assignment = assignments.get(directory);
    callTemplate ??= assignment?.callTemplate ?? null;
    handoffTemplate ??= assignment?.handoffTemplate ?? null;
    if (callTemplate !== null && handoffTemplate !== null) break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return { callTemplate, handoffTemplate };
}

export async function saveProjectTemplateAssignment(
  file: string,
  directory: string,
  assignment: ProjectTemplateAssignment,
): Promise<void> {
  const assignments = new Map(await loadProjectTemplateAssignments(file));
  const normalized = resolve(directory);
  assignments.set(normalized, validateAssignment(normalized, assignment));
  await writeAssignments(file, assignments);
}

export async function removeProjectTemplateAssignment(
  file: string,
  directory: string,
): Promise<boolean> {
  const assignments = new Map(await loadProjectTemplateAssignments(file));
  const removed = assignments.delete(resolve(directory));
  if (removed) await writeAssignments(file, assignments);
  return removed;
}

async function writeAssignments(
  file: string,
  assignments: ReadonlyMap<string, ProjectTemplateAssignment>,
): Promise<void> {
  await ensureDirectory(dirname(file));
  const sorted = [...assignments.entries()].sort(([left], [right]) => left.localeCompare(right));
  const value = Object.fromEntries(sorted.map(([directory, assignment]) => [directory, assignment]));
  await atomicWriteFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function validateAssignment(
  directory: string,
  assignment: { callTemplate: unknown; handoffTemplate: unknown },
): ProjectTemplateAssignment {
  const validated = {
    callTemplate: templateSelection(assignment.callTemplate, "callTemplate", directory),
    handoffTemplate: templateSelection(assignment.handoffTemplate, "handoffTemplate", directory),
  };
  if (validated.callTemplate === null && validated.handoffTemplate === null) {
    throw new Error(`Project template assignment must select at least one concrete template: ${directory}`);
  }
  return validated;
}

function templateSelection(
  value: unknown,
  role: "callTemplate" | "handoffTemplate",
  directory: string,
): string | null {
  if (value === null) return null;
  const prefix = role === "callTemplate" ? "call_" : "handoff_";
  if (typeof value !== "string" || !isTemplateFilename(value) || !value.startsWith(prefix)) {
    throw new Error(`${role} must be <Autodiscover> or a ${prefix}*.cmpl filename for project: ${directory}`);
  }
  return value;
}
