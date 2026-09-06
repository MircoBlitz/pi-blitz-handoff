import assert from "node:assert/strict";
import test from "node:test";

import {
  createReadinessKey,
  readinessPrompt,
  readinessReminder,
  SESSION_HANDOFF_GO_TOOL,
  SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL,
} from "../extensions/pi-blitz-handoff/readiness.ts";

test("readiness keys are fresh and UUID-backed", () => {
  const first = createReadinessKey();
  const second = createReadinessKey();
  assert.notEqual(first, second);
  assert.match(first, /^handoff-go-[0-9a-f-]{36}$/);
});

test("runtime suffix preserves correlation and semantic tool choice for any call template", () => {
  const prompt = readinessPrompt("CUSTOM", "go-current");
  assert.match(prompt, /^CUSTOM\n/);
  assert.equal(prompt.match(/go-current/g)?.length, 2);
  assert.match(prompt, new RegExp(SESSION_HANDOFF_GO_TOOL));
  assert.match(prompt, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(prompt, /Prefer direct GO when uncertain/);
  assert.match(prompt, /concrete active collaboration or user interaction/);
  assert.match(prompt, /required model-owned work, tool execution, subagents, background work, or required output/);
  assert.doesNotMatch(prompt, /automatic|command|public tool/i);
});

test("the one-shot reminder asks for silent semantic re-evaluation with the same key", () => {
  const reminder = readinessReminder("go-current");
  assert.equal(reminder.match(/go-current/g)?.length, 1);
  assert.match(reminder, new RegExp(SESSION_HANDOFF_GO_TOOL));
  assert.match(reminder, new RegExp(SESSION_HANDOFF_GO_WITH_USER_DEFERRAL_TOOL));
  assert.match(reminder, /produce no normal text/);
});
