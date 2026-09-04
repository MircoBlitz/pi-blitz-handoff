import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { handoffPaths, loadConfig, type HandoffConfig, type HandoffPaths } from "./config.ts";
import { ensureDirectory, requireDirectory } from "./filesystem.ts";
import { shippedDefaultPath, synchronizeManagedDefault } from "./templates.ts";

export * from "./config.ts";
export * from "./filesystem.ts";
export * from "./templates.ts";

export interface InitializedHandoffStorage {
  config: HandoffConfig;
  paths: HandoffPaths;
}

export async function initializeHandoffStorage(
  agentDirectory: string,
  packageDefault = shippedDefaultPath(),
): Promise<InitializedHandoffStorage> {
  const paths = handoffPaths(agentDirectory);
  await ensureDirectory(paths.baseDirectory);
  await ensureDirectory(paths.recoveryDirectory);
  await ensureDirectory(paths.templateDirectory);
  await synchronizeManagedDefault(paths.templateDirectory, packageDefault);

  const config = await loadConfig(agentDirectory);
  await requireDirectory(config.recoveryDirectory);
  if (config.templateDirectory !== null) {
    await requireDirectory(config.templateDirectory);
  }

  return { config, paths };
}

export default function piSimpleHandoff(_pi: ExtensionAPI): void {}
