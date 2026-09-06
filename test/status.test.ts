import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { defaultConfig } from "../extensions/pi-blitz-handoff/config.ts";
import {
  clearHandoffTerminalState,
  contextWarning,
  disposePersistentHandoffStatus,
  formatPublicStatus,
  getHandoffActivityStartedAt,
  getHandoffTerminalState,
  persistentHandoffStatus,
  protectReplacementSession,
  registerPersistentHandoffStatus,
  replacementSessionIsProtected,
  setHandoffTerminalState,
  unprotectReplacementSession,
  updatePersistentHandoffStatus,
  warningMessage,
} from "../extensions/pi-blitz-handoff/status.ts";

const config = defaultConfig("/tmp/agent");

test("persistent status is factual and does not invent numbered progress", () => {
  assert.equal(persistentHandoffStatus("inactive"), undefined);
  for (const phase of ["waiting", "ready"] as const) {
    const status = persistentHandoffStatus(phase);
    assert.equal(status, "Waiting for Session Handoff");
    assert.doesNotMatch(status, /\d+\s*\/\s*\d+|\d+%/);
  }
  assert.equal(persistentHandoffStatus("user-input-required"), "User Input Required");
});

test("persistent TUI component registers once and renders phase, terminal, and clear updates in place", async () => {
  type WidgetComponent = { render(width: number): string[]; invalidate(): void };
  type WidgetFactory = (tui: { requestRender(): void }) => WidgetComponent;
  const setWidgetCalls: Array<string[] | WidgetFactory | undefined> = [];
  let component: WidgetComponent | undefined;
  let renderRequests = 0;
  const ui = {
    setWidget(_key: string, content: string[] | WidgetFactory | undefined) {
      setWidgetCalls.push(content);
      if (typeof content === "function") {
        component = content({ requestRender: () => { renderRequests += 1; } });
      }
    },
  };

  registerPersistentHandoffStatus(ui, "stable-handoff");
  assert.equal(setWidgetCalls.length, 1);
  assert.deepEqual(component?.render(120), []);

  updatePersistentHandoffStatus(ui, "stable-handoff", "waiting");
  assert.equal(setWidgetCalls.length, 1);
  assert.equal(renderRequests, 1);
  assert.deepEqual(component?.render(120), [
    "Waiting for Session Handoff · Input available · /sh-cancel",
  ]);
  const startedAt = getHandoffActivityStartedAt("stable-handoff");
  assert.notEqual(startedAt, undefined);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(renderRequests, 1);

  updatePersistentHandoffStatus(ui, "stable-handoff", "user-input-required");
  assert.equal(setWidgetCalls.length, 1);
  assert.equal(renderRequests, 2);
  assert.deepEqual(component?.render(120), [
    "User Input Required · Input available · /sh-cancel",
  ]);
  assert.equal(getHandoffActivityStartedAt("stable-handoff"), startedAt);

  updatePersistentHandoffStatus(ui, "stable-handoff", "inactive", "finished");
  assert.equal(setWidgetCalls.length, 1);
  assert.equal(renderRequests, 3);
  assert.match(component?.render(120)[0] ?? "", /^Session Handoff Finished · \d+ sec$/);

  updatePersistentHandoffStatus(ui, "stable-handoff", "inactive");
  assert.equal(setWidgetCalls.length, 1);
  assert.equal(renderRequests, 4);
  assert.deepEqual(component?.render(120), []);

  disposePersistentHandoffStatus(ui, "stable-handoff");
  assert.equal(setWidgetCalls.length, 2);
  assert.equal(setWidgetCalls.at(-1), undefined);
  assert.equal(getHandoffActivityStartedAt("stable-handoff"), undefined);
});

test("finished widget adds separate wait and handoff durations measured at accepted GO", () => {
  type WidgetComponent = { render(width: number): string[]; invalidate(): void };
  type WidgetFactory = (tui: { requestRender(): void }) => WidgetComponent;
  let component: WidgetComponent | undefined;
  const ui = {
    setWidget(_key: string, content: string[] | WidgetFactory | undefined) {
      if (typeof content === "function") {
        component = content({ requestRender() {} });
      }
    },
  };
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    registerPersistentHandoffStatus(ui, "timed-handoff");
    updatePersistentHandoffStatus(ui, "timed-handoff", "waiting");
    now += 180_000;
    updatePersistentHandoffStatus(ui, "timed-handoff", "ready");
    now += 15_000;
    updatePersistentHandoffStatus(ui, "timed-handoff", "inactive", "finished");

    assert.deepEqual(component?.render(120), [
      "Session Handoff Finished · 195 sec",
      "Wait Time 180 sec · Handoff Time 15 sec",
    ]);
    for (const line of component?.render(20) ?? []) {
      assert.ok(visibleWidth(line) <= 20);
    }
  } finally {
    Date.now = originalNow;
    disposePersistentHandoffStatus(ui, "timed-handoff");
  }
});

