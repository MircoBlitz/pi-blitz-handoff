import { initTheme, type ExtensionAPI, type ExtensionFactory, type ExtensionUIContext, type KeybindingsManager, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component, SelectItem, TUI } from "@earendil-works/pi-tui";
import extension from "../extensions/index.ts";

export async function loadExtension(api: ExtensionAPI): Promise<void> {
  const result: ReturnType<ExtensionFactory> = extension(api);
  await result;
}

interface DialogScript {
  select?(title: string, options: string[], opts?: { signal?: AbortSignal }): Promise<string | undefined>;
  input?(title: string, placeholder?: string, opts?: { signal?: AbortSignal }): Promise<string | undefined>;
  confirm?(title: string, message: string): Promise<boolean>;
  document?(heading: string, text: string): Promise<string | undefined>;
}

// Focused UI test double, not a Pi runtime. Scripts choose answers; actual native
// Input/SelectList receive terminal key bytes and the real component is rendered.
// Private presentation metadata is inspected only to reuse semantic test scripts.
export function createDialogHarness(script: DialogScript = {}) {
  initTheme("dark", false);
  const screens: string[][] = [];
  const options: unknown[] = [];
  const components: Array<Component & { dispose?(): void }> = [];
  const keys: string[] = [];
  const terminal = { rows: 28, columns: 100 };
  const themeState = { color: 36 };
  const theme = {
    fg: (_token: string, text: string) => `\x1b[${themeState.color}m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  } as Theme;
  const custom: ExtensionUIContext["custom"] = (factory, opts) => new Promise((resolve, reject) => {
    options.push(opts);
    let component: Component & { dispose?(): void };
    const render = () => { screens.push(component.render(Math.floor(terminal.columns * 0.9))); };
    const tui = { terminal, requestRender: render } as unknown as TUI;
    const done = (result: unknown) => { component?.dispose?.(); resolve(result as never); };
    Promise.resolve(factory(tui, theme, {} as KeybindingsManager, done)).then(async (created) => {
      component = created;
      components.push(component);
      if ("focused" in component) component.focused = true;
      render();
      const metadata = component as unknown as {
        heading: string; description: string; signal?: AbortSignal;
        content: { kind: string; items?: SelectItem[]; placeholder?: string; text?: string };
      };
      const key = (data: string) => { keys.push(data); component.handleInput?.(data); };
      if (metadata.content.kind === "input") {
        const answer = await script.input?.(metadata.description, metadata.content.placeholder, { signal: metadata.signal });
        if (answer === undefined) key("\x1b");
        else { key(`\x1b[200~${answer}\x1b[201~`); key("\r"); }
      } else if (metadata.content.kind === "document") {
        const answer = await script.document?.(metadata.heading, metadata.content.text ?? "");
        key(answer === undefined || answer === "Cancel recovery" ? "\x1b" : "\r");
      } else {
        const items = metadata.content.items ?? [];
        const answer = metadata.heading === "Create missing directory?"
          ? await script.confirm?.(metadata.heading, metadata.description) ? "Yes" : "No"
          : await script.select?.(metadata.description, items.map((item) => item.label), { signal: metadata.signal });
        if (answer === undefined) key("\x1b");
        else {
          const index = items.findIndex((item) => item.label === answer);
          if (index < 0) throw new Error(`Script chose missing option: ${answer}`);
          for (let i = 0; i < index; i += 1) key("\x1b[B");
          key("\r");
        }
      }
    }).catch(reject);
  });
  return { custom, screens, options, components, keys, terminal, theme, themeState };
}
