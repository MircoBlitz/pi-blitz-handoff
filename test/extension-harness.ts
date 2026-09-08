import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/index.ts";

export async function loadExtension(api: ExtensionAPI): Promise<void> {
  const result: ReturnType<ExtensionFactory> = extension(api);
  await result;
}
