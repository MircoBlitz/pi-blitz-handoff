import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigCommand } from "./config-ui.ts";
import { loadSimpleHandoffConfig } from "./config.ts";
import { registerHandoffFlow } from "./handoff-flow.ts";

export default function simpleHandoffExtension(pi: ExtensionAPI): void {
	const config = loadSimpleHandoffConfig();
	registerHandoffFlow(pi, config);
	registerConfigCommand(pi, config);
}
