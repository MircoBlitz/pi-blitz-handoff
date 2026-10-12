import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initTheme, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { OverlayDialog, selectDialog, inputDialog, confirmDialog, documentDialog } from "../extensions/overlay-dialog.ts";
import { ConfigDialog } from "../extensions/config-dialog.ts";
import { defaultConfig, handoffPaths, loadConfig, saveConfig } from "../extensions/config.ts";
import { RecoveryDialog } from "../extensions/recovery-dialog.ts";
import { createDialogHarness } from "./extension-harness.ts";

// These tests run genuine native controls in a focused terminal/UI test double.
// They do not launch Pi, a terminal renderer, or a real model.
function component(content: ConstructorParameters<typeof OverlayDialog>[4], description = "Current state: unchanged", signal?: AbortSignal) {
  const rig = createDialogHarness();
  const results: Array<string | undefined> = [];
  let renders = 0;
  const tui = { terminal: rig.terminal, requestRender() { renders += 1; } } as unknown as TUI;
  const dialog = new OverlayDialog(tui, rig.theme, "Handoff · 界 👩‍💻", description, content, (value) => results.push(value), signal);
  return { ...rig, dialog, results, getRenders: () => renders };
}

function plain(lines: string[]): string {
  return lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
}

test("native selection scrolls every option and preserves selection through resize and invalidation", () => {
  const items = Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: `Setting ${i} 界 é 👩‍💻`, description: `Current value ${i}` }));
  const rig = component({ kind: "select", items });
  for (const rows of [8, 12, 28]) {
    rig.terminal.rows = rows;
    for (const width of [1, 2, 8, 18, 24, 40, 80]) {
      const rendered = rig.dialog.render(width);
      assert.ok(rendered.length <= rows - 2);
      assert.ok(rendered.every((line) => visibleWidth(line) <= width), `overflow at width ${width}`);
    }
  }
  for (let i = 0; i < 23; i += 1) rig.dialog.handleInput("\x1b[B");
  rig.terminal.rows = 10;
  rig.dialog.invalidate();
  assert.match(plain(rig.dialog.render(30)), /Setting 23/);
  rig.dialog.handleInput("\r");
  assert.deepEqual(rig.results, ["23"]);
});

test("native Input owns editing, horizontal Unicode scrolling, focus and IME cursor propagation", () => {
  const rig = component({ kind: "input", placeholder: "Current value: 25" });
  rig.dialog.focused = true;
  rig.dialog.handleInput("\x1b[200~界é👩‍💻abcdefghijklmnopqrstuvwxyz\x1b[201~");
  const focused = rig.dialog.render(24);
  assert.ok(focused.some((line) => line.includes(CURSOR_MARKER)));
  assert.ok(focused.every((line) => visibleWidth(line) <= 24));
  rig.dialog.focused = false;
  assert.equal(rig.dialog.render(24).some((line) => line.includes(CURSOR_MARKER)), false);
  rig.dialog.focused = true;
  rig.dialog.handleInput("\x7f");
  rig.dialog.handleInput("\r");
  assert.deepEqual(rig.results, ["界é👩‍💻abcdefghijklmnopqrstuvwxy"]);
  rig.dialog.handleInput("ignored after done");
  assert.equal(rig.results.length, 1);
});

test("complete raw content remains reachable with native ScrollView arrows, paging and Home/End at narrow widths", () => {
  const text = Array.from({ length: 120 }, (_, i) => `PROMPT-${i} 界 é 👩‍💻 content`).join("\n");
  const rig = component({ kind: "document", text });
  rig.terminal.rows = 12;
  const observed: string[] = [];
  for (let i = 0; i < 500; i += 1) {
    const lines = rig.dialog.render(28);
    assert.ok(lines.every((line) => visibleWidth(line) <= 28));
    observed.push(plain(lines));
    rig.dialog.handleInput("\x1b[B");
  }
  for (let i = 0; i < 120; i += 1) assert.ok(observed.some((screen) => screen.includes(`PROMPT-${i} `)), `unreachable prompt ${i}`);
  rig.dialog.handleInput("\x1b[H");
  assert.match(plain(rig.dialog.render(28)), /PROMPT-0 /);
  rig.dialog.handleInput("\x1b[6~");
  assert.doesNotMatch(plain(rig.dialog.render(28)), /PROMPT-0 /);
  rig.dialog.handleInput("\x1b[5~");
  assert.match(plain(rig.dialog.render(28)), /PROMPT-0 /);
  rig.dialog.handleInput("\x1b[F");
  assert.match(plain(rig.dialog.render(28)), /PROMPT-119 /);
  rig.dialog.handleInput("\r");
  assert.deepEqual(rig.results, ["close"]);
});

