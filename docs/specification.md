# pi-simple-handoff v1.0 Product Specification

> **FROZEN v1.0 — User-approved product authority.**
>
> This specification was rewritten from the completed runtime walkthrough and then frozen again with explicit user approval. Implementation must conform to it. Changes require another explicit user decision.

## 1. Purpose

`pi-simple-handoff` carries the material continuation context of a Pi session into a genuinely fresh, natively linked Pi session and starts that replacement session with the handoff.

The handoff is a self-contained continuation dossier, not a short summary. It preserves authorization boundaries: continuation context is not a new request and grants no new permission.

The implementation must use Pi's native lifecycle and session APIs. It must not simulate a replacement session or build a parallel scheduler around Pi.

## 2. Supported environment

- Pi v0.84.2 or later.
- Node.js v22.19.0 or later.
- Native replacement uses `ctx.newSession({ parentSession })`.
- The commands and in-chat interactions work in Pi's interactive chat surface.

## 3. Public surface

### Commands

- `/sh` — request a handoff.
- `/sh cancel` — cancel the active handoff.
- `/sh recover` — inspect and act on leftover deferred-prompt files.
- `/sh config` — configure the extension through an in-chat question-and-answer flow.

There is no internal or public transition command, `/sh retry`, `/sh cleanup`, `/shconfig`, or compatibility alias.

### Model-callable tool

The extension exposes `simple_handoff` with two actions:

- `status` — report context usage, relevant configuration, and handoff status.
- `start` — record an explicit handoff request and let the current model work settle.

The model calls `start` when the user explicitly requests a handoff. Discussion, questions, criticism, testing, or mention of handoffs are not start requests.

### Initiation paths

Exactly three initiation paths exist:

1. `/sh`;
2. `simple_handoff start`;
3. optional automatic initiation.

At most one handoff may be active. A second start request is rejected visibly and does not replace active IDs or state.

Explicit `/sh` and explicit `simple_handoff start` are never blocked by a context threshold. Only automatic initiation uses the configured automatic threshold.

## 4. Configuration and managed data

Managed data lives below:

```text
<getAgentDir()>/pi-simple-handoff/
├── config.json
├── recovery/
└── templates/
    └── default.cmpl
```

The extension checks these directories while loading and creates missing directories. Deliberately configured symlinks are supported. The extension does not implement inode tracking, descriptor identity checks, `O_NOFOLLOW` policy, or a general filesystem security framework.

Internally generated filenames cannot contain path traversal. New private files and directories use restrictive creation modes. Configuration and recovery-file replacement use ordinary atomic writes. Cleanup is exact and nonrecursive.

### Defaults

```json
{
  "contextWarningPercent": 60,
  "criticalWarningPercent": 90,
  "automaticSessionHandoff": false,
  "automaticSessionHandoffPercent": 70,
  "readinessRetrySeconds": 60,
  "writerAttempts": 3,
  "writerRetryDelaySeconds": 30,
  "recoveryDirectory": "<getAgentDir()>/pi-simple-handoff/recovery/",
  "templateDirectory": null,
  "handoffTemplate": "default.cmpl"
}
```

Warning thresholds satisfy:

```text
1 <= contextWarningPercent < criticalWarningPercent <= 100
```

Automatic handoff is disabled when `automaticSessionHandoff` is false or `automaticSessionHandoffPercent` is `0`. When enabled with a nonzero threshold, the threshold is from `1` through `100`. A zero automatic threshold never gates explicit `/sh` or `simple_handoff start`.

Retry delays are integer seconds from `1` through `300`. `writerAttempts` is a positive integer and means total attempts including the first.

`recoveryDirectory` and an optional `templateDirectory` are absolute directory paths. `handoffTemplate` is a `.cmpl` filename, not a path. A directory setting must resolve to a directory; when it does not exist, the config dialog asks whether `save` may create it. Deliberate directory symlinks are valid.

### In-chat configuration

`/sh config` starts an extension-owned chat dialog. It shows the available settings and the current draft values. The user chooses one setting, answers the value question, and returns to the setting list. This may repeat in any order.

The dialog ends only with:

- `save` — validate and atomically persist the complete draft;
- `cancel` — discard the complete draft.

Nothing is persisted before `save`. Confirmed missing directories are created as part of saving the validated draft. Dialog questions and answers do not enter model context. `/reload` or session replacement discards an unsaved draft. A TUI overlay is not part of v1.0.

## 5. Managed default and template catalogue

The package ships the root asset `default.cmpl`. On load, the extension compares it with managed `templates/default.cmpl`:

- equal content: do not write;
- missing managed file: install the package file;
- different content: rename the managed file beside itself to `default.cmpl.backup-<UTC timestamp>`, then install the package file.

The timestamp uses filesystem-safe UTC with millisecond precision. Backups do not end in `.cmpl`, never enter the template catalogue, and are not automatically deleted. Other managed templates are preserved.

Catalogue scans are nonrecursive. An optional configured addendum directory may shadow a managed template with the same filename.

Every writer attempt resolves the current template in this order:

1. selected effective template;
2. addendum `default.cmpl`, when configured;
3. managed `templates/default.cmpl`.

A valid template is a readable, nonempty `.cmpl` file. Every failed tier is reported. There is no embedded TypeScript template and no fourth fallback.

## 6. Warnings and automatic initiation

The warning percentage produces one advisory warning. At and above the critical percentage, a critical warning may be repeated after settled turns.

When automatic handoff is enabled, the extension starts it only when context usage reaches the configured automatic percentage and Pi reaches `agent_settled` with no pending message.

Manual and model-requested starts ignore all context percentages.

## 7. Readiness

A start request records pending intent. It does not poll `ctx.isIdle()`.

Readiness begins only when Pi is settled and no user or system continuation is outstanding:

- a request made during a model run waits for `agent_settled`;
- a request made while Pi is already settled may dispatch immediately;
- `ctx.hasPendingMessages()` must be false before dispatch.

For each readiness attempt the extension creates two new unpredictable identifiers: one for `GO` and one for `NOT YET`. The readiness prompt asks only whether session-owned work is still active and requires exactly one current identifier as its answer.

Only the exact current `GO` identifier is accepted as readiness. The writer may begin only after that response's model run also reaches `agent_settled` and no pending message remains.

The exact current `NOT YET` identifier, a malformed answer, or no valid answer leaves the handoff pending. Another check is scheduled after `readinessRetrySeconds`. Retry uses one timer, not periodic idle polling.

If interactive or RPC input arrives while readiness is active:

1. invalidate the current GO and NOT-YET identifiers;
2. let the input pass unchanged to the source agent;
3. wait for the resulting work to reach `agent_settled`;
4. start a fresh readiness attempt with fresh identifiers.

Steering is recognized through the Pi input event's `streamingBehavior === "steer"`. Follow-up input has the same invalidating effect. Before an accepted GO, user input is normal source-session work and is not deferred.

There is no separate active-questioning detector or questioning state. An unfinished question-and-answer exchange is ordinary session-owned work: readiness returns NOT YET, the user's answer passes through normally, and readiness is tried again after the resulting settled boundary.

## 8. GO boundary and deferred prompts

The accepted GO followed by its settled boundary starts the handoff writer and the deferred-prompt window.

From that boundary until replacement is released:

- incoming user prompt text is handled by the extension and does not reach the source writer;
- each prompt is kept unchanged in memory;
- prompt boundaries and arrival order are preserved;
- no prompt parsing, rewriting, summarization, link extraction, or content classification occurs.

The in-memory list is the normal runtime source. As a recovery precaution, the extension also maintains one Markdown file for the entire handoff window. Its filename is:

```text
<filesystem-safe UTC handoff timestamp>-<normalized source session ID>.md
```

The timestamp has millisecond precision. The normalized session component contains only letters, digits, and hyphens.

That one file contains every deferred prompt for the handoff in arrival order. Prompt boundaries use:

```text
--- Deferred Prompt N of M ---
```

The markers are extension-owned; the prompt strings between them remain unchanged. The complete file is atomically updated when another prompt arrives. There is never one recovery file per prompt.

If no post-GO prompt arrives, no recovery file is required.

## 9. Writer

At each attempt the extension:

1. resolves the currently effective template;
2. saves the active Pi tool list;
3. allows only `submit_session_handoff`;
4. sends the writer prompt to the source model.

The writer prompt includes the complete template, exact current submission ID, and exact source-session transcript path. It instructs the model to do no further task work and to submit exactly once.

`submit_session_handoff` accepts only:

- `id` — the exact current submission ID;
- `content` — the complete handoff Markdown.

The extension validates current-ID correlation, nonempty content, and absence of NUL. It does not parse the Markdown structure or impose a product-specific byte cap.

The template instructs the model to begin the handoff with a concise, meaningful Markdown title and then continue with the dossier. There is no separate session-name field, parser, sanitizer, or second title channel.

The dossier distinguishes completed and verified work, completed but unverified work, partial or reverted work, authorized work, work requiring fresh approval, blockers, open questions, working files, evidence, prior decisions, and precise cold-context references. It must not turn discussion, criticism, rejected proposals, or unanswered questions into authorization.

The built-in template retains these continuation sections after its meaningful title:

1. `Goal and authorization`
2. `Continuation map`
3. `Current truth`
4. `History and decisions`
5. `Active behavioral instructions`
6. `Working-set inventory`
7. `Validation and evidence`
8. `Upcoming work`
9. `Task packets`
10. `Open questions`
11. `Context catalogue`
12. `Precision anchors`
13. `Cold context`
14. `Integrity notes`
15. `Post-Handoff Initial Action`

The final section records one precise next mode, resume point, and first action. It may continue autonomous work or questioning only when that activity was already authorized before the handoff.

The original Pi tool list is restored after success, cancellation, exhaustion, and any terminal writer failure.

If an attempt settles without a valid submission, the next attempt starts after `writerRetryDelaySeconds`, up to `writerAttempts` total attempts. The configured values alone control count and delay. No writer retry command exists.

After exhaustion the handoff stops visibly. Any deferred-prompt recovery file remains for `/sh recover`.

