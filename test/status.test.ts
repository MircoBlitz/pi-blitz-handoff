import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig } from "../extensions/pi-simple-handoff/config.ts";
import {
  clearHandoffTerminalState,
  contextWarning,
  formatPublicStatus,
  getHandoffTerminalState,
  persistentHandoffStatus,
  protectReplacementSession,
  replacementSessionIsProtected,
  setHandoffTerminalState,
  unprotectReplacementSession,
  updatePersistentHandoffStatus,
  warningMessage,
} from "../extensions/pi-simple-handoff/status.ts";

const config = defaultConfig("/tmp/agent");

test("persistent status is factual and does not invent numbered progress", () => {
  assert.equal(persistentHandoffStatus("inactive"), undefined);
  for (const phase of ["waiting", "checking", "retry-delay", "ready"] as const) {
    const status = persistentHandoffStatus(phase);
    assert.equal(status, "Waiting for Session Handoff");
    assert.doesNotMatch(status, /\d+\s*\/\s*\d+|\d+%/);
  }
});

test("writing status uses an indeterminate public activity indicator and terminal states override it", () => {
  const statuses: Array<string | undefined> = [];
  const indicators: Array<{ frames?: string[]; intervalMs?: number } | undefined> = [];
  const ui = {
    setWidget(_key: string, content: string[] | undefined) {
      statuses.push(content?.join("\n"));
    },
    setWorkingIndicator(options?: { frames?: string[]; intervalMs?: number }) {
      indicators.push(options);
    },
  };

  updatePersistentHandoffStatus(ui, "handoff", "ready", undefined, true);
  assert.match(statuses.at(-1) ?? "", /^Session Handoff · starting session export · Input deferred · \d+ sec · \/sh cancel$/);
  assert.ok((indicators.at(-1)?.frames?.length ?? 0) > 1);
  assert.equal(indicators.at(-1)?.intervalMs, 120);
  assert.doesNotMatch(statuses.at(-1) ?? "", /\d+\s*\/\s*\d+|\d+%/);

  updatePersistentHandoffStatus(ui, "handoff", "inactive", "failed", true);
  assert.match(statuses.at(-1) ?? "", /^Session Handoff · failed · \d+ sec$/);
  assert.equal(indicators.at(-1), undefined);
  assert.equal(persistentHandoffStatus("ready", undefined, true), "Writing Session Handoff");
  assert.match(formatPublicStatus("ready", undefined, config, undefined, true), /^Writing Session Handoff\./);
});

test("terminal status is factual, session-correlated, and overrides active wording", () => {
  const sessionFile = "/sessions/replacement.jsonl";
  setHandoffTerminalState(sessionFile, "finished");
  protectReplacementSession(sessionFile);
  assert.equal(getHandoffTerminalState(sessionFile), "finished");
  assert.equal(replacementSessionIsProtected(sessionFile), true);
  assert.equal(persistentHandoffStatus("inactive", "finished"), "Session Handoff Finished");
  assert.equal(persistentHandoffStatus("ready", "failed"), "Session Handoff Failed");
  assert.equal(persistentHandoffStatus("checking", "cancelled"), "Session Handoff Cancelled");
  assert.match(formatPublicStatus("inactive", undefined, config, "finished"), /^Session Handoff Finished\./);
  unprotectReplacementSession(sessionFile);
  clearHandoffTerminalState(sessionFile);
  assert.equal(replacementSessionIsProtected(sessionFile), false);
  assert.equal(getHandoffTerminalState(sessionFile), undefined);
});

test("warning is advisory once while critical can repeat at settled turns", () => {
  assert.equal(contextWarning(59.9, config, false), undefined);
  assert.equal(contextWarning(60, config, false), "advisory");
  assert.equal(contextWarning(60, config, true), undefined);
  assert.equal(contextWarning(90, config, false), "critical");
  assert.equal(contextWarning(90, config, true), "critical");
  assert.equal(contextWarning(null, config, false), undefined);

  assert.equal(warningMessage("advisory", 60), "Context usage is 60%. Consider a session handoff.");
  assert.equal(
    warningMessage("critical", 91.25),
    "Context usage is critical at 91.3%. A session handoff is recommended.",
  );
});

test("public status reports context, relevant thresholds, configuration, and handoff state concisely", () => {
  const text = formatPublicStatus(
    "checking",
    { tokens: 650, contextWindow: 1000, percent: 65 },
    { ...config, automaticSessionHandoff: true, automaticSessionHandoffPercent: 70 },
  );

  assert.match(text, /^Waiting for Session Handoff\./);
  assert.match(text, /Context usage: 65% \(650 tokens of 1000\)\./);
  assert.match(text, /Warning threshold: 60%; critical threshold: 90%\./);
  assert.match(text, /Automatic session handoff: enabled at 70%\./);
  assert.match(text, /Readiness retry delay: 60 seconds\.$/);

  const inactive = formatPublicStatus("inactive", undefined, config);
  assert.match(inactive, /^No active session handoff\./);
  assert.match(inactive, /Context usage: unavailable\./);
  assert.match(inactive, /Automatic session handoff: disabled\./);
});
