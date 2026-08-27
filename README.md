# pi-simple-handoff

Carry focused task context into a genuinely fresh [Pi](https://pi.dev) session and continue immediately.

`pi-simple-handoff` is for rapid transitions during long conversations. Ask the agent for a “handoff” or “simple handoff”, or start it manually with `/sh`. For explicitly authorized autonomous work, the agent can monitor context usage and start the same flow itself.

Requires Pi 0.84.2 or newer and Node.js 22.19.0 or newer.

## What it adds

- The short manual command `/sh`.
- A model-callable `simple_handoff` tool with `status` and `start` actions, explicitly discoverable from “handoff”, “hand off”, “simple handoff”, and “simple hand off” requests.
- One warning at 60% context usage and critical reminders from 80% by default.
- Configurable warning and critical thresholds.
- A focused handoff to a new linked session, with the old transcript kept as cold fallback context.

## Install

Install from npm:

```sh
pi install npm:pi-simple-handoff
```

Try it for one run:

```sh
pi -e npm:pi-simple-handoff
```

Or install directly from GitHub:

```sh
pi install git:github.com/MircoBlitz/pi-simple-handoff
```

Pi packages execute with your full system permissions. Review third-party source code before installing it.

## Usage

Ask the agent directly:

```text
handoff
```

```text
simple handoff
```

Or start it manually:

```text
/sh
```

The current agent writes a concise context handoff. The extension validates it, persists its content into a fresh replacement session, removes the temporary file, and asks the replacement session to continue immediately.

## Autonomous handoffs

For long-running autonomous work, explicitly tell the agent that it may initiate handoffs when needed. The `simple_handoff` tool supports:

- `status`: report current context usage and the configured handoff window.
- `start`: queue the same flow as `/sh`.

The extension gives the model guidance not to infer permission merely from a long task. This is a model-policy instruction, not a technical authorization gate. Use autonomous handoffs only when you have explicitly authorized them.

## Configuration

Configure the extension in Pi's global extension settings directory:

```text
~/.pi/agent/extensions/pi-simple-handoff.json
```

When `PI_CODING_AGENT_DIR` is set, the file lives in its `extensions` subdirectory instead. Example:

```json
{
  "kvWarningPercent": 60,
  "selfHandoffPercent": 80
}
```

Values must satisfy:

```text
1 <= kvWarningPercent < selfHandoffPercent <= 100
```

`kvWarningPercent` controls the first context warning. `selfHandoffPercent` controls repeated critical reminders and the upper end of the autonomous handoff window. Tool descriptions, prompt guidance, status output, and warning messages use the configured values. Changes take effect after `/reload` or a Pi restart.

## How it works

1. The extension creates a session-bound directory with private permissions in the operating system's temporary directory.
2. The current agent writes one structured Markdown handoff there.
3. The extension rejects symlinks, unsafe or oversized files, and incomplete handoffs.
4. Pi opens a new session linked to the previous persisted session.
5. The extension stores the complete handoff as a message in the replacement session before requesting automatic continuation.
6. The extension deletes the temporary file and directory.

The handoff captures the goal, current state, decisions, constraints, next steps, blockers, working set, behavior changes, precision-sensitive statements, and a cold transcript reference. The replacement should consult that transcript only when essential information is missing.

While a handoff job is active, the extension cancels compaction so it cannot interfere with the transition. Successful, cancelled, malformed, and interrupted flows clean up their expected temporary data. If the replacement cannot persist the handoff, the source session retains a retryable job and the temporary file for recovery.

## Caveats

- Interactive Pi sessions are required for notifications and session switching.
- Handoff quality still depends on the active model following the structured writing prompt.
- Ephemeral sessions have no persisted source session to link as a parent and no cold transcript path to reference.
- Cleanup removes only the extension's exact expected file and directory; it does not recursively delete unexpected files placed in that directory.
- Unreleased pre-0.1.0 development snapshots used project-local temporary paths. If you upgrade with an in-flight old handoff, remove its `.pi/session-handoff` directory manually.
- Future Pi extension API changes may require updates.

## Development

Install the pinned development dependencies and run all checks:

```sh
npm ci
npm run validate
```

Inspect the exact package contents before publishing:

```sh
npm pack --dry-run
```

## License

[MIT](LICENSE)