test("theme invalidation rebuilds Markdown and recolors borders without losing scroll position", () => {
  const rig = component({ kind: "document", text: "# Heading\n\n**Body**\n\n" + "details\n".repeat(40), markdown: true });
  const before = rig.dialog.render(50).join("\n");
  rig.dialog.handleInput("\x1b[6~");
  const scrolled = plain(rig.dialog.render(50));
  rig.themeState.color = 31;
  initTheme("light", false);
  rig.dialog.invalidate();
  const after = rig.dialog.render(50).join("\n");
  assert.ok(after.includes("\x1b[31m"));
  assert.notEqual(before, after);
  assert.equal(plain(rig.dialog.render(50)), scrolled);
  rig.dialog.handleInput("\x1b[H");
  assert.notEqual(rig.dialog.render(50).join("\n"), before);
});

test("AbortSignal and dismissal complete once; disposal removes listeners and disables late input", () => {
  for (const data of ["\x1b", "\x03"]) {
    const controller = new AbortController();
    const rig = component({ kind: "input" }, "Edit", controller.signal);
    rig.dialog.handleInput(data);
    controller.abort();
    rig.dialog.handleInput("\r");
    assert.deepEqual(rig.results, [undefined]);
  }
  const controller = new AbortController();
  const rig = component({ kind: "select", items: [{ value: "ready", label: "Ready" }] }, "Reason", controller.signal);
  rig.dialog.render(40);
  controller.abort();
  assert.deepEqual(rig.results, [undefined]);
  assert.equal(rig.getRenders(), 0);
  const disposed = component({ kind: "input" });
  disposed.dialog.dispose();
  disposed.dialog.handleInput("\r");
  assert.deepEqual(disposed.results, []);
});

test("shared presentation helpers create genuine overlays, use native keys and preserve value identity", async () => {
  const rig = createDialogHarness({ select: async () => "Label", input: async () => "界 value", confirm: async () => true, document: async () => "back" });
  const ctx = { mode: "tui", ui: { custom: rig.custom } } as unknown as ExtensionCommandContext;
  assert.equal(await selectDialog(ctx, "Menu", [{ value: "action", label: "Label" }]), "action");
  assert.equal(await inputDialog(ctx, "Edit value"), "界 value");
  assert.equal(await confirmDialog(ctx, "Create missing directory?", "/exact/path"), true);
  assert.equal(await documentDialog(ctx, "Prompt contents", "Complete prompt"), "close");
  assert.equal(rig.options.length, 4);
  assert.ok(rig.options.every((opts) => (opts as { overlay?: boolean }).overlay === true));
  assert.ok(rig.keys.includes("\x1b[B"));
  assert.ok(rig.screens.flat().some((line) => line.includes("Complete prompt")));
});

test("RPC explicitly keeps native select/input/confirm without creating a custom component", async () => {
  const calls: string[] = [];
  const ctx = { mode: "rpc", ui: {
    async select(_title: string, options: string[]) { calls.push("select"); return options[0]; },
    async input() { calls.push("input"); return "value"; },
    async confirm() { calls.push("confirm"); return true; },
    custom() { throw new Error("RPC has no custom terminal overlays"); },
  } } as unknown as ExtensionCommandContext;
  assert.equal(await selectDialog(ctx, "Menu", [{ value: "start", label: "Start handoff" }]), "start");
  assert.equal(await inputDialog(ctx, "Edit"), "value");
  assert.equal(await confirmDialog(ctx, "Confirm", "Path"), true);
  assert.equal(await documentDialog(ctx, "Contents", "Complete prompt"), "Return to file actions");
  assert.deepEqual(calls, ["select", "input", "confirm", "select"]);
});