test("persistent TUI component respects narrow widths for ANSI-colored status", () => {
  type WidgetComponent = { render(width: number): string[]; invalidate(): void };
  type WidgetFactory = (tui: { requestRender(): void }) => WidgetComponent;
  let component: WidgetComponent | undefined;
  const ui = {
    theme: {
      fg(_color: "success" | "warning" | "error", text: string) {
        return `\u001b[33m${text}\u001b[39m`;
      },
    },
    setWidget(_key: string, content: string[] | WidgetFactory | undefined) {
      if (typeof content === "function") {
        component = content({ requestRender() {} });
      }
    },
  };

  registerPersistentHandoffStatus(ui, "narrow-handoff");
  updatePersistentHandoffStatus(ui, "narrow-handoff", "waiting", undefined, false, undefined, 0, undefined, true);
  assert.deepEqual(component?.render(120), [
    "\u001b[33mWaiting for Session Handoff · Input available · /sh-cancel\u001b[39m",
    "\u001b[33mAwaiting User GO · Tell your LLM to start when ready\u001b[39m",
  ]);

  for (const width of [0, 1, 20, 75]) {
    const lines: string[] = component?.render(width) ?? [];
    assert.equal(lines.length, 2);
    assert.ok(visibleWidth(lines[0] ?? "") <= width);
  }

  disposePersistentHandoffStatus(ui, "narrow-handoff");
});

test("waiting is yellow and an open user choice is red", () => {
  const colors: string[] = [];
  const ui = {
    theme: {
      fg(color: "success" | "warning" | "error", text: string) {
        colors.push(color);
        return `${color}:${text}`;
      },
    },
    setWidget() {},
  };

  updatePersistentHandoffStatus(ui, "colors", "waiting");
  updatePersistentHandoffStatus(ui, "colors", "user-input-required");
  assert.deepEqual(colors, ["warning", "error"]);
});

test("non-TUI status transport remains string arrays", () => {
  const updates: Array<string[] | undefined> = [];
  const ui = {
    setWidget(_key: string, content: string[] | undefined) {
      updates.push(content);
    },
  };

  updatePersistentHandoffStatus(ui, "non-tui-handoff", "waiting");
  updatePersistentHandoffStatus(ui, "non-tui-handoff", "inactive", "cancelled");
  updatePersistentHandoffStatus(ui, "non-tui-handoff", "inactive");

  assert.equal(Array.isArray(updates[0]), true);
  assert.equal(Array.isArray(updates[1]), true);
  assert.equal(updates[2], undefined);
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
  assert.equal(statuses.at(-1), "Writing Session Handoff · Inputs deferred (0) · /sh-cancel");
  assert.ok((indicators.at(-1)?.frames?.length ?? 0) > 1);
  assert.equal(indicators.at(-1)?.intervalMs, 120);
  assert.doesNotMatch(statuses.at(-1) ?? "", /\d+\s*\/\s*\d+|\d+%/);

  updatePersistentHandoffStatus(ui, "handoff", "ready", undefined, true, undefined, 2);
  assert.equal(statuses.at(-1), "Writing Session Handoff · Inputs deferred (2) · /sh-cancel");

  updatePersistentHandoffStatus(ui, "handoff", "inactive", "failed", true);
  assert.match(statuses.at(-1) ?? "", /^Session Handoff Failed · \d+ sec$/);
  assert.equal(indicators.at(-1), undefined);
  assert.equal(persistentHandoffStatus("ready", undefined, true), "Writing Session Handoff");
  assert.match(formatPublicStatus("ready", undefined, config, undefined, true), /^Writing Session Handoff\./);
});

test("terminal status renders total elapsed seconds once for every outcome", () => {
  for (const [terminalState, label] of [
    ["finished", "Session Handoff Finished"],
    ["failed", "Session Handoff Failed"],
    ["cancelled", "Session Handoff Cancelled"],
  ] as const) {
    const statuses: Array<string | undefined> = [];
    const ui = {
      setWidget(_key: string, content: string[] | undefined) {
        statuses.push(content?.join("\n"));
      },
    };
    const key = `terminal-${terminalState}`;

    updatePersistentHandoffStatus(ui, key, "waiting");
    updatePersistentHandoffStatus(ui, key, "inactive", terminalState);

    assert.equal(statuses.length, 2);
    assert.match(statuses.at(-1) ?? "", new RegExp(`^${label} · \\d+ sec$`));
    assert.equal(getHandoffActivityStartedAt(key), undefined);
  }
});

test("terminal status is factual, session-correlated, and overrides active wording", () => {
  const sessionFile = "/sessions/replacement.jsonl";
  setHandoffTerminalState(sessionFile, "finished");
  protectReplacementSession(sessionFile);
  assert.equal(getHandoffTerminalState(sessionFile), "finished");
  assert.equal(replacementSessionIsProtected(sessionFile), true);
  assert.equal(persistentHandoffStatus("inactive", "finished"), "Session Handoff Finished");
  assert.equal(persistentHandoffStatus("ready", "failed"), "Session Handoff Failed");
  assert.equal(persistentHandoffStatus("user-input-required", "cancelled"), "Session Handoff Cancelled");
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
    "user-input-required",
    { tokens: 650, contextWindow: 1000, percent: 65 },
    { ...config, automaticSessionHandoff: true, automaticSessionHandoffPercent: 70 },
  );

  assert.match(text, /^User Input Required\./);
  assert.match(text, /Context usage: 65% \(650 tokens of 1000\)\./);
  assert.match(text, /Warning threshold: 60%; critical threshold: 90%\./);
  assert.match(text, /Automatic session handoff: enabled at 70%\./);
  assert.match(text, /Readiness reminder delay: 60 seconds\.$/);

  const inactive = formatPublicStatus("inactive", undefined, config);
  assert.match(inactive, /^No active session handoff\./);
  assert.match(inactive, /Context usage: unavailable\./);
  assert.match(inactive, /Automatic session handoff: disabled\./);
});
