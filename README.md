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

- `status` — report context usage, warning and automatic thresholds, the one-time readiness reminder delay, and current handoff status.
- `start` — request a handoff only when the user explicitly requested one.

Discussion, questions, criticism, testing, or a mention of handoffs are not start requests.

## How a handoff works

1. An explicit `/sh` or `blitz_handoff start` records the request. Explicit starts ignore all context thresholds.
2. Automatic initiation is optional. When enabled, it starts only at or above its configured threshold on an idle `agent_settled` boundary with no pending message.
3. At the first idle boundary, the extension sends one Call Template plus a fresh correlation key. The current model waits for genuinely in-flight model-owned work, tools, subagents, background work, or required output, but does not treat future tasks or an ordinary resumable question as blockers.
4. At a safe boundary the model chooses one keyed entry point. `session_handoff_go` accepts direct readiness and is preferred when uncertain. `session_handoff_go_with_user_deferral` is reserved for a concrete active collaboration that may still need the current user; it supplies a short reason and opens an extension-owned **Ready / Wait / Cancel** selection.
5. **Ready** accepts GO. **Wait** keeps input normal, suspends the reminder, and shows `Awaiting User GO · Tell your LLM to start when ready`; a later explicit user readiness message lets the model call direct GO. **Cancel** ends the request. The extension does not infer working style from how the handoff started and does not parse free-form user replies.
6. If neither entry point has been invoked after `readinessRetrySeconds`, exactly one visible reminder triggers a silent re-evaluation turn. This prevents a deadlock when background work completed without producing another model turn. There is no periodic polling, and no reminder runs after **Wait**.
7. After accepted GO, ordinary interactive and RPC prompts are deferred immediately: they do not reach the source writer, remain unchanged and ordered in memory, and are also atomically written to one recovery Markdown file.
8. At the next idle, no-pending boundary, the writer resolves the current dossier template, temporarily allows only its private submission tool, and submits a dossier correlated to the current attempt. The original active tool list is restored on success, cancellation, exhaustion, or terminal failure.
9. Deterministic code appends any deferred prompts to the dossier. No additional model call assembles the transition prompt.
10. The extension calls `ctx.newSession({ parentSession: sourceSessionPath })` and sends the assembled Markdown through the fresh replacement-session context. The source transcript therefore remains available through Pi's native parent lineage.
11. After Pi confirms the replacement and accepts the first prompt, the corresponding recovery file is deleted. A cleanup error is reported without rolling back the completed replacement.

The previous protocol repeatedly asked a broad “session-owned work” question and required exact text `GO` or `NOT-YET` responses. That wording confused unfinished future work with work actually in flight, while retries spent model turns without improving the decision. The keyed tools make correlation deterministic, the Call Template states the semantic boundary once, and the single reminder exists only to recover from a genuinely quiet background-work boundary.

The submitted dossier's first line is its model-written, task-specific Markdown title. The extension does not semantically validate the title or dossier headings.

At most one handoff is active. A second start is rejected without replacing active state. Once native cutover has been invoked, cancellation is no longer available.

## Status and cancellation

The activity line is rendered as a Pi widget directly above the input editor. It does not depend on the configured footer or powerline. The persistent status uses these factual states:

- `Waiting for Session Handoff` in yellow;
- `User Input Required` in red while the extension-owned choice is open;
- `Writing Session Handoff`;
- `Session Handoff Finished`.

Failure and cancellation override those states. Finished status remains in the replacement session until ordinary user input or another handoff begins. Its second line reports the wait from initiation to accepted `GO` and the handoff time from `GO` to successful completion. After `GO`, the activity line shows `Inputs deferred (0)` and increments the count for every captured prompt.

Before accepted GO, canonical `/sh-cancel` clears pending readiness or the user-wait state. After GO but before native replacement begins, it stops extension-owned writer work, restores the prior tools, and leaves a deferred-prompt recovery file for explicit recovery. The spaced `/sh cancel` alias remains accepted. Deferred prompts are not replayed automatically to the source session.

From `GO` until completion or cancellation, user-initiated session replacement, fork, and compaction are blocked. The extension's own correlated native replacement is allowed.

## Recovery

`/sh recover` lists remaining top-level recovery Markdown files with their dates. For one selected file at a time, the dialog can:

- inspect the complete contents without changing the file;
- execute all stored prompts in the current session as one combined user turn that preserves their order and boundaries;
- discard exactly that file;
- return to the list or cancel.

Recovery is always explicit. It never automatically executes leftover prompts. Execution deletes the file only after message dispatch returns without an immediate error; unreadable files and immediately rejected dispatches are reported and retained.

## Configuration

Run `/sh-config` in an interactive UI. Changes remain an in-memory draft until **Save configuration**. **Cancel configuration**, `/reload`, or session replacement discards an unsaved draft. Saving validates the complete draft and asks before creating a missing configured directory.

Saved configuration takes effect after `/reload`; the currently loaded extension instance is not dynamically rebuilt.

| Setting | Default | Constraint |
|---|---:|---|
| `contextWarningPercent` | `60` | Finite number, at least 1 and below the critical threshold |
| `criticalWarningPercent` | `90` | Finite number, above the warning threshold and at most 100 |
| `automaticSessionHandoff` | `false` | Boolean |
| `automaticSessionHandoffPercent` | `70` | Finite number from 0 through 100; 0 disables automatic initiation |
| `readinessRetrySeconds` | `60` | Integer from 1 through 300; delay before the single silent re-evaluation turn |
| `writerAttempts` | `3` | Positive integer; total attempts including the first |
| `writerRetryDelaySeconds` | `30` | Integer from 1 through 300 |
| `recoveryDirectory` | managed recovery directory | Absolute directory path |
| `templateDirectory` | `null` | `null` or an absolute addendum-directory path |
| `callTemplate` | `call_default.cmpl` | `.cmpl` filename for readiness semantics, not a path |
| `handoffTemplate` | `handoff_default.cmpl` | `.cmpl` filename for the dossier writer, not a path |

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
    ├── call_default.cmpl
    ├── handoff_default.cmpl
    └── default.cmpl              # compatible legacy dossier default
```

Missing managed directories are created during load. The package installs its root `call_default.cmpl`, `handoff_default.cmpl`, and compatible legacy `default.cmpl` into the managed template directory. If same-name managed content differs, the old file is renamed beside it to a timestamped backup before the package template is installed. Other managed templates are retained. Deliberately configured directory symlinks are supported.

Existing exact configurations that predate `callTemplate` load with `call_default.cmpl` in memory and are not rewritten automatically. An existing `handoffTemplate: "default.cmpl"` remains valid; the configuration dialog identifies it as the legacy name and points to `handoff_default.cmpl` as the new default.

Template discovery is nonrecursive. An optional addendum directory shadows a managed template with the same filename. Call and dossier templates use separate configuration fields but the same simple resolver. Each resolution attempts:

1. the selected addendum template, when configured and present, otherwise the selected managed template;
2. the role-specific addendum default (`call_default.cmpl` or `handoff_default.cmpl`), when configured;
3. the corresponding managed role-specific default.

A candidate must be a readable, nonempty `.cmpl` file. Both configured roles are checked at startup and whenever `/sh-config` or `/sh config` opens. A failed non-default selection falls back to its role default with a visible warning that names the failure and actual fallback; selecting the role default does not itself warn. If the role default cannot resolve, startup or configuration opening fails visibly. There is no placeholder engine or embedded template fallback. Deterministic code always appends the current key, exact tool protocol, and interaction rules to the editable Call Template, so a custom template cannot own or remove those invariants.

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
