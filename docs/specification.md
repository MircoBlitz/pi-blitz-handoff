# pi-blitz-handoff Product Specification

> **Current approved product authority.**
>
> This specification incorporates the explicitly approved keyed-readiness redesign. Material product, UX, authorization, security, or scope changes require a new explicit user decision; small implementation details clearly implied by the approved concept may be resolved by the orchestrator.

## 1. Purpose

This extension is designed for one purpose: to capture a session’s continuation context more precisely than compaction and pass it to a fresh, natively linked Pi session as the first prompt that starts the replacement. How work continues is determined by the user’s existing instructions, workflow, and templates.

Automatic handoff describes only how transfer is triggered; it does not select or authorize the replacement session's working mode. Autonomous execution, interactive clarification, answering, research, and waiting are transferred continuation modes rather than extension-owned workflows.

The handoff is a self-contained continuation dossier, not a short summary. It preserves the existing instructions, next action, and authorization boundaries: continuation context is not a new request and grants no new permission.

The implementation must use Pi's native lifecycle and session APIs. It must not simulate a replacement session or build a parallel scheduler around Pi.

## 2. Supported environment

- Pi v0.84.2 or later.
- Node.js v22.19.0 or later.
- Native replacement uses `ctx.newSession({ parentSession })` through Pi's command context.
- The commands and in-chat interactions work in Pi's interactive chat surface.
- A persisted source session is required. Initiation is rejected visibly in `--no-session` or other in-memory sessions because they have no source transcript path or native parent lineage.

## 3. Public surface

### Commands

- `/sh` — request a handoff.
- `/sh-help` — show handoff commands and usage.
- `/sh-cancel` — cancel the active handoff.
- `/sh-recover` — inspect and act on leftover deferred-prompt files.
- `/sh-config` — configure global extension settings through an in-chat question-and-answer flow.
- `/sh-project-template` — configure or remove the project-template assignment for the current Pi working directory.

The spaced `/sh help`, `/sh cancel`, `/sh recover`, `/sh config`, and `/sh project-template` forms remain quietly accepted as subcommand aliases. There is no public transition command, `/sh retry`, `/sh cleanup`, or `/shconfig`. The implementation may register one private extension command as the smallest documented bridge from tool- or event-initiated work into the `ExtensionCommandContext` required by `ctx.newSession()`. That bridge is not an initiation path, is not advertised to the user, and accepts only the currently correlated transition request.

### Model-callable tool

The extension exposes `blitz_handoff` with two actions:

- `status` — report context usage, relevant configuration, and handoff status.
- `start` — record an explicit handoff request and let the current model work settle.

The model calls `start` when the user explicitly requests a handoff. Discussion, questions, criticism, testing, or mention of handoffs are not start requests.

### Initiation paths

Exactly three initiation paths exist:

1. `/sh`;
2. `blitz_handoff start`;
3. optional automatic initiation.

At most one handoff may be active. A second start request is rejected visibly and does not replace active IDs or state.

Explicit `/sh` and explicit `blitz_handoff start` are never blocked by a context threshold. Only automatic initiation uses the configured automatic threshold.

## 4. Configuration and managed data

