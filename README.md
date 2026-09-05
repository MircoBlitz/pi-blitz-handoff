# pi-blitz-handoff

<p align="center">
  <img src="assets/logo.png" alt="pi-blitz-handoff logo" width="320">
</p>

`pi-blitz-handoff` carries the material continuation context of a persisted Pi session into a fresh Pi session. It asks the current model to prepare a structured handoff dossier, creates the replacement through Pi's native session API with the source session as its parent, and sends the dossier as the replacement session's first user turn.

A handoff preserves authorization boundaries: continuation context is not a new request and grants no new permission. The supplied default template tells the writer to distinguish verified work, unverified or partial work, currently authorized work, work requiring fresh approval, blockers, and unresolved questions.

## Requirements

- Node.js 22.19.0 or later
- `@earendil-works/pi-coding-agent` 0.84.2 or later
- Pi's interactive chat surface
- A persisted source session

`--no-session` and other in-memory sessions cannot start a handoff because there is no source transcript path or native parent lineage.

## Installation

Install from npm:

```text
pi install npm:pi-blitz-handoff
```

Try it for one run without installing it globally:

```text
pi -e npm:pi-blitz-handoff
```

Or install directly from GitHub:

```text
pi install git:github.com/MircoBlitz/pi-blitz-handoff
```

Pi reads the extension entry point from `package.json`. Review third-party extensions before installing them: Pi extensions run with the permissions of the Pi process.

## Public interface

### Commands

- `/sh` — request a handoff.
- `/sh-help` — show handoff commands and usage.
- `/sh-cancel` — cancel the active handoff when cutover has not started.
- `/sh-recover` — inspect, execute, or discard leftover deferred-prompt files.
- `/sh-config` — edit configuration in an extension-owned chat dialog.
- The `/sh cancel`, `/sh recover`, `/sh config`, and `/sh help` forms remain available as subcommand aliases.

There is no public retry command, cleanup command, or public transition command.

### Model-callable tool

The `blitz_handoff` tool has two actions:

- `status` — report context usage, warning and automatic thresholds, readiness retry delay, and current handoff status.
- `start` — request a handoff only when the user explicitly requested one.

Discussion, questions, criticism, testing, or a mention of handoffs are not start requests.

## How a handoff works

1. An explicit `/sh` or `blitz_handoff start` records the request. Explicit starts ignore all context thresholds.
2. Automatic initiation is optional. When enabled, it starts only at or above its configured threshold on an idle `agent_settled` boundary with no pending message.
3. Readiness waits for settled source-session work. It accepts only the exact current generated `GO` identifier after that answering run settles with no pending message. User or RPC input before `GO` passes unchanged to the source session and invalidates the current readiness identifiers.
4. After accepted `GO`, ordinary interactive and RPC prompts are deferred: they do not reach the source writer, remain unchanged and ordered in memory, and are also atomically written to one recovery Markdown file.
5. The writer resolves the current template for each attempt, temporarily allows only its private submission tool, and submits a dossier correlated to the current attempt. The original active tool list is restored on success, cancellation, exhaustion, or terminal failure.
6. Deterministic code appends any deferred prompts to the dossier. No additional model call assembles the transition prompt.
7. The extension calls `ctx.newSession({ parentSession: sourceSessionPath })` and sends the assembled Markdown through the fresh replacement-session context. The source transcript therefore remains available through Pi's native parent lineage.
8. After Pi confirms the replacement and accepts the first prompt, the corresponding recovery file is deleted. A cleanup error is reported without rolling back the completed replacement.

The submitted dossier's first line is its model-written, task-specific Markdown title. The extension does not semantically validate the title or dossier headings.

At most one handoff is active. A second start is rejected without replacing active state. Once native cutover has been invoked, cancellation is no longer available.

## Status and cancellation

The activity line is rendered as a Pi widget directly above the input editor. It does not depend on the configured footer or powerline. The persistent status uses these factual states:

- `Waiting for Session Handoff`
- `Writing Session Handoff`
- `Session Handoff Finished`

Failure and cancellation override those states. Finished status remains in the replacement session until ordinary user input or another handoff begins. After `GO`, the activity line shows `Inputs deferred (0)` and increments the count for every captured prompt.

Before `GO`, `/sh cancel` clears pending readiness. After `GO` but before native replacement begins, it stops extension-owned writer work, restores the prior tools, and leaves a deferred-prompt recovery file for explicit recovery. Deferred prompts are not replayed automatically to the source session.

