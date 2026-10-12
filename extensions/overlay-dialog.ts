import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
  Input, Markdown, ScrollView, SelectList, Text, matchesKey, truncateToWidth, visibleWidth,
  type Component, type Focusable, type SelectItem, type TUI,
} from "@earendil-works/pi-tui";

export type DialogContext = Pick<ExtensionContext, "mode" | "ui">;
interface DialogOptions {
  signal?: AbortSignal;
  heading?: string;
}
type DialogContent =
  | { kind: "select"; items: SelectItem[] }
  | { kind: "input"; placeholder?: string }
  | { kind: "document"; text: string; markdown?: boolean };

/** One interaction, composed from native controls. No session/model behavior lives here. */
export class OverlayDialog implements Component, Focusable {
  private readonly input = new Input();
  private list?: SelectList;
  private listHeight = 0;
  private selectedIndex = 0;
  private text: Text | Markdown;
  private readonly scroll: ScrollView;
  private closed = false;
  private hasFocus = false;
  private readonly abort = () => this.finish(undefined);

  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly heading: string;
  private readonly description: string;
  private readonly content: DialogContent;
  private readonly done: (value: string | undefined) => void;
  private readonly signal?: AbortSignal;

  constructor(tui: TUI, theme: Theme, heading: string, description: string,
    content: DialogContent, done: (value: string | undefined) => void, signal?: AbortSignal) {
    this.tui = tui;
    this.theme = theme;
    this.heading = heading;
    this.description = description;
    this.content = content;
    this.done = done;
    this.signal = signal;
    this.text = content.kind === "document" && content.markdown
      ? new Markdown(content.text, 0, 0, getMarkdownTheme())
      : new Text(content.kind === "document" ? content.text : description, 0, 0);
    this.scroll = new ScrollView({
      render: (width) => this.text.render(width).map((line) => content.kind === "document" ? line : this.theme.fg("muted", line)),
      invalidate: () => this.text.invalidate(),
    });
    this.input.onSubmit = (value) => this.finish(value);
    this.input.onEscape = this.abort;
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }

  get focused(): boolean { return this.hasFocus; }
  set focused(value: boolean) {
    this.hasFocus = value;
    this.input.focused = value;
  }

  private finish(value: string | undefined): void {
    if (this.closed) return;
    this.closed = true;
    this.dispose();
    this.done(value);
  }

  dispose(): void {
    this.closed = true;
    this.signal?.removeEventListener("abort", this.abort);
    this.input.focused = false;
  }

  invalidate(): void {
    // Markdown embeds themed ANSI during rendering: rebuild its theme on invalidation.
    if (this.content.kind === "document" && this.content.markdown) {
      this.text = new Markdown(this.content.text, 0, 0, getMarkdownTheme());
    }
    this.text.invalidate();
    this.list?.invalidate();
    this.input.invalidate();
  }

  private selection(height: number): SelectList {
    if (this.content.kind !== "select") throw new Error("Not a selection dialog");
    if (!this.list || this.listHeight !== height) {
      this.listHeight = height;
      this.list = new SelectList(this.content.items, height, {
        selectedPrefix: (s) => this.theme.fg("accent", s),
        selectedText: (s) => this.theme.fg("accent", s),
        description: (s) => this.theme.fg("muted", s),
        scrollInfo: (s) => this.theme.fg("dim", s),
        noMatch: (s) => this.theme.fg("warning", s),
      });
      this.list.setSelectedIndex(this.selectedIndex);
      this.list.onSelect = (item) => this.finish(item.value);
      this.list.onCancel = this.abort;
      this.list.onSelectionChange = (item) => {
        if (this.content.kind !== "select") return;
        this.selectedIndex = this.content.items.indexOf(item);
        this.scroll.scrollToStart();
      };
    }
    return this.list;
  }

