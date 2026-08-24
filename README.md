# pi-simple-handoff

Continue your work in a fresh [Pi](https://pi.dev) session without losing momentum.

`pi-simple-handoff` creates one focused context handoff, opens a genuinely fresh session, and immediately continues the current task. Trigger it yourself when a conversation grows large, or explicitly authorize the agent to initiate it autonomously within a configurable context window.

## What it adds

- `/simplehandoff` and the short alias `/sh` for an immediate fresh-session handoff.
- A model-callable `session_handoff` tool for explicitly authorized autonomous work.
- A warning at 60% context usage and critical reminders from 80% onward by default.
- Configurable warning and critical thresholds.
- One temporary, forward-focused handoff instead of archives, indexes, or session scans.
- A cold reference to the previous transcript for emergency recovery only.

## Install

Install from npm:

```sh
pi install npm:pi-simple-handoff
```

Try it for one run without installing it:

```sh
pi -e npm:pi-simple-handoff
```

You can also install the GitHub repository directly:

```sh
pi install git:github.com/MircoBlitz/pi-simple-handoff
```

Pi packages execute with your full system permissions. Review third-party source code before installing it.

## Usage

Start a handoff manually:

```text
/simplehandoff
```

Or use the short alias:

```text
/sh
```

The extension asks the current agent to write a focused handoff, verifies the result, opens a fresh session, and sends the continuation request automatically. The new session reads and deletes the temporary file before continuing the existing task.

## Autonomous handoffs

For long-running autonomous work, explicitly tell the agent that it may initiate a handoff when needed. The extension exposes two `session_handoff` actions:

- `status` reports current context usage and the configured handoff window.
- `start` queues the same transition as `/simplehandoff`.

Once authorized, the agent chooses a cutoff within the configured window, monitors context usage, and starts the handoff without waiting for another confirmation. It then continues the requested work in the fresh session.

The extension never infers autonomous permission merely because a task is long.

## Configuration

The default handoff window is 60% to 80% context usage. Override either threshold with environment variables before starting Pi:

```sh
export PI_SIMPLE_HANDOFF_WARNING_THRESHOLD=60
export PI_SIMPLE_HANDOFF_CRITICAL_THRESHOLD=80
pi
```

Values must satisfy:

```text
1 <= warning threshold < critical threshold <= 100
```

The warning threshold controls the first notification. The critical threshold controls repeated reminders. Together they define the range in which an authorized autonomous agent chooses its cutoff.

## How it works

1. The current session writes one concise Markdown handoff below the active working directory.
2. The extension verifies that the file exists and is not empty.
3. Pi opens a new session linked to the previous session.
4. The new session reads and deletes exactly that handoff file.
5. The agent immediately continues the carried request.

Temporary handoffs use this path:

```text
.pi/session-handoff/<session-token>/session-handoff.md
```

The handoff records the active goal, relevant state, decisions, constraints, detailed next steps, blockers, working files, behavioral changes, and precision-sensitive user statements. The old transcript remains cold context and is read only when an essential detail is missing.

While a handoff is active, Pi compaction is cancelled so it cannot interfere with the transition.

## Caveats

- Interactive Pi sessions are required for notifications and session switching.
- Handoff quality depends on the active model following the focused handoff prompt.
- Temporary parent directories may remain after the Markdown file is deleted.
- The extension relies on Pi extension APIs for context usage, session state, and fresh-session creation; future Pi API changes may require updates.

## Development

Run the test suite:

```sh
npm test
```

Inspect the exact npm package contents before publishing:

```sh
npm pack --dry-run
```

## License

[MIT](LICENSE)
