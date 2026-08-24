# pi-simple-handoff

A small [Pi](https://github.com/earendil-works/pi-mono) extension that replaces compaction with a focused handoff into a genuinely fresh session.

Compaction keeps the existing KV cache alive. `pi-simple-handoff` instead writes one temporary Markdown handoff, opens a new session with a small cache, reads and deletes the handoff, and immediately continues the current task.

## Features

- One warning at 60% context usage by default.
- A critical warning after every settled turn from 80% onward.
- `/handoff` for a manual fresh-session handoff.
- A model-callable `session_handoff` tool for explicitly authorized autonomous work.
- User-configurable warning and critical thresholds.
- One concise, forward-focused handoff instead of archives, registries, indexes, or session scans.
- The previous transcript remains cold context and is read only when an essential detail is missing.

## Install

Install directly from Forgejo:

```sh
pi install git:ssh://git@192.168.11.10:2222/Lindworm/pi-simple-handoff.git
```

Or install a local checkout:

```sh
pi install /absolute/path/to/pi-simple-handoff
```

To try it for one run without installing it:

```sh
pi -e /absolute/path/to/pi-simple-handoff
```

Pi packages and extensions execute with your full system permissions. Review third-party source code before installing it.

## Manual use

Run:

```text
/handoff
```

The current agent writes one temporary context handoff. The extension verifies that the file exists, opens a fresh session automatically, and sends the continuation prompt there. The new session reads the handoff, deletes exactly that file, and continues the existing request.

## Autonomous use

Tell the agent explicitly that it should work autonomously. The extension describes the workflow to the model through the `session_handoff` tool:

- `status` reports current context usage and the configured handoff window.
- `start` queues the same flow as `/handoff`.

During explicitly authorized autonomous work, the agent chooses its own cutoff within the warning-to-critical window, monitors usage, and starts the handoff at that cutoff without waiting for the user. After the fresh session starts, it continues autonomously from the handoff.

The extension does not infer autonomous permission. A long task alone is not authorization.

## Configuration

Set either or both environment variables before starting Pi:

```sh
export PI_SIMPLE_HANDOFF_WARNING_THRESHOLD=60
export PI_SIMPLE_HANDOFF_CRITICAL_THRESHOLD=80
pi
```

The values must satisfy:

```text
1 <= warning threshold < critical threshold <= 100
```

The two thresholds also define the range in which an autonomous agent chooses its cutoff.

## Handoff lifecycle

Temporary files are created below the active working directory:

```text
.pi/session-handoff/<session-token>/session-handoff.md
```

The handoff contains:

- the current goal;
- only the past state needed to continue;
- active decisions and constraints;
- detailed next steps;
- unresolved blockers;
- relevant files and technical anchors;
- session-specific behavior changes;
- a cold reference to the old transcript.

The replacement session deletes the Markdown file immediately after reading it. Empty parent directories may remain.

While a handoff is active, Pi compaction is cancelled so it cannot interfere with the switchover.

## Development

Run the focused tests with:

```sh
npm test
```

## License

[MIT](LICENSE)
