import { randomUUID } from "node:crypto";

export type ReadinessIds = {
	goId: string;
	waitId: string;
};

export type ReadinessAnswer = "go" | "wait" | "invalid";

export function messageText(message: { content?: unknown }): string | undefined {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return undefined;
	return message.content
		.filter((part): part is { type: "text"; text: string } =>
			typeof part === "object" && part !== null &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string")
		.map((part) => part.text)
		.join("");
}

export function lastAssistantText(messages: readonly unknown[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index] as { role?: unknown; content?: unknown };
		if (message.role === "assistant") return messageText(message);
	}
	return undefined;
}

export function createReadinessIds(random = randomUUID): ReadinessIds {
	let goId = random();
	let waitId = random();
	while (waitId === goId) waitId = random();
	return { goId, waitId };
}

export function buildReadinessPrompt(ids: ReadinessIds): string {
	return [
		"🟡 **HANDOFF READINESS CHECK**",
		"Determine only whether session-owned work currently prevents a handoff. Before answering, use the available status tools to inspect all session-owned asynchronous and background work, including the subagent fleet. If any such work is still active or its status cannot be established safely, answer NOT YET. Do not continue the task itself.",
		"End with exactly one complete response and no extra text:",
		`- ${ids.goId}: GO`,
		`- ${ids.waitId}: NOT YET`,
		"The identifiers are deliberately different. Never pair an identifier with the other statement.",
	].join("\n\n");
}

export function parseReadinessAnswer(text: string, ids: ReadinessIds): ReadinessAnswer {
	if (text === `${ids.goId}: GO`) return "go";
	if (text === `${ids.waitId}: NOT YET`) return "wait";
	return "invalid";
}
