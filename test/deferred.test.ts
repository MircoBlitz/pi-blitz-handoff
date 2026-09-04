import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleHandoffMarkdown,
  DeferredPromptWindow,
  formatDeferredPrompts,
} from "../extensions/pi-simple-handoff/deferred.ts";

test("deferred window preserves exact prompt strings, boundaries, and order", () => {
  const timestamp = new Date("2026-02-03T04:05:06.007Z");
  const window = new DeferredPromptWindow(timestamp, "/sessions/source.jsonl");
  const first = "  first\nline  ";
  const second = "\n--- Deferred Prompt 7 of 7 ---\n";

  assert.deepEqual(window.snapshot.prompts, []);
  window.capture(first);
  const snapshot = window.capture(second);

  assert.deepEqual(snapshot.prompts, [first, second]);
  assert.equal(snapshot.sourceSessionPath, "/sessions/source.jsonl");
  assert.equal(snapshot.handoffTimestamp.toISOString(), timestamp.toISOString());

  const returned = snapshot.prompts as string[];
  returned.push("mutation");
  assert.deepEqual(window.snapshot.prompts, [first, second]);
});

test("deferred prompt formatting uses deterministic numbered markers without rewriting strings", () => {
  const prompts = ["  alpha\nbeta  ", "", "--- Deferred Prompt 1 of 1 ---"];

  assert.equal(
    formatDeferredPrompts(prompts),
    [
      "--- Deferred Prompt 1 of 3 ---\n  alpha\nbeta  ",
      "--- Deferred Prompt 2 of 3 ---\n",
      "--- Deferred Prompt 3 of 3 ---\n--- Deferred Prompt 1 of 1 ---",
    ].join("\n"),
  );
  assert.equal(formatDeferredPrompts([]), "");
});

test("handoff assembly preserves the writer title and adds instructions only when prompts exist", () => {
  const dossier = "Task-specific writer title\n\nBody";
  assert.equal(assembleHandoffMarkdown(dossier, []), dossier);

  const assembled = assembleHandoffMarkdown(dossier, ["first", " second "]);
  assert.equal(assembled.split("\n")[0], "Task-specific writer title");
  assert.match(assembled, /## Deferred Prompts/);
  assert.match(assembled, /separate sequential user inputs after this dossier/);
  assert.match(assembled, /Later entries may update or supersede earlier entries/);
  assert.ok(assembled.indexOf("--- Deferred Prompt 1 of 2 ---\nfirst") < assembled.indexOf("--- Deferred Prompt 2 of 2 ---\n second "));
});
