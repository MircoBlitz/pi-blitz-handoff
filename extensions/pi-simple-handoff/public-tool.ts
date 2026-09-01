import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { SimpleHandoffConfig } from "./config.ts";
import type { HandoffThresholds } from "./core.ts";

export type PublicToolOptions = {
	config: SimpleHandoffConfig;
	thresholds: HandoffThresholds;
	automaticPercent: number;
	configuredAutomaticPercent: number;
	isBusy(): "handoff" | "cleanup" | undefined;
	start(ctx: ExtensionContext): Promise<void> | void;
};

export function registerPublicTool(pi: ExtensionAPI, options: PublicToolOptions): void {
	const { config, thresholds, automaticPercent, configuredAutomaticPercent } = options;
	const automaticStatus = automaticPercent === 0
		? "Automatic session handoff is disabled."
		: `Automatic session handoff is enabled at ${automaticPercent}%.`;
	const directGuidance = "When the user explicitly requests a handoff by saying 'handoff', 'hand off', 'simple handoff', 'simple hand off', or an equivalent imperative, call simple_handoff with action=start immediately. Do not start a handoff when the user is merely discussing, questioning, testing, or asking to fix handoff behavior.";
	const autonomousGuidance = automaticPercent === 0
		? `During explicitly user-authorized autonomous work, choose your own handoff cutoff between ${thresholds.warningThreshold}% and ${thresholds.criticalThreshold}% context usage. Use simple_handoff status to monitor usage, and start the handoff at your chosen cutoff without waiting for the user. Never infer autonomous permission merely from a long task.`
		: `Automatic session handoff is globally authorized and handled by pi-simple-handoff at ${automaticPercent}% context usage. Do not call simple_handoff merely to manage that automatic transition.`;

	pi.registerTool({
		name: "simple_handoff",
		label: "Simple Handoff",
		description: `Inspect context usage or start pi-simple-handoff's focused handoff into a genuinely fresh session. Use action=start when the user asks for a handoff. The configured handoff window is ${thresholds.warningThreshold}% to ${thresholds.criticalThreshold}%. ${automaticStatus} ${autonomousGuidance}`,
		promptSnippet: "Run Simple Handoff when the user requests a handoff; status reports context usage and handoff settings",
		promptGuidelines: [directGuidance, autonomousGuidance],
		parameters: Type.Object({ action: StringEnum(["status", "start"] as const) }),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const percent = ctx.getContextUsage()?.percent ?? null;
			if (params.action === "status") {
				const usage = percent === null ? "unavailable" : `${percent.toFixed(1)}%`;
				return {
					content: [{ type: "text", text: `Current context usage: ${usage}. Configured handoff window: ${thresholds.warningThreshold}% to ${thresholds.criticalThreshold}%. ${automaticStatus}` }],
					details: { percent, ...thresholds, automaticSessionHandoffPercent: automaticPercent, automaticSessionHandoff: config.automaticSessionHandoff, configuredAutomaticSessionHandoffPercent: configuredAutomaticPercent },
				};
			}
			const busy = options.isBusy();
			if (busy) {
				return {
					content: [{ type: "text", text: busy === "cleanup" ? "Private handoff cleanup is still pending." : "A handoff is already in progress." }],
					details: { queued: false, percent, ...thresholds },
				};
			}
			await options.start(ctx);
			return {
				content: [{ type: "text", text: "Session Handoff is pending. Readiness will be checked as soon as current work settles." }],
				details: { queued: true, percent, ...thresholds },
			};
		},
	});
}
