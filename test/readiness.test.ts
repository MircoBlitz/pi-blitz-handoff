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

test("explicit readiness preserves correlation and semantic tool choice for any call template", () => {
  const prompt = readinessPrompt("CUSTOM", "go-current", true);
  assert.match(prompt, /^CUSTOM\n/);
  assert.equal(prompt.match(/go-current/g)?.length, 2);
  assert.match(prompt, new RegExp(SESSION_HANDOFF_GO_TOOL));
  assert.match(prompt, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(prompt, /Prefer direct GO when uncertain/);
  assert.match(prompt, /concrete active collaboration or user interaction/);
  assert.match(prompt, /required model-owned work, tool execution, subagents, background work, or required output/);
});

test("automatic readiness permits only direct GO", () => {
  const prompt = readinessPrompt("CUSTOM", "go-current", false);
  assert.match(prompt, /initiated automatically/);
  assert.equal(prompt.match(/go-current/g)?.length, 1);
  assert.match(prompt, new RegExp(SESSION_HANDOFF_GO_TOOL));
  assert.doesNotMatch(prompt, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(prompt, /User deferral is unavailable/);
});

test("the one-shot reminders preserve the source-specific readiness choice", () => {
  const explicit = readinessReminder("go-explicit", true);
  assert.equal(explicit.match(/go-explicit/g)?.length, 1);
  assert.match(explicit, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(explicit, /produce no normal text/);

  const automatic = readinessReminder("go-automatic", false);
  assert.equal(automatic.match(/go-automatic/g)?.length, 1);
  assert.match(automatic, new RegExp(SESSION_HANDOFF_GO_TOOL));
  assert.doesNotMatch(automatic, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(automatic, /user deferral is unavailable/);
});