From `GO` until completion or cancellation, user-initiated session replacement, fork, and compaction are blocked. The extension's own correlated native replacement is allowed.

## Recovery

`/sh recover` lists remaining top-level recovery Markdown files with their dates. For one selected file at a time, the dialog can:

- inspect the complete contents without changing the file;
- execute all stored prompts in the current session as one combined user turn that preserves their order and boundaries;
- discard exactly that file;
- return to the list or cancel.

Recovery is always explicit. It never automatically executes leftover prompts. Execution deletes the file only after message dispatch returns without an immediate error; unreadable files and immediately rejected dispatches are reported and retained.

## Configuration

Run `/sh config` in an interactive UI. Changes remain an in-memory draft until **Save configuration**. **Cancel configuration**, `/reload`, or session replacement discards an unsaved draft. Saving validates the complete draft and asks before creating a missing configured directory.

Saved configuration takes effect after `/reload`; the currently loaded extension instance is not dynamically rebuilt.

| Setting | Default | Constraint |
|---|---:|---|
| `contextWarningPercent` | `60` | Finite number, at least 1 and below the critical threshold |
| `criticalWarningPercent` | `90` | Finite number, above the warning threshold and at most 100 |
| `automaticSessionHandoff` | `false` | Boolean |
| `automaticSessionHandoffPercent` | `70` | Finite number from 0 through 100; 0 disables automatic initiation |
| `readinessRetrySeconds` | `60` | Integer from 1 through 300 |
| `writerAttempts` | `3` | Positive integer; total attempts including the first |
| `writerRetryDelaySeconds` | `30` | Integer from 1 through 300 |
| `recoveryDirectory` | managed recovery directory | Absolute directory path |
| `templateDirectory` | `null` | `null` or an absolute addendum-directory path |
| `handoffTemplate` | `default.cmpl` | `.cmpl` filename, not a path |

The warning threshold produces one advisory warning. Critical warnings may repeat on settled turns. Neither warning threshold nor the automatic threshold gates explicit starts.

### Subagents

`pi-subagents` normally starts foreground child agents with `--no-session`. The extension therefore rejects a handoff in those children because there is no persisted source session. Persisted children (for example, runs configured with a `sessionFile` or `sessionDir`) can load this extension and run their own independent handoff; that replacement affects only the child session and does not replace or transfer the parent session.

Automatic session handoff is disabled by default. When using persisted subagents, leave it disabled unless child-session handoff is deliberate, or configure those child agents not to load this extension. This avoids an unplanned child replacement that the parent orchestration does not automatically follow.

## Managed paths and templates

The extension manages:

```text
<getAgentDir()>/pi-blitz-handoff/
├── config.json
├── recovery/
└── templates/
    └── default.cmpl
```

Missing managed directories are created during load. The package's root `default.cmpl` is installed as the managed default. If managed content differs, the old file is renamed beside it to a timestamped backup before the package default is installed. Other managed templates are retained. Deliberately configured directory symlinks are supported.

Template discovery is nonrecursive. An optional addendum directory shadows a managed template with the same filename. Each writer attempt resolves candidates in this order:

1. selected addendum template, when configured and present, otherwise selected managed template;
2. addendum `default.cmpl`, when configured;
3. managed `default.cmpl`.

A candidate must be a readable, nonempty `.cmpl` file. Candidate failures are reported. There is no embedded template fallback.

## Data and security

Handoff dossiers may contain sensitive project and conversation context. Deferred prompt files contain prompt text unchanged, plus extension-owned boundaries. They are stored as plaintext in the configured recovery directory. New managed directories and files use restrictive creation modes, but the extension is not a sandbox and does not provide secret detection, encryption, inode tracking, or a general filesystem-adversary policy.

See [SECURITY.md](SECURITY.md) for the security and data-handling model.

## Package development

Clone the repository and install its development dependencies:

```text
npm install
```

The deterministic test suite is classified as unit, integration, and package testing; it is not end-to-end Real-Pi testing.

```text
npm test
npm run typecheck
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
git diff --check
npm pack --dry-run
```

The candidate is tested for public registration, composed success, rejection/failure, cancellation/recovery, package metadata, and packed-file boundaries. A real current-Pi interactive/model/session validation has **not** been performed. That remains a separate gate because it invokes a real model and mutates real session state.