async function storage(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), "pi-blitz-handoff-overlay-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = handoffPaths(root);
  await mkdir(paths.recoveryDirectory, { recursive: true });
  await mkdir(paths.templateDirectory, { recursive: true });
  await writeFile(join(paths.templateDirectory, "call_default.cmpl"), "call default");
  await writeFile(join(paths.templateDirectory, "handoff_default.cmpl"), "handoff default");
  await saveConfig(root, defaultConfig(root));
  return { root, paths };
}

test("TUI settings persist confirmed edits immediately through native input, template selection and exact directory confirmation", async (t) => {
  const { root } = await storage(t);
  const directory = join(root, "new-recovery");
  const selections = ["Writer attempts: 3", "Recovery directory: " + defaultConfig(root).recoveryDirectory, "Call template: call_default.cmpl", "Enter another filename", undefined];
  const inputs = ["5", directory, "call_custom.cmpl"];
  const applied: number[] = [];
  const rig = createDialogHarness({
    select: async (_title, options) => {
      const answer = selections.shift();
      if (answer?.startsWith("Recovery directory")) {
        assert.ok(options.includes("Writer attempts: 5"));
        assert.equal((await loadConfig(root)).writerAttempts, 5);
      }
      return answer;
    },
    input: async () => inputs.shift(),
    confirm: async (_title, message) => { assert.ok(message.endsWith(directory)); return true; },
  });
  const ctx = { mode: "tui", hasUI: true, ui: { custom: rig.custom, notify() {} } } as unknown as ExtensionCommandContext;
  await new ConfigDialog(root, (config) => { applied.push(config.writerAttempts); }).run(ctx);
  const saved = await loadConfig(root);
  assert.equal(saved.writerAttempts, 5);
  assert.equal(saved.recoveryDirectory, directory);
  assert.equal(saved.callTemplate, "call_custom.cmpl");
  assert.equal((await stat(directory)).isDirectory(), true);
  assert.deepEqual(applied, [5, 5, 5]);
  assert.ok(rig.options.every((opts) => (opts as { overlay?: boolean }).overlay));
});

test("recovery inspection scrolls the complete stored prompts read-only before real execution/deletion", async (t) => {
  const { paths } = await storage(t);
  const filename = "2026-02-03T04-05-06-007Z-source.md";
  const content = "--- Deferred Prompt 1 of 1 ---\n" + "review context\n".repeat(100) + "FINAL PROMPT 界";
  await writeFile(join(paths.recoveryDirectory, filename), content);
  const answers = [`2026-02-03T04:05:06.007Z — ${filename}`, "Inspect complete contents", "Execute recovered prompts"];
  const sent: string[] = [];
  const rig = createDialogHarness({ select: async () => answers.shift(), document: async () => {
    const dialog = rig.components.at(-1);
    assert.ok(dialog);
    // A resize is rendered before the next key arrives in the native TUI.
    rig.terminal.columns = 45;
    dialog.render(40);
    dialog.handleInput?.("\x1b[F");
    assert.match(plain(dialog.render(40)), /FINAL PROMPT 界/);
    assert.equal(await readFile(join(paths.recoveryDirectory, filename), "utf8"), content);
    return "back";
  } });
  const errors: string[] = [];
  const ctx = { mode: "tui", hasUI: true, ui: { custom: rig.custom,
    notify(message: string, type?: string) { if (type === "error") errors.push(message); },
  } } as unknown as ExtensionCommandContext;
  await new RecoveryDialog(paths.recoveryDirectory, (message) => { sent.push(message as string); }).run(ctx);
  assert.deepEqual(errors, []);
  assert.ok(sent[0]?.endsWith(content));
  assert.deepEqual(await readdir(paths.recoveryDirectory), []);
  assert.equal(rig.options.length, 4);
});