Managed data lives below:

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
  "recoveryDirectory": "<getAgentDir()>/pi-blitz-handoff/recovery/",
  "templateDirectory": null,
  "callTemplate": "call_default.cmpl",
  "handoffTemplate": "handoff_default.cmpl"
}
```

Warning thresholds satisfy:

```text
1 <= contextWarningPercent < criticalWarningPercent <= 100
```

Automatic handoff is disabled when `automaticSessionHandoff` is false or `automaticSessionHandoffPercent` is `0`. When enabled with a nonzero threshold, the threshold is from `1` through `100`. A zero automatic threshold never gates explicit `/sh` or `blitz_handoff start`.

Retry delays are integer seconds from `1` through `300`. `writerAttempts` is a positive integer and means total attempts including the first.

`recoveryDirectory` and an optional `templateDirectory` are absolute directory paths. `callTemplate` and `handoffTemplate` are `.cmpl` filenames, not paths. A directory setting must resolve to a directory; when it does not exist, the config dialog asks whether `save` may create it. Deliberate directory symlinks are valid.

### In-chat configuration

`/sh-config` starts an extension-owned chat dialog. It shows the available settings and the current draft values. The user chooses one setting, answers the value question, and returns to the setting list. This may repeat in any order. Template settings normally present the available readable, nonempty role-specific templates as a selection: Call Templates use the `call_` prefix and dossier templates use the `handoff_` prefix. An explicit manual-entry option remains available for another `.cmpl` filename.

The dialog ends only with:

- `save` — validate and atomically persist the complete draft;
- `cancel` — discard the complete draft.

Nothing is persisted before `save`. Confirmed missing directories are created as part of saving the validated draft. Dialog questions and answers do not enter model context. `/reload` or session replacement discards an unsaved draft. A TUI overlay is not part of v1.0.

## 5. Managed templates and catalogue

The package ships three paired profiles:

- **Fast** — `call_fast.cmpl` and `handoff_fast.cmpl`; prioritizes transfer speed, condenses noncritical context, indexes known older and future-task sources instead of restating them, omits a user-facing previous-session recap, and leaves detail retrieval to the replacement session.
- **Balanced** — `call_balanced.cmpl` and `handoff_balanced.cmpl`; balances transfer speed and context, provides a brief re-entry summary, and deliberately delegates more indexed context reconstruction and initialization to the replacement session.
- **Precise (default)** — `call_default.cmpl` and `handoff_default.cmpl`; retains the existing complete dossier contract and performs the most context synthesis before replacement.

All profiles preserve authorization, safety boundaries, blockers, and critical facts precisely. When autonomous continuation is authorized, each profile requires the replacement model to perform the next work rather than merely announce continuation.

On load, each of the six package assets is compared with its same-name file in the managed template directory:

- equal content: do not write;
- missing managed file: install the package file;
- different content: move the managed file into the managed `backups/` subdirectory as `<filename>.backup-<UTC timestamp>`, then install the package file.

The timestamp uses filesystem-safe UTC with millisecond precision. Catalogue scans do not recurse into `backups/`, and backups do not end in `.cmpl` or appear in template selection. Backups are not automatically deleted. Other managed templates are preserved.

Catalogue scans are nonrecursive. An optional configured addendum directory may shadow a managed template with the same filename. Call and dossier templates have separate configuration fields but share the same resolver. Each resolution uses:

1. the selected filename from the addendum directory when configured and present, otherwise the selected filename from the managed directory;
2. the role-specific addendum default (`call_default.cmpl` or `handoff_default.cmpl`), when configured;
3. the corresponding managed role-specific default.

Each physical candidate path is attempted at most once. A valid template is a readable, nonempty `.cmpl` file. Every failed candidate is reported. There is no placeholder engine, embedded TypeScript template, or fourth fallback.

Both configured roles are health-checked during extension startup and whenever `/sh-config` or `/sh config` opens. If a non-default selection is missing, unreadable, or empty, the role default is used and a visible warning identifies the failed candidate and actual fallback. Selecting the role default does not itself produce a warning. If the role default cannot resolve, startup or configuration opening fails visibly instead of continuing with pretend template content.

An exact older configuration lacking only `callTemplate` loads with `call_default.cmpl` added in memory and is not rewritten automatically.

### Project-template assignments

Project-template assignments are stored separately from global settings in `<getAgentDir()>/pi-blitz-handoff/project-templates.json`. The file is a JSON object keyed by normalized absolute directory. Every value contains exactly:

```json
{
  "callTemplate": "call_example.cmpl",
  "handoffTemplate": null
}
```

Both role keys are always present, and at least one contains a concrete role-prefixed `.cmpl` filename. `null` is displayed as `<Autodiscover>` and means that the exact directory has no local override for that role. A stored `null`/`null` pair is invalid because the dialog represents that state by removing the entry. Missing files represent no project assignments.

`/sh-project-template` uses `ctx.cwd` as the assignment root without asking for a path. It presents separate extension-owned role selections. Each contains `<Autodiscover>`, `<Default>`, and the readable, nonempty role-specific catalogue; the concrete default filename is omitted from the catalogue when `<Default>` already represents it. `<Default>` stores the existing role-default filename. Each Enter atomically persists that role immediately, with the other role initially `<Autodiscover>` when no exact assignment exists. Escape discards only the currently unconfirmed selection; it does not undo an earlier confirmed role. There is no Save action. Selecting `<Autodiscover>` for both roles uses the exact-entry removal path and preserves the factual existing-assignment versus no-assignment messages.

At each explicit or automatic handoff request, the extension reads the assignment file afresh and resolves the two roles independently while walking only upward from the normalized current Pi working directory. Each role uses its nearest concrete ancestor selection. If a role remains unresolved after the root, its global `config.json` selection applies. `<Default>` is a concrete selection and therefore bypasses further upward and global selection; the existing addendum-shadowing and managed-template resolver remains unchanged. Descendant assignments are never inspected.

Failure to read, parse, or validate the project assignment file does not by itself reject or skip a start. One concise native warning states the category, that the project settings could not be loaded, that both role defaults are active for this handoff, and that the user may ask Pi to inspect the file. No parser fragment is shown, and there is no automatic repair, overwrite, retry, repair dialog, or separate status subsystem. Both role defaults must genuinely resolve; otherwise the start fails with the concrete terminal template failure. This behavior is identical for explicit and automatic starts.

## 6. Warnings and automatic initiation

The warning percentage produces one advisory warning. At and above the critical percentage, a critical warning may be repeated after settled turns.

When automatic handoff is enabled, the extension checks context usage at each completed `turn_end`. At the first boundary at or above the configured automatic percentage, it records the automatic request and inserts readiness before the next model turn without interrupting the completed turn's tool work.

If that first automatic handoff ends without successful replacement, one final automatic attempt becomes eligible at or above `criticalWarningPercent`. It starts at the next completed turn boundary, including when the critical percentage was already exceeded before the first attempt ended. A second unsuccessful automatic attempt is not repeated. The accepted-attempt count is stored as native session metadata and reconstructed after `/reload`, so reload cannot reset the two-attempt limit.

Every successful compaction resets the accepted-attempt count to zero, whether its reason is manual, threshold, or overflow. The reset is stored in the same native session metadata and survives `/reload`. Failed or aborted compaction does not reset the count. Manual and model-requested starts remain available and ignore all context percentages.

## 7. Readiness

A start request records pending intent. Its source determines whether user deferral is available; it does not otherwise infer a working style.

For manual and model-requested handoffs, the initial readiness instruction begins only when Pi is settled and no user or system continuation is outstanding:

- a request made during a model run waits for `agent_settled`;
- a request made while Pi is already settled may dispatch immediately;
- `ctx.hasPendingMessages()` must be false before dispatch.

An automatic request is different: it is detected after a completed turn and its readiness instruction is delivered as steering before the next autonomous model turn, even when another continuation is already queued. This does not interrupt tools from the completed turn. The model still applies the same in-flight-work boundary, but only direct GO is permitted. User deferral is unavailable because a choice dialog could stop the autonomous run.

The extension creates one unpredictable correlation key and sends one resolved Call Template. The editable Call Template owns the semantic work-boundary and working-style guidance. Deterministic code appends only the exact correlated tool protocol and non-configurable interaction constraints; editable template prose does not own correlation, tool availability, user-choice mechanics, timers, or state invariants.

The three shipped Call Templates guide the current model to make the bounded semantic decision appropriate to their Fast, Balanced, or Precise profile. A custom Call Template may define a different working style without deterministic code appending a second work-boundary policy. Automatic handoffs still permit only direct GO because user deferral would stop the autonomous run.

Two correlated tools exist:

- `session_handoff_go({ key })` accepts direct GO for every initiation source;
- `session_handoff_go_with_user_deferral({ key, reason })` is available only for manual and model-requested handoffs. It supplies a short concrete reason and opens an extension-owned **Ready / Wait / Cancel** selection. An automatic attempt rejects this entry point before opening UI.

The extension does not parse free-form user text or build a working-style detector. The deferral selection resolves deterministically:

- **Ready** accepts GO;
- **Wait** keeps ordinary input normal, suspends the reminder for this handoff, and adds the status line `Awaiting User GO · Tell your LLM to start when ready`;
- **Cancel** ends the handoff.

After **Wait**, no timer or dialog runs automatically. A later ordinary user message may explicitly indicate readiness; the model then calls direct GO with the same key. The extension does not parse that message.

After the initial instruction, one timer is scheduled for `readinessRetrySeconds`. If the permitted tool has not resolved readiness when it fires, one short visible reminder triggers a model turn. The reminder reapplies the same resolved Call Template, then appends only the source-specific correlated tool protocol: explicit attempts retain both choices, while automatic attempts permit only direct GO. If the model calls no readiness tool, it produces no normal text. This one-shot reminder prevents deadlock when background work finishes without otherwise producing a new turn. There is no periodic polling.

Before accepted GO, interactive and RPC input passes unchanged and is not deferred. Slash commands retain Pi's native command behavior because Pi dispatches them before the `input` event.

## 8. GO boundary and deferred prompts

Accepted direct GO or **Ready** from the user-deferral selection starts the deferred-prompt window immediately. The writer starts only after the answering tool run reaches an idle `agent_settled` boundary with no pending message.

From that boundary until the native replacement begins:

- ordinary user prompt text that reaches Pi's `input` event is handled by the extension and does not reach the source writer;
- each prompt is kept unchanged in memory;
- prompt boundaries and arrival order are preserved;
- no prompt parsing, rewriting, summarization, link extraction, or content classification occurs.

Slash commands retain Pi's native command behavior. The extension keeps the transition visibly announced and uses the straightforward latest deferred-prompt snapshot when replacement starts; it does not add a second delivery protocol for theoretical cutover races.

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

1. resolves the currently effective template filename and content at writer start or retry; this is deliberately not immutable content captured when the handoff is requested;
2. saves the active Pi tool list;
3. allows only `submit_session_handoff`;
4. sends the writer prompt to the source model.

The writer prompt includes the complete dossier template, exact current submission ID, and exact source-session transcript path. Extension-owned writer control limits the model to handoff writing for that writer turn and requires exactly one submission. It explicitly states that this turn-local control is not a user instruction or continuation constraint and must not be included or preserved in the handoff.

`submit_session_handoff` accepts only:

- `id` — the exact current submission ID;
- `content` — the complete handoff Markdown.

The extension validates current-ID correlation, nonempty content, and absence of NUL. It does not parse the Markdown structure or impose a product-specific byte cap.

The template instructs the model to begin the handoff with a concise, meaningful, task-specific Markdown title and then continue with the dossier. This first line is also the useful visible name of the replacement session in Pi's session navigation. No generic handoff-status prefix may precede it. There is no separate session-name field, parser, sanitizer, or second title channel. Title and dossier structure are writer instructions, not claims of deterministic semantic validation.

The dossier distinguishes completed and verified work, completed but unverified work, partial or reverted work, authorized work, work requiring fresh approval, blockers, open questions, working files, evidence, prior decisions, and precise cold-context references. It must not turn discussion, criticism, rejected proposals, or unanswered questions into authorization.

The Precise default Handoff Template retains these continuation sections after its meaningful title:

1. `Goal and authorization`
2. `Continuation map`
3. `Current truth`
4. `History and decisions`
5. `Active behavioral instructions`
6. `Operational runtime state`
7. `Loaded skills`
8. `Working-set inventory`
9. `Validation and evidence`
10. `Upcoming work`
11. `Task packets`
12. `Open questions`
13. `Context catalogue`
14. `Precision anchors`
15. `Cold context`
16. `Integrity notes`
17. `Post-Handoff Initial Action`

`Operational runtime state` records only session-specific runtime deviations or status. It covers skills whose current operational state matters, subagents, intentionally changed tools, relevant live processes or cmux surfaces, and session-specific behavioral deltas; each category uses `None.` when absent. It does not duplicate the cumulative `Loaded skills` inventory or ordinary project facts.

The final writer-produced dossier section records one precise next mode, resume point, and first action. It may continue autonomous work or questioning only when that activity was already authorized before the handoff. An ordinary unanswered question is resumable continuation context rather than an automatic readiness blocker. Only a concrete active collaboration that may still matter before replacement justifies the user-deferral entry point, and only for a manual or model-requested handoff.

The Precise default requires every replacement session to begin its first visible assistant response with a concise user-facing re-entry summary, including during autonomous continuation. Balanced requires a briefer re-entry summary and then more initialization work in the replacement session. Fast omits the previous-session recap and proceeds directly. Every profile applies deferred prompts sequentially before following the recorded action. A deferred prompt may supersede that action. When autonomous continuation is authorized, the replacement must actually perform the next work in its first response rather than merely state that it will continue.

The original Pi tool list is restored after success, cancellation, exhaustion, and any terminal writer failure.

If an attempt settles without a valid submission, the next attempt starts after `writerRetryDelaySeconds`, up to `writerAttempts` total attempts. The configured values alone control count and delay. No writer retry command exists.

After exhaustion the handoff stops visibly. Any deferred-prompt recovery file remains for `/sh recover`.

## 10. Deterministic assembly and native replacement

After a valid writer submission and its settled boundary, no further model call is used to assemble the transition prompt. The extension invokes its private correlated transition command to obtain the command context required by Pi's native replacement API.

When deferred prompts exist, the extension appends this section to the submitted handoff:

```markdown
## Deferred Prompts
```

It then appends each unchanged prompt in original order with deterministic boundaries. The section tells the replacement model to treat the entries semantically as separate sequential user inputs after the dossier, so later deferred prompts may update or supersede earlier context. When no deferred prompt exists, the handoff is not given an empty deferred section.

The private correlated transition command calls `ctx.newSession({ parentSession: sourceSessionPath })`. There is no intermediate handoff transport file and no model-authored transition command.

The complete assembled Markdown becomes the first user prompt of the fresh linked session and starts the replacement model. Its first line is already the writer-produced meaningful title. The selected Handoff Template determines whether the replacement begins with the Precise or Balanced re-entry summary or proceeds directly under Fast; in every profile it handles deferred prompts before the recorded action and performs authorized autonomous continuation rather than only announcing it.

After the replacement session has accepted that prompt through its native replacement context and the session transition has succeeded, the corresponding deferred-prompt recovery file is deleted. That completes the handoff. `/sh recover` therefore lists only files left by interrupted, cancelled, or failed handoffs.

The source transcript remains available through native parent-session lineage and the exact source path recorded in the handoff. The submitted handoff also remains visible in the source session's tool log.

## 11. Cancellation and lifecycle

Before GO, canonical `/sh-cancel` clears the pending request, correlation key, timer, and any user-wait state.

After GO and before native replacement starts, `/sh-cancel` stops extension-owned writer work, restores the original tools, and leaves any deferred-prompt recovery file untouched for `/sh-recover`. Every successful cancellation sends a visible follow-up instruction that tells the model to disregard the earlier readiness or writer request and submission ID, resume normal conversation and task work, and not submit a handoff. Once `ctx.newSession()` has been invoked, the cutover is committed and is no longer cancellable. Deferred prompts are not automatically replayed to the source session.

Before GO, user session navigation may discard the pending handoff. From GO until completion or cancellation, user-initiated session replacement, fork, and compaction are blocked because they would invalidate the active transfer. The extension's own native replacement is allowed.

Late readiness answers, submissions, timers, and callbacks belonging to an invalidated handoff do nothing.

A potential race between a still-pending asynchronous start and cancellation or shutdown is unreproduced in normal operation. A reproducible issue or PR with a minimal reproduction is welcome; speculative lifecycle-token machinery is not part of the product.

A reload or process interruption may end the active in-memory handoff. It does not auto-resume or auto-replay work. A deferred-prompt recovery file remains available. A submitted handoff remains available in the source session log.

## 12. Recovery

Recovery is explicit and file-based. The extension never automatically executes leftover prompts.

`/sh recover` lists every remaining handoff recovery file with its date. The user selects one file at a time and may:

- inspect its complete prompt contents;
- execute it;
- discard it;
- return to the file list or cancel recovery.

Recovery questions and answers are extension-owned and do not enter model context.

Executing a file sends all prompts from that file to the current session as one combined user turn, preserving their stored order and boundaries and instructing the model to treat them as separate sequential inputs. The file is deleted once that turn has been sent without an immediate dispatch error.

Discarding deletes only the explicitly selected file. Inspecting never changes it. Unreadable files are reported and left untouched.

Recovery has no per-prompt selection, `pending`/`dispatching` states, checkpoint identity protocol, automatic replay, Outbox, or delivery-uncertain state machine.

## 13. Status and failures

The extension exposes concise factual status in chat and through `blitz_handoff status`. The persistent status surface distinguishes:

- yellow `Waiting for Session Handoff`;
- red `User Input Required` while the extension-owned selection is open;
- `Writing Session Handoff` with an indeterminate activity indicator;
- `Session Handoff Finished` in the replacement session until the next agent run starts, ordinary user input arrives, or another handoff begins.

The active widget advertises canonical `/sh-cancel`. After **Wait**, the normal first activity line remains and a second width-safe line reads `Awaiting User GO · Tell your LLM to start when ready`.

Failure and cancellation override those states. A successful final status adds a second line with `Wait Time`, measured from initiation to accepted `GO`, and `Handoff Time`, measured from `GO` to successful completion. After `GO`, the persistent activity line shows `Inputs deferred (0)` and increments that factual count for every captured prompt. Concrete attempt information may appear in factual chat or tool status, but the persistent indicator does not invent fractional or numbered progress.

All product-facing messages, dialogs, templates, and documentation use clear English.

Failures are visible and concrete. A terminal failure restores tools, invalidates active IDs and timers, stops automatic continuation of that run, and reports whether a recovery file remains.

Cleanup failure is reported with the affected path. It does not roll back a replacement session that already succeeded.

## 14. Validation

Automated tests cover the actual deterministic contracts:

- configuration validation, atomic save, and in-chat draft/save/cancel behavior;
- synchronization of all six shipped profile templates, backup, catalogue, and fallback;
- project-template validation, per-role immediate persistence, atomic create/edit/removal, independent upward lookup, `<Autodiscover>` inheritance, `<Default>` overrides, and corrupt-file role-default fallback;
- explicit versus automatic initiation, including automatic rejection of user deferral;
- one-instruction readiness, exact keyed tool correlation, explicit-attempt user-deferral choices, source-specific one-shot reminders, and normal pre-GO input;
- distinct Fast, Balanced, and Precise writer contracts, writer prompt, tool isolation/restoration, submission validation, and configured attempts;
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
- a public transition command or a parallel replacement mechanism beyond the one private bridge required by Pi's command-only session API;
- periodic readiness polling;
- deterministic free-form user-text parsing or a working-style detection engine;
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
- optional-extension-specific readiness rules beyond the general in-flight-work boundary;
- GitHub CI.

## 16. Review status and authority

This document is the current product authority, including the approved keyed-readiness refinement.

Git history, previous plan text, and previous implementation code are not product authority and must not be used as implementation context. Workers may report a concrete gap but must not edit or reinterpret this specification. The orchestrator may approve a small implementation detail when it is clearly implied by the approved concept and does not materially change public behavior, UX, authorization, security, data lifecycle, or scope. Material changes, uncertainty, and genuine product decisions go to the user. Contradictory proposals are rejected rather than incorporated.
