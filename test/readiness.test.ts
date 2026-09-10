import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadinessKey,
  readinessPrompt,
  readinessReminder,
  SESSION_HANDOFF_GO_TOOL,
  SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL,
} from "../extensions/readiness.ts";

test("readiness keys are fresh and UUID-backed", () => {
  const first = createReadinessKey();
  const second = createReadinessKey();
  assert.notEqual(first, second);
  assert.match(first, /^handoff-go-[0-9a-f-]{36}$/);
});

test("explicit readiness preserves correlation without adding work-boundary policy", () => {
  const prompt = readinessPrompt("CUSTOM WORKFLOW", "go-current", true);
  assert.match(prompt, /^CUSTOM WORKFLOW\n/);
  assert.equal(prompt.match(/go-current/g)?.length, 2);
  assert.match(prompt, new RegExp(SESSION_HANDOFF_GO_TOOL));
  assert.match(prompt, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.doesNotMatch(prompt, /Prefer direct GO when uncertain/);
  assert.doesNotMatch(prompt, /concrete active collaboration or user interaction/);
  assert.doesNotMatch(prompt, /required model-owned work/);
});

test("automatic readiness permits only direct GO", () => {
  const prompt = readinessPrompt("CUSTOM", "go-current", false);
  assert.match(prompt, /initiated automatically/);
  assert.equal(prompt.match(/go-current/g)?.length, 1);
  assert.match(prompt, new RegExp(SESSION_HANDOFF_GO_TOOL));
  assert.doesNotMatch(prompt, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(prompt, /User deferral is unavailable/);
});

test("one-shot reminders reuse the Call Template and preserve only source-specific protocol", () => {
  const explicit = readinessReminder("CUSTOM REMINDER WORKFLOW", "go-explicit", true);
  assert.match(explicit, /CUSTOM REMINDER WORKFLOW/);
  assert.equal(explicit.match(/go-explicit/g)?.length, 2);
  assert.match(explicit, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(explicit, /produce no normal text/);
  assert.doesNotMatch(explicit, /required work or output/);
  assert.doesNotMatch(explicit, /active user collaboration/);

  const automatic = readinessReminder("AUTOMATIC WORKFLOW", "go-automatic", false);
  assert.match(automatic, /AUTOMATIC WORKFLOW/);
  assert.equal(automatic.match(/go-automatic/g)?.length, 1);
  assert.match(automatic, new RegExp(SESSION_HANDOFF_GO_TOOL));
  assert.doesNotMatch(automatic, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(automatic, /User deferral is unavailable/);
});
