# pi-blitz-handoff

Steer your context. Hand off what matters.

<p align="center">
  <img src="assets/logo.png" alt="pi-blitz-handoff logo" width="320">
</p>

`pi-blitz-handoff` carries the material continuation context of a persisted Pi session into a fresh Pi session through template-guided readiness checks and handoff dossiers. It asks the current model to prepare a structured handoff dossier, creates the replacement through Pi's native session API with the source session as its parent, and sends the dossier as the replacement session's first user turn.

> [!TIP]
> **Latest feature addition: Project directory specific templates**
>
> Run `/sh-project-template` to select the Call and Handoff Templates for the current Pi working directory and its descendants. Each role independently uses its nearest concrete selection while walking upward.

The “Blitz” in the project name is the author's surname, not a speed claim. Do not expect a handoff to be faster than compaction; its purpose is more precise context transfer, not speed.

A handoff preserves authorization boundaries: continuation context is not a new request and grants no new permission.

The supplied default template tells the writer to:

- distinguish verified, unverified, partial, authorized, and approval-dependent work;
- preserve blockers and unresolved questions;
- record session-specific runtime state separately from the cumulative skill inventory, using `None.` for absent categories; and
- make every replacement session begin with a concise re-entry summary before it continues work, handles deferred prompts, asks a question, or waits.

The handoff protocol and session transition are deterministic. The LLM only decides when the semantic readiness boundary has been reached, writes the continuation dossier, and continues from it in the replacement session.

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
- `/sh-config` — edit global configuration in an extension-owned chat dialog.
- `/sh-project-template` — select or remove project-specific Call and Handoff Templates for the current Pi working directory.
- The `/sh cancel`, `/sh recover`, `/sh config`, `/sh project-template`, and `/sh help` forms remain available as subcommand aliases.

There is no public retry command, cleanup command, or public transition command.

### Model-callable tool

The `blitz_handoff` tool has two actions:

- `status` — report context usage, warning and automatic thresholds, the one-time readiness reminder delay, and current handoff status.
- `start` — request a handoff only when the user explicitly requested one.

Discussion, questions, criticism, testing, or a mention of handoffs are not start requests.

## How a handoff works

1. An explicit `/sh` or `blitz_handoff start` records the request. Explicit starts ignore all context thresholds.
2. Automatic initiation is optional. When enabled, it detects the first completed turn at or above its configured threshold and inserts readiness before the next autonomous model turn without interrupting completed-turn tool work. If that automatic attempt ends without successful replacement, one final automatic attempt becomes eligible at or above the configured critical-warning percentage; a second unsuccessful attempt is not repeated. The two-attempt limit survives `/reload` through native session metadata. Every successful manual, threshold, or overflow compaction resets that budget; failed or aborted compaction does not.
3. Manual or model-requested starts send one Call Template plus a fresh correlation key at the first boundary where Pi is idle and has no pending messages. An automatic start steers the same instruction into the next model turn. The selected Call Template owns the semantic work-boundary and working-style guidance; deterministic code adds only the correlated tool protocol and non-configurable interaction constraints.
4. At the boundary defined by the Call Template, an explicit handoff lets the model choose one keyed entry point. `session_handoff_go` accepts direct readiness. `session_handoff_go_with_user_deferral` supplies a short reason and opens an extension-owned **Ready / Wait / Cancel** selection. The shipped templates reserve that choice for a concrete active collaboration that may still need the current user. An automatically initiated handoff permits only direct GO and rejects user deferral so the autonomous run cannot be stopped by a choice dialog.
5. For an explicit handoff, **Ready** accepts GO. **Wait** keeps input normal, suspends the reminder, and shows `Awaiting User GO · Tell your LLM to start when ready`; a later explicit user readiness message lets the model call direct GO. **Cancel** ends the request. The extension does not parse free-form user replies.
6. If the permitted entry point has not been invoked after `readinessRetrySeconds`, exactly one visible reminder reapplies the same Call Template and source-specific tool protocol. This prevents a deadlock when background work completed without producing another model turn without imposing a separate hard-coded work-boundary policy. There is no periodic polling, and no reminder runs after **Wait**.
7. After GO is accepted, ordinary interactive and RPC prompts are deferred immediately. They do not reach the source writer; they remain unchanged and ordered in memory and are atomically written to one recovery Markdown file.
8. At the next boundary where Pi is idle and has no pending messages, the writer resolves the current dossier template, temporarily allows only its private submission tool, and submits a dossier correlated to the current attempt. Writer-only control is explicitly turn-local and must not be transferred as a user instruction or continuation constraint. The template filename and content are deliberately resolved at each writer start or retry rather than captured immutably when the handoff is requested. The original active tool list is restored on success, cancellation, exhaustion, or terminal failure.
9. Deterministic code appends any deferred prompts to the dossier. No additional model call assembles the transition prompt.
10. The extension calls `ctx.newSession({ parentSession: sourceSessionPath })` and sends the assembled Markdown through the fresh replacement-session context. The source transcript therefore remains available through Pi's native parent lineage.
11. Once Pi has created the replacement session and queued the assembled handoff as its first user turn, the extension deletes the corresponding recovery file. If deletion fails, the replacement remains successful and the extension reports the retained file path.

