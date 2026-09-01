# pi-simple-handoff

Carry focused task context into a genuinely fresh [Pi](https://pi.dev) session and continue immediately.

`pi-simple-handoff` is designed for long interactive sessions. Ask the agent for a “handoff” or “simple handoff”, run `/sh`, or explicitly enable automatic handoffs at a configured context percentage.

**Compatibility:** requires Pi v0.84.2 or later and Node.js v22.19.0 or later. The complete extension API surface is verified in Pi v0.84.2; older Pi versions are not supported.

## What it adds

- `/sh` to start a handoff.
- `/sh retry`, `/sh recover`, `/sh cancel`, and `/sh cleanup` recovery controls.
- A model-callable `simple_handoff` tool with stable `status` and `start` actions.
- Deterministic, configurable readiness and writer retry countdowns.
- Durable FIFO deferral of every ordinary prompt entered after handoff activation.
- A pinned, theme-colored progress widget with seven visible handoff stages, live countdowns, and terminal-safe separators.
- One context warning at 70% and critical reminders from 90% by default.
- Optional extension-driven automatic handoffs.
- `/shconfig` for all configurable settings.
- A linked fresh session with the old transcript retained only as cold fallback context.

## Install

From npm:

```sh
pi install npm:pi-simple-handoff
```

For one run:

```sh
pi -e npm:pi-simple-handoff
```

From GitHub:

```sh
pi install git:github.com/MircoBlitz/pi-simple-handoff
```

Pi packages execute with your full system permissions. Review third-party source before installing it.

## Invocation

Every invocation path enters the same readiness-gated handoff flow. None can bypass readiness, writer isolation, validation, or cleanup.

### User command

Run:

```text
/sh
```

The command starts only when no handoff, session transition, or unresolved private cleanup is already active. It immediately creates a pending readiness state and dispatches the first readiness check.

### LLM tool

Ask the active model directly:

```text
handoff
```

For an explicit handoff request, the model calls `simple_handoff` with `action: "start"`. During separately authorized autonomous work, the model may also inspect `simple_handoff` with `action: "status"` and start at a chosen point. A long task alone is not authorization. The tool rejects a new start while a handoff or cleanup is active; otherwise it enters the same pending readiness state as `/sh`.

### Automatic invocation

Automatic invocation is disabled by default. When persistently enabled in `/shconfig`, the extension checks context usage after each settled agent turn. If usage has reached the configured effective threshold, no handoff or cleanup is active, and automatic handoff was not suppressed by a cancellation in that source session, the extension enters the same pending readiness state directly. This path is extension-driven: the model does not call `simple_handoff` and does not need to remember the threshold.

### Recovery commands

```text
/sh retry
/sh recover
/sh cancel
/sh cleanup
```

- `retry` immediately repeats pending readiness, a scheduled/paused writer attempt, or a failed session transition. A manual retry after writer exhaustion starts a new bounded retry cycle with a new submission ID.
- `recover` resumes a paused deferred-prompt FIFO in the current session. Each accepted prompt is checkpointed before the next one is delivered; a rejected prompt and every remaining prompt stay durable.
- `cancel` stops extension-owned handoff work, invalidates late responses, removes the expected private artifact when safe, and suppresses automatic retriggering in that source session. If the source session is still active, deferred prompts are returned to it as distinct FIFO turns. Interrupted return is resumed explicitly with `/sh recover`. A completed session replacement cannot be undone.
- `cleanup` retries independent private-file cleanup without opening another session.

A session switch that already completed cannot be undone.

## Visible phases

The pinned widget remains yellow while the handoff is active and reports the current stage as `n/7`:

1. Preparing readiness check
2. Checking readiness
3. Writing focused context
4. Handoff validated
5. Opening fresh session
6. Deliver deferred prompts
7. Finalizing fresh session

Readiness and writer retry countdowns update once per second. During activation the widget also shows `Deferred prompts: N`. A completed handoff turns green and shows `Complete (7/7)`. Cancellation, exhaustion, and failures use actionable warning or error text.

## What happens during a handoff

Regardless of whether the handoff was started by `/sh`, by the model, or automatically, the visible flow is the same:

1. **Check readiness.** The extension asks the current model whether any agent, subagent, or other session-owned work is still running. Normal status tools remain available for this check.
2. **Wait when necessary.** `agent_end` can be followed by Pi retries or compaction, so a readiness answer is only recorded there. `GO` activates the writer only at `agent_settled`. A settled `NOT YET` or invalid answer starts the configured delay; the next poll is dispatched only when Pi is idle. Once `/sh`, the public tool, or automatic policy activates the handoff, every later ordinary interactive or RPC prompt is durably deferred; only Pi-native messages already accepted before activation finish in the source session.
3. **Write focused context.** At the settled boundary, the extension asks for a structured handoff containing the goal, current state, constraints, concrete next steps, blockers, working set, behavior changes, and precision anchors.
4. **Isolate and retry the writer.** The writer can use only `submit_session_handoff`. Missing, malformed, or unsubmitted output is retried only after the writer settles and the configured delay passes. The default is three automatic retries after the initial attempt. Exhaustion pauses with `/sh retry` and `/sh cancel` actions.
5. **Validate before switching.** The extension accepts only the current one-time submission ID, validates the complete Markdown, stores it privately, and rejects stale attempts.
6. **Open a fresh session.** Pi creates a linked fresh session with native `newSession({setup, withSession})`. The validated handoff is added before any new-session turn; the source transcript remains cold fallback context.
7. **Clean up transport.** Once the handoff is present in the replacement, the extension removes its private transport artifact. A cleanup failure is recorded independently and remains retryable with `/sh cleanup`.
8. **Deliver deferred prompts.** From handoff request/activation onward, every later ordinary interactive or RPC prompt is durably intercepted instead of extending the source session. Text, prompt boundaries, FIFO order, and supported image payloads are preserved. In the replacement, prompts are sent as distinct user turns in FIFO order; they are never pasted into the handoff Markdown.
9. **Continue when appropriate.** If deferred prompts exist, they supersede the generic continuation. Only an empty FIFO receives `Continue the handed-off work now.`, so generic work cannot run ahead of a later user instruction.

`/new`, `/resume`, `/fork`, and `/clone` are guarded while active or deferred handoff work exists. Handoff control commands remain usable. Cancellation invalidates late readiness answers and submissions, restores the exact pre-writer tool set, and returns deferred prompts FIFO to the still-active source session. Rejected delivery remains durable and recoverable with `/sh recover`. The handoff template is versioned in the extension and is intentionally not editable through `/shconfig`.

## File ownership and safety

The extension—not the model—owns the entire temporary-file lifecycle:

- private `0700` directory;
- private exclusive regular-file creation;
- no symlink following;
- bounded UTF-8 content;
- required headings in the correct order, with any extra H1/H2 rejected even when indented by up to three Markdown-significant spaces;
- optional H3 and deeper headings allowed as ordinary section content;
- nonempty Goal and Next Steps;
- directory identity checks while reading and writing;
- exact, nonrecursive cleanup that preserves unexpected entries.

A valid file is durable proof that handoff generation completed. Writer attempt number, total attempts, retry deadline, paused state, and deferred FIFO are stored in Pi session entries. Restarting validates an existing artifact or resumes the recorded delay without duplicating the recorded attempt. In the replacement, the replacement extension instance owns a private one-turn-at-a-time delivery command: each accepted turn checkpoints the remaining FIFO, and `deliveryPending` reschedules that command after restart. Cleanup removes only an expected regular file or symlink at the exact handoff path and never follows a symlink. Unexpected entry types, additional directory contents, unsafe directory modes, and conflicting quarantine paths are reported instead of being recursively removed or overwritten.

Cleanup is separate from the blocking handoff phases. Cleanup failure never opens another replacement, never turns `Finished` back into `Running`, and does not block normal work. It does block starting another handoff until `/sh cleanup` succeeds, preventing multiple untracked private artifacts.

## Transparency and trust boundaries

- Pi packages run with the full permissions of the user who started Pi. Writer tool isolation limits the model's active Pi tools; it is not an operating-system sandbox.
- The extension itself makes no network requests. Handoff generation still uses the model and provider configured in Pi, just like any other Pi model turn.
- The generated handoff may contain code, paths, command output, and other details already present in the session. The extension does not attempt automatic secret detection or redaction.
- The handoff is temporarily stored as plaintext in a private `0700` operating-system temporary directory with a private file. Normal completion removes it; an abrupt process or machine failure can leave it behind for later cleanup.
- The complete handoff becomes part of the new Pi session history. Deferred prompts remain separate user turns and are not inserted into that Markdown. The old transcript itself is not copied into active context; only its local path is included as cold fallback context.
- Enabling automatic handoff is persistent authorization for the configured threshold. Cancelling a handoff suppresses another automatic trigger in that source session.
- Handoff quality still depends on the active model. Structural validation can reject malformed output, but it cannot prove that every summary statement is complete or correct.

Report undisclosed vulnerabilities through the private contact described in [SECURITY.md](SECURITY.md), not through a public issue.

## Automatic handoffs

Automatic handoffs are disabled by default. Open `/shconfig`, enable **Automatic Session Handoff**, set a percentage, and select **Save and reload**.

The configured value has these semantics:

- `50–100`: effective when automatic handoff is enabled;
- `1–49`: inactive and reported with a startup warning;
- `0`: inactive without that warning.

`/shconfig` preserves existing `0–49` values instead of silently normalizing them.

When automatic handoff is disabled, an agent performing explicitly authorized autonomous work may still use `simple_handoff status` and `simple_handoff start`. It is instructed not to infer that authorization merely from a long task.

## Configuration

Global configuration:

```text
~/.pi/agent/extensions/pi-simple-handoff.json
```

When `PI_CODING_AGENT_DIR` is set, the file lives in that directory’s `extensions` subdirectory.

```json
{
  "kvWarningPercent": 70,
  "selfHandoffPercent": 90,
  "automaticSessionHandoff": false,
  "automaticSessionHandoffPercent": 60,
  "readinessRetrySeconds": 30,
  "writerRetryLimit": 3,
  "writerRetryDelaySeconds": 30
}
```

Warning values must satisfy:

```text
1 <= kvWarningPercent < selfHandoffPercent <= 100
```

`readinessRetrySeconds` and `writerRetryDelaySeconds` must be integers from 1 through 300. `writerRetryLimit` must be an integer from 0 through 10 and counts retries after the initial writer attempt. Defaults are exactly 3 retries and 30 seconds. In `/shconfig`, readiness retry time is selected from 15, 30, 60, 120, or 180 seconds; a different value set directly in JSON remains valid, is shown as a custom value, and is not overwritten by that selector. Writer retry fields use direct bounded numeric controls. The popup validates all settings, saves atomically, and reloads Pi.

## What the handoff carries forward

The handoff is closer to a focused continuation brief than a conversation summary. It contains:

- **Goal** — what the user is trying to achieve;
- **Current State** — completed work and facts needed to continue;
- **Decisions and Constraints** — requirements, permissions, and excluded work that still apply;
- **Next Steps** — the concrete continuation, intentionally the most detailed section;
- **Open Questions and Blockers** — only genuinely unresolved points;
- **Working Set** — relevant files, URLs, commands, artifacts, and technical anchors;
- **Behavior Changes** — user preferences added or changed during the session;
- **Precision Anchors** — a few verbatim statements when paraphrasing could lose important meaning;
- **Cold Context** — only the old transcript path, for use when an essential detail is missing.

It does not grant new permission, invent new tasks, or copy the full conversation into the new session. The active handoff is deliberately weighted toward what happens next.

## Caveats

- Interactive Pi sessions are required for the complete UI and session-switching experience.
- Handoff quality still depends on the active model producing useful content inside the validated structure.
- Ephemeral sessions have no persisted source session to link as a parent and no cold transcript path.
- Unexpected files inside the private directory are never recursively deleted; cleanup reports them for manual inspection.
- A process killed outside Pi’s normal lifecycle can leave a private temporary directory until the source or replacement session is resumed and cleanup retries.
- Deferred FIFO delivery is persisted after each accepted replacement turn. An abrupt crash in the narrow interval after Pi accepts a turn but before the queue checkpoint can replay that turn on recovery rather than silently dropping it.
- Future Pi extension API changes may require updates.

## Development

```sh
npm ci
npm run validate
npm pack --dry-run
```

Before publishing, also inspect `git diff --check`, package contents, and a real current-code TUI run.

## License

[MIT](LICENSE)
