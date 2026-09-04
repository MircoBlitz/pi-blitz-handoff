import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReadinessAnswer,
  createReadinessIdentifiers,
  readinessPrompt,
} from "../extensions/pi-simple-handoff/readiness.ts";

test("readiness identifiers are fresh, distinct, and UUID-backed", () => {
  const first = createReadinessIdentifiers();
  const second = createReadinessIdentifiers();

  assert.notEqual(first.go, first.notYet);
  assert.notEqual(first.go, second.go);
  assert.notEqual(first.notYet, second.notYet);
  assert.match(first.go, /^handoff-go-[0-9a-f-]{36}$/);
  assert.match(first.notYet, /^handoff-not-yet-[0-9a-f-]{36}$/);
});

test("readiness prompt asks only about remaining session-owned work and requires one current identifier", () => {
  const ids = { go: "go-current", notYet: "not-yet-current" };
  const prompt = readinessPrompt(ids);

  assert.match(prompt, /^Is any session-owned work still active\?/);
  assert.equal(prompt.match(/go-current/g)?.length, 1);
  assert.equal(prompt.match(/not-yet-current/g)?.length, 1);
  assert.match(prompt, /exactly one current identifier and nothing else/);
});

test("only exact current identifiers classify as answers", () => {
  const ids = { go: "go-current", notYet: "not-yet-current" };

  assert.equal(classifyReadinessAnswer("go-current", ids), "go");
  assert.equal(classifyReadinessAnswer("not-yet-current", ids), "not-yet");
  assert.equal(classifyReadinessAnswer(" go-current", ids), "invalid");
  assert.equal(classifyReadinessAnswer("go-current\n", ids), "invalid");
  assert.equal(classifyReadinessAnswer("go-stale", ids), "invalid");
  assert.equal(classifyReadinessAnswer(undefined, ids), "invalid");
});