The previous protocol repeatedly asked a broad “session-owned work” question and required exact text `GO` or `NOT-YET` responses. That wording confused unfinished future work with work actually in flight, while retries spent model turns without improving the decision. The keyed tools make correlation deterministic, the Call Template states the semantic boundary once, and the single reminder exists only to recover from a genuinely quiet background-work boundary.

The submitted dossier's first line is its model-written, task-specific Markdown title. The extension does not semantically validate the title or dossier headings.

At most one handoff is active. A second start is rejected without replacing the active state. Once native cutover has been invoked, cancellation is no longer available.

## Status and cancellation

The activity line is rendered as a Pi widget directly above the input editor. It does not depend on the configured footer or powerline. The persistent status uses these factual states:

- `Waiting for Session Handoff` in yellow;
- `User Input Required` in red while the extension-owned choice is open;
- `Writing Session Handoff`;
- `Session Handoff Finished`.

Failure and cancellation override those states. Finished status remains in the replacement session until its next agent run starts, ordinary user input arrives, or another handoff begins. Its second line reports the wait from initiation to accepted `GO` and the handoff time from `GO` to successful completion. After `GO`, the activity line shows `Inputs deferred (0)` and increments the count for every captured prompt.

Before GO is accepted, canonical `/sh-cancel` clears pending readiness or the user-wait state. After GO is accepted but before native replacement begins, it stops extension-owned writer work, restores the prior tools, and leaves a deferred-prompt recovery file for explicit recovery. Every successful cancellation sends a follow-up instruction that releases the model from the earlier readiness or writer request and resumes normal work. The spaced `/sh cancel` alias remains accepted. Deferred prompts are not replayed automatically to the source session.

From `GO` until completion or cancellation, user-initiated session replacement, fork, and compaction are blocked. The extension's own correlated native replacement is allowed.

A potential race between a still-pending asynchronous start and cancellation or shutdown has not been reproduced in normal operation. If you can reproduce it, please open an issue or PR with the smallest reliable reproduction; the extension does not add speculative lifecycle-token machinery.

## Recovery

`/sh recover` lists remaining top-level recovery Markdown files with their dates. For one selected file at a time, the dialog can:

- inspect the complete contents without changing the file;
- execute all stored prompts in the current session as one combined user turn that preserves their order and boundaries;
- discard exactly that file;
- return to the list or cancel.

Recovery is always explicit. It never automatically executes leftover prompts. Execution deletes the file only after message dispatch returns without an immediate error; unreadable files and immediately rejected dispatches are reported and retained.

## Configuration

Run `/sh-config` in an interactive UI. Changes remain an in-memory draft until **Save configuration**. **Cancel configuration**, `/reload`, or session replacement discards an unsaved draft. Saving validates the complete draft and asks before creating a missing configured directory.

Call and handoff template settings list the available, readable, nonempty templates for their role: `call_*.cmpl` for Call Templates and `handoff_*.cmpl` for dossier templates. **Enter another filename** remains available for manual `.cmpl` filename entry.

Saved configuration takes effect after `/reload`; the currently loaded extension instance is not dynamically rebuilt.

| Setting | Default | Constraint |
|---|---:|---|
| `contextWarningPercent` | `60` | Finite number, at least 1 and below the critical threshold |
| `criticalWarningPercent` | `90` | Finite number, above the warning threshold and at most 100 |
| `automaticSessionHandoff` | `false` | Boolean |
| `automaticSessionHandoffPercent` | `70` | Finite number from 0 through 100; 0 disables automatic initiation; first automatic-attempt threshold |
| `readinessRetrySeconds` | `60` | Integer from 1 through 300; delay before the single silent re-evaluation turn |
| `writerAttempts` | `3` | Positive integer; total attempts including the first |
| `writerRetryDelaySeconds` | `30` | Integer from 1 through 300 |
| `recoveryDirectory` | managed recovery directory | Absolute directory path |
| `templateDirectory` | `null` | `null` or an absolute addendum-directory path |
| `callTemplate` | `call_default.cmpl` | `.cmpl` filename for readiness semantics, not a path |
| `handoffTemplate` | `handoff_default.cmpl` | `.cmpl` filename for the dossier writer, not a path |

The warning threshold produces one advisory warning. Critical warnings may repeat on settled turns. After an unsuccessful first automatic handoff, `criticalWarningPercent` is also the threshold for one final automatic attempt. Neither warning threshold nor the automatic threshold gates explicit starts.

### Subagents

`pi-subagents` normally starts foreground child agents with `--no-session`. The extension therefore rejects a handoff in those children because there is no persisted source session. Persisted children (for example, runs configured with a `sessionFile` or `sessionDir`) can load this extension and run their own independent handoff; that replacement affects only the child session and does not replace or transfer the parent session.

Automatic session handoff is disabled by default. When using persisted subagents, leave it disabled unless child-session handoff is deliberate, or configure those child agents not to load this extension. This avoids an unplanned child replacement that the parent orchestration does not automatically follow.

## Managed paths and templates

The extension manages:

