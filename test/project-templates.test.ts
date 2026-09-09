import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  loadProjectTemplateAssignments,
  removeProjectTemplateAssignment,
  resolveProjectTemplateAssignment,
  saveProjectTemplateAssignment,
  validateProjectTemplateAssignments,
} from "../extensions/project-templates.ts";

test("project template assignments require absolute roots and complete role selections", () => {
  assert.throws(
    () => validateProjectTemplateAssignments([]),
    /must be an object/,
  );
  assert.throws(
    () => validateProjectTemplateAssignments({ relative: { callTemplate: null, handoffTemplate: null } }),
    /must be absolute/,
  );
  assert.throws(
    () => validateProjectTemplateAssignments({ "/project": { callTemplate: null } }),
    /exactly callTemplate and handoffTemplate/,
  );
  assert.throws(
    () => validateProjectTemplateAssignments({
      "/project": { callTemplate: null, handoffTemplate: null },
    }),
    /at least one concrete template/,
  );
  assert.throws(
    () => validateProjectTemplateAssignments({
      "/project": { callTemplate: "wrong.cmpl", handoffTemplate: "handoff_default.cmpl" },
    }),
    /callTemplate/,
  );
});

test("independent role resolution walks only upward", () => {
  const assignments = validateProjectTemplateAssignments({
    "/Users/example": { callTemplate: "call_home.cmpl", handoffTemplate: "handoff_home.cmpl" },
    "/Users/example/Projects": { callTemplate: "call_projects.cmpl", handoffTemplate: null },
    "/Users/example/Projects/App": { callTemplate: null, handoffTemplate: "handoff_app.cmpl" },
  });

  assert.deepEqual(resolveProjectTemplateAssignment(assignments, "/Users/example/Projects/App/src"), {
    callTemplate: "call_projects.cmpl",
    handoffTemplate: "handoff_app.cmpl",
  });
  assert.deepEqual(resolveProjectTemplateAssignment(assignments, "/opt/project"), {
    callTemplate: null,
    handoffTemplate: null,
  });
});

test("saving edits one normalized directory and removal restores an unselected state", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-project-templates-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "managed", "project-templates.json");
  const project = join(root, "Projects", "App");

  await saveProjectTemplateAssignment(file, project, {
    callTemplate: null,
    handoffTemplate: "handoff_precise.cmpl",
  });
  await saveProjectTemplateAssignment(file, `${project}/.`, {
    callTemplate: "call_fast.cmpl",
    handoffTemplate: null,
  });

  const loaded = await loadProjectTemplateAssignments(file);
  assert.equal(loaded.size, 1);
  assert.deepEqual(loaded.get(project), {
    callTemplate: "call_fast.cmpl",
    handoffTemplate: null,
  });
  assert.match(await readFile(file, "utf8"), /"callTemplate": "call_fast\.cmpl"/);

  assert.equal(await removeProjectTemplateAssignment(file, project), true);
  assert.equal((await loadProjectTemplateAssignments(file)).size, 0);
  assert.equal(await removeProjectTemplateAssignment(file, project), false);
});

test("malformed persisted assignments fail instead of being ignored", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-project-templates-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "project-templates.json");
  await writeFile(file, "{not-json");

  await assert.rejects(loadProjectTemplateAssignments(file), /JSON/);
});