  handleInput(data: string): void {
    if (this.closed) return;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.finish(undefined);
      return;
    }
    if (matchesKey(data, "pageUp")) this.scroll.scrollBy(-this.scroll.viewportHeight);
    else if (matchesKey(data, "pageDown")) this.scroll.scrollBy(this.scroll.viewportHeight);
    else if (this.content.kind === "document") {
      if (matchesKey(data, "up")) this.scroll.scrollBy(-1);
      else if (matchesKey(data, "down")) this.scroll.scrollBy(1);
      else if (matchesKey(data, "home")) this.scroll.scrollToStart();
      else if (matchesKey(data, "end")) this.scroll.scrollToEnd();
      else if (matchesKey(data, "return")) this.finish("close");
    } else if (this.content.kind === "input") this.input.handleInput(data);
    else this.selection(this.listHeight || 5).handleInput(data);
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const inner = Math.max(1, width - 4);
    const height = Math.max(1, Math.min(24, this.tui.terminal.rows - 2));
    const compact = height < 9;
    const available = Math.max(1, height - (compact ? 3 : 4));
    let controls: string[] = [];
    if (this.content.kind === "select") {
      controls = this.selection(Math.max(1, Math.min(this.content.items.length, available - 3)))
        .render(Math.max(4, inner)).map((line) => truncateToWidth(line, inner, ""));
      const item = this.list?.getSelectedItem();
      this.text.setText(`${this.description}\n${item?.label ?? ""}${item?.description ? ` — ${item.description}` : ""}`);
    } else if (this.content.kind === "input") {
      controls = this.input.render(inner);
      this.text.setText(`${this.description}\n${this.content.placeholder ?? ""}`);
    }
    const lines = this.scroll.render(inner);
    const viewport = Math.max(1, available - controls.length);
    // Regular-mode overlays consume rendered lines, not fullscreen layout nodes.
    // Native ScrollView owns bounds/position; this component supplies its viewport.
    this.scroll.updateLayout(lines.length, viewport, () => this.tui.requestRender());
    const body = lines.slice(this.scroll.scrollTop, this.scroll.scrollTop + viewport);
    const hints = this.content.kind === "document"
      ? ["Enter back · Esc close", `↑↓ / PgUp/PgDn scroll · Home/End · ${Math.min(lines.length, this.scroll.scrollTop + 1)}–${Math.min(lines.length, this.scroll.scrollTop + viewport)}/${lines.length}`]
      : [this.content.kind === "input" ? "Enter OK · Esc back" : inner < 40 ? "↑↓ · Enter · Esc" : "↑↓ select · Enter confirm · Esc back", "PgUp/PgDn scroll details"];
    const border = (s: string) => this.theme.fg("border", s);
    const row = (s: string) => {
      const value = truncateToWidth(s, inner, "");
      return border("│ ") + value + " ".repeat(Math.max(0, inner - visibleWidth(value))) + border(" │");
    };
    const title = truncateToWidth(` ${this.heading} `, Math.max(1, width - 2), "");
    const result = [
      border("╭") + this.theme.fg("accent", this.theme.bold(title)) + border("─".repeat(Math.max(0, width - 2 - visibleWidth(title)))) + border("╮"),
      ...body.map(row),
      ...controls.map(row),
      ...hints.slice(0, compact ? 1 : 2).map((hint) => row(this.theme.fg("dim", hint))),
      border(`╰${"─".repeat(Math.max(0, width - 2))}╯`),
    ];
    return result.slice(0, height).map((line) => truncateToWidth(line, width, ""));
  }
}

function show(ctx: DialogContext, heading: string, description: string, content: DialogContent, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve(undefined);
  return ctx.ui.custom<string | undefined>(
    (tui, theme, _keys, done) => new OverlayDialog(tui, theme, heading, description, content, done, signal),
    { overlay: true, overlayOptions: { anchor: "center", width: "90%", margin: 1 } },
  );
}

export async function selectDialog(ctx: DialogContext, title: string, options: string[] | SelectItem[], opts: DialogOptions = {}): Promise<string | undefined> {
  const items = options.map((item) => typeof item === "string" ? { value: item, label: item } : item);
  if (ctx.mode !== "tui") {
    const label = await ctx.ui.select(title, items.map((item) => item.label), { signal: opts.signal });
    return items.find((item) => item.label === label)?.value;
  }
  return show(ctx, opts.heading ?? "Session handoff", title, { kind: "select", items }, opts.signal);
}

export function inputDialog(ctx: DialogContext, title: string, placeholder?: string, opts: DialogOptions = {}): Promise<string | undefined> {
  if (ctx.mode !== "tui") return ctx.ui.input(title, placeholder, { signal: opts.signal });
  return show(ctx, opts.heading ?? "Edit setting", title, { kind: "input", placeholder }, opts.signal);
}

export async function confirmDialog(ctx: DialogContext, title: string, message: string, opts: DialogOptions = {}): Promise<boolean> {
  if (ctx.mode !== "tui") return ctx.ui.confirm(title, message, { signal: opts.signal });
  return await show(ctx, title, message, { kind: "select", items: [
    { value: "no", label: "No", description: "Keep the current setting" },
    { value: "yes", label: "Yes", description: "Create the exact directory shown above" },
  ] }, opts.signal) === "yes";
}

export function documentDialog(ctx: DialogContext, heading: string, text: string, opts: DialogOptions & { markdown?: boolean } = {}): Promise<string | undefined> {
  if (ctx.mode !== "tui") return ctx.ui.select(`${heading}\n\n${text}`, ["Return to file actions", "Cancel recovery"], { signal: opts.signal });
  return show(ctx, opts.heading ?? heading, "", {
    kind: "document", text: opts.heading ? `${heading}\n\n${text}` : text, markdown: opts.markdown,
  }, opts.signal);
}