```text
<getAgentDir()>/pi-blitz-handoff/
├── config.json
├── project-templates.json
├── recovery/
└── templates/
    ├── backups/
    ├── call_balanced.cmpl
    ├── call_default.cmpl
    ├── call_fast.cmpl
    ├── handoff_balanced.cmpl
    ├── handoff_default.cmpl
    └── handoff_fast.cmpl
```

Missing managed directories are created during load. The package installs all six shipped templates into the managed template directory. If same-name managed content differs, the old file is moved into the managed `templates/backups/` subdirectory with a timestamped filename before the package template is installed. Catalogue scans are nonrecursive, so backups do not appear in template selection. Other managed templates are retained. Deliberately configured directory symlinks are supported.

### Shipped profiles

| Profile | Call and Handoff Templates | Behavior |
|---|---|---|
| **Fast** | `call_fast.cmpl`, `handoff_fast.cmpl` | Prioritizes speed. Produces a condensed dossier, indexes known sources instead of restating older knowledge, omits the user-facing recap, and continues authorized autonomous work directly. |
| **Balanced** | `call_balanced.cmpl`, `handoff_balanced.cmpl` | Balances transfer detail and speed. Provides a brief re-entry summary while deliberately leaving indexed context reconstruction and more initialization work to the replacement session. |
| **Precise (default)** | `call_default.cmpl`, `handoff_default.cmpl` | Performs the most complete context synthesis before replacement so the new session can resume with minimal reconstruction. |

All profiles preserve authorization, safety boundaries, blockers, and critical facts precisely. When autonomous continuation is authorized, every profile requires the replacement model to perform the next work rather than merely announce that it will continue.

Existing exact configurations that predate `callTemplate` load with `call_default.cmpl` in memory and are not rewritten automatically.

### Project template assignments

Run `/sh-project-template` to configure the current Pi working directory. The extension shows separate Call and Handoff selection boxes. `<Autodiscover>` leaves that role without a local override, `<Default>` selects its existing role-default filename directly, and the remaining choices are readable, nonempty role-specific templates. The default filename is not duplicated in the catalogue choices.

Each Enter persists that role immediately. If no exact assignment exists, the other role begins as `<Autodiscover>`. Escape discards only the currently unconfirmed choice, so a role confirmed earlier in the dialog remains saved. There is no separate Save action. Selecting `<Autodiscover>` for both roles removes the exact assignment: an existing assignment is reported as removed; when none exists, no file is written and the dialog reports that fact.

At each handoff, the extension reads `project-templates.json` and resolves Call and Handoff independently while walking upward from the current Pi working directory. Each role uses the nearest concrete selection; an unresolved role uses its global setting. `<Default>` bypasses further project and global selection for that role while using the unchanged template resolver. Assignments below the current directory are never considered.

If the project settings file is unreadable, invalid JSON, or fails validation, the start continues only when both role defaults genuinely resolve. One concise warning states the category, that role defaults are active for this handoff, and that the user may ask Pi to inspect the file. The extension does not repair or rewrite the file automatically.

You can customize the Call and dossier templates to make handoffs shorter and faster or more precise for your particular purpose. The extension still owns and appends the deterministic correlation, tool, and interaction rules.

Template discovery is nonrecursive. An optional addendum directory shadows a managed template with the same filename. Call and dossier templates use separate configuration fields but the same simple resolver. Each resolution attempts:

1. the selected addendum template, when configured and present, otherwise the selected managed template;
2. the role-specific addendum default (`call_default.cmpl` or `handoff_default.cmpl`), when configured;
3. the corresponding managed role-specific default.

A candidate must be a readable, nonempty `.cmpl` file. Both configured roles are checked at startup and whenever `/sh-config` or `/sh config` opens. A failed non-default selection falls back to its role default with a visible warning that names the failure and actual fallback; selecting the role default does not itself warn. If the role default cannot resolve, startup or configuration opening fails visibly. There is no placeholder engine or embedded template fallback. Deterministic code always appends the current key, exact tool protocol, and interaction rules to the editable Call Template, so a custom template cannot own or remove those invariants.

## Data and security

Handoff dossiers may contain sensitive project and conversation context. Deferred prompt files contain prompt text unchanged, plus extension-owned boundaries. They are stored as plaintext in the configured recovery directory. `project-templates.json` stores absolute directory paths and template filenames. New managed directories and files use restrictive creation modes, but the extension is not a sandbox and does not provide secret detection, encryption, inode tracking, or a general filesystem-adversary policy.

See [SECURITY.md](SECURITY.md) for the security and data-handling model.

## Package development

Clone the repository and install its development dependencies:

```text
npm install
```

The deterministic test suite covers unit, integration, and package testing; it is not end-to-end Real-Pi testing.

```text
npm test
npm run typecheck
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
git diff --check
npm pack --dry-run
```

The candidate is tested for public registration, project-template selection and inheritance, composed success, rejection/failure, cancellation/recovery, package metadata, and packed-file boundaries. Version 1.1.0 was also validated interactively with current Pi across manual, automatic, model-initiated, user-deferral, cancellation, resume, tree, and fork behavior.
