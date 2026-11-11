export function readinessPrompt(callTemplate: string): string {
  return [callTemplate.trim(),
    "Call session_handoff_get_template({}) before writing any handoff. Do not invent a file path. Retrieval supplies the template, exact file and Finish ID together.",
    "Reach the next transferable checkpoint, not whole-task completion. Finish only tightly coupled in-flight work necessary for safe transfer. Independent terminal/background work may continue; preserve how the receiver can check it. Start no additional task work to postpone transfer.",
  ].join("\n");
}

export function readinessReminder(): string {
  return "One-time session handoff reminder. Complete the current template-to-Finish flow at the next safe checkpoint. Fetch session_handoff_get_template({}) if still missing; otherwise update the supplied file, then call session_handoff_finish with its exact ID. Do not invent a path or start additional source work to postpone transfer.";
}

export function readinessEmergency(percent: number, pendingCallTemplate?: string): string {
  return [
    `Session handoff emergency: context usage is ${percent.toFixed(1)}%. The 90% emergency limit has been reached.`,
    ...(pendingCallTemplate === undefined ? [] : [pendingCallTemplate.trim()]),
    "These emergency instructions override any Call Template guidance to wait or gather more source-task context.",
    "Stop all source-task work now. Do not wait for independent terminals or subagents or gather more source-task context. Preserve unfinished work for the receiver.",
    "Fetch session_handoff_get_template({}) if still missing. Finalize the supplied file with current facts, permissions and next action, then call session_handoff_finish with its exact ID. Keep the current request and any retrieved file and ID; do not invent a path or start another handoff.",
  ].join("\n");
}