## 10. Deterministic assembly and native replacement

After a valid writer submission, no further model call is used to assemble the transition prompt.

When deferred prompts exist, the extension appends this section to the submitted handoff:

```markdown
## Deferred Prompts
```

It then appends each unchanged prompt in original order with deterministic boundaries. When no deferred prompt exists, the handoff is not given an empty deferred section.

After the successful writer run reaches `agent_settled`, the extension directly calls `ctx.newSession({ parentSession: sourceSessionPath })`. There is no queued command and no intermediate handoff transport file.

The complete assembled Markdown becomes the first user prompt of the fresh linked session and starts the replacement model. Its first line is already the writer-produced meaningful title.

After the replacement session has received the prompt and the session transition has succeeded, the corresponding deferred-prompt recovery file is deleted. That completes the handoff.

The source transcript remains available through native parent-session lineage and the exact source path recorded in the handoff. The submitted handoff also remains visible in the source session's tool log.

## 11. Cancellation and lifecycle

Before GO, `/sh cancel` clears the pending request and invalidates readiness identifiers.

After GO, `/sh cancel` stops extension-owned writer or transition work, restores the original tools, and leaves any deferred-prompt recovery file untouched for `/sh recover`. This is the complete post-GO cancellation behavior: deferred prompts are not automatically replayed to the source session.

Before GO, user session navigation may discard the pending handoff. From GO until completion or cancellation, user-initiated session replacement, fork, and compaction are blocked because they would invalidate the active transfer. The extension's own native replacement is allowed.

Late readiness answers, submissions, timers, and callbacks belonging to an invalidated handoff do nothing.

A reload or process interruption may end the active in-memory handoff. It does not auto-resume or auto-replay work. A deferred-prompt recovery file remains available. A submitted handoff remains available in the source session log.

## 12. Recovery

Recovery is explicit and file-based. The extension never automatically executes leftover prompts.

`/sh recover` lists every remaining handoff recovery file with its date. The user selects one file at a time and may:

- inspect its complete prompt contents;
- execute it;
- discard it;
- return to the file list or cancel recovery.

Recovery questions and answers are extension-owned and do not enter model context.

Executing a file sends all prompts from that file to the current session as one combined user turn, preserving their stored order and boundaries. The file is deleted only after Pi accepts that user turn.

Discarding deletes only the explicitly selected file. Inspecting never changes it. Unreadable files are reported and left untouched.

Recovery has no per-prompt selection, `pending`/`dispatching` states, checkpoint identity protocol, automatic replay, Outbox, or delivery-uncertain state machine.

## 13. Status and failures

The extension exposes concise factual status in chat and through `simple_handoff status`. The small persistent status surface has three principal states:

- `Waiting for Session Handoff`;
- `Writing Session Handoff` with an indeterminate activity indicator;
- `Session Handoff Finished`.

Failure and cancellation override those states. Concrete attempt information may appear in factual chat or tool status, but the persistent indicator does not invent fractional or numbered progress.

All product-facing messages, dialogs, templates, and documentation use clear English.

Failures are visible and concrete. A terminal failure restores tools, invalidates active IDs and timers, stops automatic continuation of that run, and reports whether a recovery file remains.

Cleanup failure is reported with the affected path. It does not roll back a replacement session that already succeeded.

## 14. Validation

Automated tests cover the actual deterministic contracts:

- configuration validation, atomic save, and in-chat draft/save/cancel behavior;
- managed default comparison, backup, catalogue, and fallback;
- explicit versus automatic initiation;
- event-driven readiness, exact identifier correlation, timer retry, and input invalidation;
- writer prompt, tool isolation/restoration, submission validation, and configured attempts;
- deferred-prompt ordering, one-file persistence, and deterministic assembly;
- direct native replacement and parent-session lineage inputs;
- cancellation and stale-callback invalidation;
- per-file recovery inspection, execution, discard, and delete-after-acceptance;
- public commands, public tool, and factual status.

Tests use focused adapters and pure helpers where needed. They do not implement a second fake Pi runtime.

The local gate is:

```text
npm test
npm run typecheck
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
git diff --check
npm pack --dry-run
```

A real current-Pi validation is a separate final gate and requires fresh user approval because it invokes a real model and mutates real session state.

## 15. Non-goals

v1.0 excludes:

- a TUI or overlay configuration editor;
- an internal transition command;
- idle polling;
- a separate session-name field;
- an intermediate handoff transport file;
- one recovery file per prompt;
- automatic deferred-prompt replay;
- a recovery dispatch state machine;
- a filesystem adversary framework;
- compatibility shims for obsolete state or configuration;
- an embedded template fallback;
- a generic extra continuation turn;
- strict dossier heading validation;
- an arbitrary dossier size limit;
- optional-extension-specific readiness logic;
- GitHub CI.

## 16. Authority and freeze

This document is the frozen, user-approved v1.0 product authority after the runtime simplification walkthrough.

Implementation history, previous plan text, and existing code are not authority when they disagree with this document. Any future specification change requires explicit user approval before implementation.
