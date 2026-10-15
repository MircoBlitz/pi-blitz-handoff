# pi-blitz-handoff Product Specification

> **Current approved product authority.**
>
> This specification incorporates the explicitly approved keyed-readiness redesign, unified overlay dialogs, and unreleased file-based handoff with optional Prepare while waiting and separate GO/DONE signals. Material product, UX, authorization, security, or scope changes require a new explicit user decision; small implementation details clearly implied by the approved concept may be resolved by the orchestrator.

## 1. Purpose

This extension is designed for one purpose: to capture a session’s continuation context more precisely than compaction and make it available to a fresh, natively linked Pi session through a local handoff file referenced by its first prompt. How work continues is determined by the user’s existing instructions, workflow, and templates.

Automatic handoff describes only how transfer is triggered; it does not select or authorize the replacement session's working mode. Autonomous execution, interactive clarification, answering, research, and waiting are transferred continuation modes rather than extension-owned workflows.

The handoff is a self-contained continuation dossier, not a short summary. It preserves the existing instructions, next action, and authorization boundaries: continuation context is not a new request and grants no new permission.

The implementation must use Pi's native lifecycle and session APIs. It must not simulate a replacement session or build a parallel scheduler around Pi.

## 2. Supported environment

- Pi v0.84.2 or later.
- Node.js v22.19.0 or later.
- Native replacement uses `ctx.newSession()` through Pi's command context, with `parentSession` until the configured chain limit is reached.
- The commands and in-chat interactions work in Pi's interactive chat surface.
- Pi's native `write` tool and a writable `.pi/` directory under the current Pi working directory are required for file transport.
- A persisted source session is required. Initiation is rejected visibly in `--no-session` or other in-memory sessions because they have no source transcript path or native parent lineage.

## 3. Public surface

### Commands

- `/sh` — open the handoff menu.
- `/sh start` — request a handoff directly.
- `/sh help` — show handoff commands and usage.
- `/sh cancel` — cancel the active handoff.
- `/sh recover` — inspect and act on leftover deferred-prompt files.
- `/sh settings` — configure global extension settings through the extension-owned dialog.
- `/sh project-template` — configure or remove the project-template assignment for the current Pi working directory.

Only `/sh` is registered publicly; start, help, cancel, recover, settings and project-template are its subcommands. Native argument completion presents all six subcommands with short descriptions after `/sh ` and filters them while typing. The former hyphenated commands and `/sh config` are not accepted as compatibility aliases. There is no public transition command, `/sh retry`, `/sh cleanup`, or `/shconfig`. The implementation may register one private extension command as the smallest documented bridge from tool- or event-initiated work into the `ExtensionCommandContext` required by `ctx.newSession()`. That bridge is not an initiation path, is not advertised to the user, and accepts only the currently correlated transition request.

### Model-callable tool

The extension exposes `blitz_handoff` with two actions:

- `status` — report context usage, relevant configuration, and handoff status.
- `start` — record an explicit handoff request and let the current model work settle.

The model calls `start` when the user explicitly requests a handoff. Discussion, questions, criticism, testing, or mention of handoffs are not start requests.

### Initiation paths

Exactly three initiation paths exist:

1. `/sh start` or **Start handoff** in the `/sh` menu;
2. `blitz_handoff start`;
3. optional automatic initiation.

At most one handoff may be active. A second start request is rejected visibly and does not replace active IDs or state.

Explicit `/sh start`, the menu's **Start handoff** action and explicit `blitz_handoff start` are never blocked by a context threshold. Only automatic initiation uses the configured automatic threshold.

### Unified overlay dialogs

In Pi's terminal UI, the main menu, global settings, project-template selection, recovery (including complete prompt inspection), help and **Ready / Wait / Cancel** use genuine native `ctx.ui.custom()` overlays. They share a compact, polished presentation: theme-aware borders and semantic colors, clear headings and descriptions, factual status where relevant, and visible keyboard hints. Use Pi's native components for selection, text input and scrolling; do not implement a second terminal renderer. Layout must remain usable at narrow terminal sizes, during resize and after theme changes.

The first menu action is **Start handoff** when no handoff is active and **Cancel handoff** when a handoff is active. Remaining actions are recovery, settings, project templates and help. Opening or dismissing the main menu has no start/cancel side effect; selecting its primary action invokes the same real implementation as the corresponding direct subcommand. Escape closes the main menu without action. All direct subcommands remain available.

This is a presentation overhaul, not a lifecycle or storage redesign. Existing readiness correlation, cancellation boundaries, automatic initiation, deferred-prompt handling, template resolution, immediate per-edit persistence and recovery execution/deletion contracts remain unchanged. Dialog input never enters model context. Existing non-TUI/RPC support deliberately retains Pi's native select/input/confirm dialogs where custom terminal overlays are unsupported; those interactions are not presented as overlays. No simulated overlay, alternate runtime or compatibility alias is introduced.

## 4. Configuration and managed data

Managed data lives below:

```text
<getAgentDir()>/pi-blitz-handoff/
├── config.json
├── project-templates.json
├── recovery/
└── templates/
    ├── backups/
    ├── call_default.cmpl
    └── handoff_default.cmpl
```

The extension checks these directories while loading and creates missing directories. Deliberately configured symlinks are supported. The extension does not implement inode tracking, descriptor identity checks, `O_NOFOLLOW` policy, or a general filesystem security framework.

Internally generated filenames cannot contain path traversal. New private files and directories use restrictive creation modes. Configuration and recovery-file replacement use ordinary atomic writes. Cleanup is exact and nonrecursive.

### Defaults

```json
{
  "contextWarningPercent": 60,
  "criticalWarningPercent": 90,
  "automaticSessionHandoff": false,
  "deleteHandoffAfterReading": true,
  "prepareWhileWaiting": false,
  "automaticSessionHandoffPercent": 70,
  "readinessRetrySeconds": 60,
  "maxSessionChainLength": 25,
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

Automatic handoff is disabled when `automaticSessionHandoff` is false or `automaticSessionHandoffPercent` is `0`. When enabled with a nonzero threshold, the threshold is from `1` through `100`. A zero automatic threshold never gates `/sh start`, the menu's **Start handoff** action or explicit `blitz_handoff start`.

`maxSessionChainLength` is a positive integer, default `25`, counting the master as session one. At or above the limit, the next handoff creates an independent master by omitting `parentSession`, transferring the unchanged complete handoff and deferred prompts. This bounds chain depth for readability in `/resume`, not work duration. Old sessions remain untouched. Length is read from native persisted parent-session headers and survives resume and reload; a new master starts at one. Configuration changes apply immediately. Unreadable required lineage causes a visible cutover failure rather than an invented count.

`deleteHandoffAfterReading` is a boolean, default `true`, exposed as **Delete handoff after reading**. It instructs the receiver to delete the exact handoff file only after successful complete ingestion (§10). When `false`, the receiver leaves the file unchanged at its current path; there is no archive move. `prepareWhileWaiting` is a boolean, default `false`, exposed as **Prepare while waiting**. It enables optional pre-GO retrieval and drafting (§7), not a different initiation path or a guaranteed speed improvement. Both settings apply immediately without reload.

Retry delays are integer seconds from `1` through `300`. `writerAttempts` is a positive integer and means total attempts including the first.

`recoveryDirectory` and an optional `templateDirectory` are absolute directory paths. `callTemplate` and `handoffTemplate` are `.cmpl` filenames, not paths. A directory setting must resolve to a directory; when it does not exist, the config dialog asks whether `save` may create it. Deliberate directory symlinks are valid.

### Configuration dialog

`/sh settings` starts an extension-owned overlay dialog in the terminal UI. It shows the available settings and their current persisted values. The user chooses one setting, answers the value question, and returns to the setting list. This may repeat in any order. Template settings normally present the available readable, nonempty role-specific templates as a selection: Call Templates use the `call_` prefix and dossier templates use the `handoff_` prefix. An explicit manual-entry option remains available for another `.cmpl` filename.

Each confirmed edit is validated against the complete resulting configuration and atomically persisted immediately. The running extension applies the persisted configuration immediately; it does not require `/reload`. Invalid input, rejected directory creation, or persistence failure leaves the previous value active and shows a concrete message with a useful correction hint. A missing configured directory is created only after the user confirms its exact path.

There is no overall draft, Save action, or Cancel action. Escape discards only an unconfirmed setting input; Escape from the setting list closes the dialog without rolling back prior edits. Configuration cannot overlap an active handoff or recovery dialog, and a handoff cannot start while configuration is open. Dialog questions and answers do not enter model context. `/reload` or session replacement closes the dialog without affecting changes already persisted.

## 5. Managed templates and catalogue

The package ships exactly two templates:

- `call_default.cmpl` defines a readiness-only phase and the genuinely safe transfer boundary, finishing only required work already in flight and preferring direct GO unless a concrete active user interaction still matters. It prohibits handoff writing during readiness unless the extension explicitly enables Prepare while waiting. After GO the model waits for the writer/finalization instruction; a previously retrieved template is not resent. GO confirms only the safe boundary; DONE is submitted separately after file finalization.
- `handoff_default.cmpl` instructs writing the supplied file and submitting only its correlated ID, while retaining the V2 continuation dossier structure: explicit working mode, commissioned work, continuing grants and conditions, current state, binding decisions, active skills, evidence limits and targeted retrieval.

The package has no Fast, Balanced or development template variants. Custom managed and addendum templates remain supported; loading the package does not delete other user-owned templates or rewrite existing selections.

On load, each of the two package assets is compared with its same-name file in the managed template directory:

- equal content: do not write;
- missing managed file: install the package file;
- different content: move the managed file into the managed `backups/` subdirectory as `<filename>.backup-<UTC timestamp>`, then install the package file.

The timestamp uses filesystem-safe UTC with millisecond precision. Catalogue scans do not recurse into `backups/`, and backups do not end in `.cmpl` or appear in template selection. Backups are not automatically deleted. Other managed templates are preserved.

Catalogue scans are nonrecursive. An optional configured addendum directory may shadow a managed template with the same filename. Call and dossier templates have separate configuration fields but share the same resolver. Each resolution uses:

1. the selected filename from the addendum directory when configured and present, otherwise the selected filename from the managed directory;
2. the role-specific addendum default (`call_default.cmpl` or `handoff_default.cmpl`), when configured;
3. the corresponding managed role-specific default.

Each physical candidate path is attempted at most once. A valid template is a readable, nonempty `.cmpl` file. Every failed candidate is reported. There is no placeholder engine, embedded TypeScript template, or fourth fallback.

Both configured roles are health-checked during extension startup and whenever `/sh settings` opens. If a non-default selection is missing, unreadable, or empty, the role default is used and a visible warning identifies the failed candidate and actual fallback. Selecting the role default does not itself produce a warning. If the role default cannot resolve, startup or configuration opening fails visibly instead of continuing with pretend template content.

Exact older configurations lacking `deleteHandoffAfterReading` gain `true` in memory; those lacking `prepareWhileWaiting` gain `false`. Those lacking `maxSessionChainLength` gain `25`, and those lacking `callTemplate` gain `call_default.cmpl`. This intentional configuration compatibility does not automatically rewrite the persisted file; other missing or unsupported settings remain invalid. The replaced unreleased names `debugging` and `speedMode` are not supported aliases or migration inputs.

### Project-template assignments

Project-template assignments are stored separately from global settings in `<getAgentDir()>/pi-blitz-handoff/project-templates.json`. The file is a JSON object keyed by normalized absolute directory. Every value contains exactly:

```json
{
  "callTemplate": "call_example.cmpl",
  "handoffTemplate": null
}
```

Both role keys are always present, and at least one contains a concrete role-prefixed `.cmpl` filename. `null` is displayed as `<Autodiscover>` and means that the exact directory has no local override for that role. A stored `null`/`null` pair is invalid because the dialog represents that state by removing the entry. Missing files represent no project assignments.

`/sh project-template` uses `ctx.cwd` as the assignment root without asking for a path. It presents separate extension-owned role selections. Each contains `<Autodiscover>`, `<Default>`, and the readable, nonempty role-specific catalogue; the concrete default filename is omitted from the catalogue when `<Default>` already represents it. `<Default>` stores the existing role-default filename. Each Enter atomically persists that role immediately, with the other role initially `<Autodiscover>` when no exact assignment exists. Escape discards only the currently unconfirmed selection; it does not undo an earlier confirmed role. There is no Save action. Selecting `<Autodiscover>` for both roles uses the exact-entry removal path and preserves the factual existing-assignment versus no-assignment messages.

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

The extension creates one unpredictable correlation key and sends one resolved Call Template. The editable Call Template owns the semantic work-boundary and working-style guidance. Deterministic code appends the exact correlated tool protocol, non-configurable interaction constraints and, only when enabled, optional preparation instructions for Prepare while waiting; editable template prose does not own correlation, tool availability, user-choice mechanics, timers, or state invariants.

The default Call Template guides the current model to finish only required work already in flight before the genuinely safe transfer boundary. With Prepare while waiting disabled, readiness is not handoff preparation: the default instructs the model not to write a handoff or create a continuation file. With Prepare while waiting enabled, preparation is optional and must not delay required in-flight work. In both modes the model waits after GO for the explicit writer/finalization instruction. These are model instructions, not a deterministic filesystem write block. A custom Call Template may define a different working style without deterministic code appending a second work-boundary policy. Automatic handoffs still permit only direct GO because user deferral would stop the autonomous run.

Two correlated readiness tools exist:

- `session_handoff_go({ key })` accepts direct GO for every initiation source;
- `session_handoff_go_with_user_deferral({ key, reason })` is available only for manual and model-requested handoffs. It supplies a short concrete reason and opens an extension-owned **Ready / Wait / Cancel** selection. An automatic attempt rejects this entry point before opening UI.

The extension does not parse free-form user text or build a working-style detector. The deferral selection resolves deterministically:

- **Ready** accepts GO;
- **Wait** keeps ordinary input normal, suspends the reminder for this handoff, and adds the status line `Awaiting User GO · Tell your LLM to start when ready`;
- **Cancel** ends the handoff.

After **Wait**, no timer or dialog runs automatically. A later ordinary user message may explicitly indicate readiness; the model then calls direct GO with the same key. The extension does not parse that message.

After the initial instruction, one timer is scheduled for `readinessRetrySeconds`. If the permitted tool has not resolved readiness when it fires, one short visible reminder triggers a model turn. The reminder reapplies the same resolved Call Template, then appends only the source-specific correlated tool protocol: explicit attempts retain both choices, while automatic attempts permit only direct GO. If the model calls no readiness tool, it produces no normal text. This one-shot reminder prevents deadlock when background work finishes without otherwise producing a new turn. There is no periodic polling.

### Prepare while waiting

When `prepareWhileWaiting: true`, readiness instructions and reminders additionally explain `session_handoff_get_template({ key })`. This continuing retrieval tool accepts only the current pre-GO readiness key. It returns the resolved Handoff Template, absolute reserved handoff-file path and correlated submission ID. It accepts neither GO nor DONE. Disabled, stale and post-GO requests fail visibly. The tool is inactive when Prepare while waiting is disabled and its availability refreshes immediately when that setting changes.

The model may retrieve and draft while genuinely waiting, using its existing native file tools; preparation does not change the source tool list. It must not delay required work or call GET and GO concurrently. Repeated or concurrent retrieval shares the same preparation, template snapshot, ID and file. Cancellation invalidates that preparation. If retrieval is skipped or GET is aborted before returning its result, the writer receives a freshly resolved template normally after GO. A reservation made by an aborted GET is reused rather than causing a same-name collision. Suppression applies only once GET has returned successfully; this tracks local tool execution, not proof of model comprehension. There is no artificial waiting phase and no guaranteed acceleration; the separate GO/DONE calls and model turns are an accepted trade-off.

Before accepted GO, interactive and RPC input passes unchanged and is not deferred. Slash commands retain Pi's native command behavior because Pi dispatches them before the `input` event.

## 8. GO boundary and deferred prompts

Accepted direct GO or **Ready** from the user-deferral selection confirms only a safe work boundary and starts the deferred-prompt window immediately. GO never triggers session replacement or asserts dossier completeness. The writer starts only after the answering tool run reaches an idle `agent_settled` boundary with no pending message.

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

After GO, the extension saves the active Pi tool list once and enables only native `read`, `write`, `edit` and `submit_session_handoff`. A missing native `write` tool fails visibly. It sends the writer/finalization prompt to the source model after the existing idle, no-pending-message settled boundary.

Without early preparation, each attempt resolves the effective template afresh; the prompt contains that template, exact submission ID, source-session transcript path and absolute handoff-file path. The first attempt reserves the file; retries reuse that path and instruct replacing partial content. With early preparation, the writer adopts its existing file and template snapshot; the first attempt also uses its prepared ID. No attempt resends that template: a short finalization instruction supplies the path and current ID. Later attempts use fresh IDs but the same prepared template snapshot and file.

The source writes or updates the complete dossier with native file tools. Before DONE it must update all relevant results, facts, permissions and the precise next action; factual and semantic completeness is explicitly the model's responsibility. Extension-owned writer control limits only this writer turn and requires exactly one submission. It is not a user instruction or continuation constraint and must not be preserved in the handoff.

`submit_session_handoff({ id })` is the separate **DONE** signal. Its schema accepts only the exact current submission ID, never dossier content or a path. Submissions are accepted only during post-GO writing; pre-GO, stale or duplicate submissions fail. DONE plus the existing idle, no-pending-message settled boundary triggers the native transition. No semantic review layer is added. Before cutover, the extension checks file metadata, not Markdown, title meaning, NUL absence or dossier completeness; there is no product-specific byte cap.

The template instructs the model to begin the file with a concise, meaningful, task-specific Markdown title and then continue with the dossier. That title is inside the file, not the replacement's initial prompt, so it is not automatically its session-navigation name. No generic handoff-status prefix may precede it. There is no separate session-name field, parser, sanitizer, or second title channel. Title and dossier structure are writer instructions, not claims of deterministic semantic validation.

The dossier distinguishes completed and verified work, completed but unverified work, partial or reverted work, authorized work, work requiring fresh approval, blockers, open questions, working files, evidence, prior decisions, and precise cold-context references. It must not turn discussion, criticism, rejected proposals, or unanswered questions into authorization.

The V2 default Handoff Template places `Working mode` immediately after the meaningful title, using the actual pre-writer continuation mode, `userfacing` or `autonom`. Neither automatic initiation nor the writer turn establishes autonomous work or grants permission.

The dossier then separates `Historical context` from `Positive context` in the same handoff file. Historical context is one short reference-only paragraph: topic/task label — actual session ID — known entry point. A transcript starting line is included only when actually established; otherwise another known entry point is used or the entry point is marked unknown. The writer uses known references rather than scanning ancestor sessions to build an inventory. No separate history file or historical narrative is produced. The paragraph explicitly instructs the receiver to load referenced session history only for a concrete unresolved fact or discrepancy that positive context or a known governing/detail source cannot answer; otherwise it stays unloaded.

Positive context means everything still relevant to continuation, including constraints, active skills and uncertainty, regardless of age. Current consequences of completed work remain under state or evidence; the past itself is compressed into the historical index. Its subsections are:

1. `Work and assignment` — confirmed goal, future already commissioned work and one precise open step.
2. `Permissions and boundaries` — continuing grants with provenance and remaining coverage, authorized access/elevation, material conditions and separate gates. Completed individual actions are not reactivated; undertaking-wide grants are not consumed merely by finishing one step.
3. `Current work state` — relevant file/system state, dirty or unintegrated work, actual running work and currently effective blockers.
4. `Binding instructions` — decisions, genuine governing sources and active skills as name, purpose and scope. No cumulative read inventory, skill-path field or blanket reload list; selected frozen authority stays bound through its actual plan/source reference.
5. `Evidence and uncertainty` — observed facts, checked state/result/limits and unresolved or unread frontiers. Later edits do not inherit an earlier PASS.
6. `Targeted retrieval` — current-work detail sources, what they contain and the concrete occasion for reading them. Historical session references belong solely in `Historical context`.

The continuation core stays inline in positive context: current permissions and their material conditions, decisive known facts and the actual work state cannot be replaced by references. Unambiguous known governing sources may carry detail. Each fact has one primary place; no length quota replaces completeness. Empty or inapplicable optional fields are omitted. Discussion and ideas are not future commissioned work.

The recorded open step incorporates the receiving-session instruction once. Apply Deferred Prompts as separate sequential inputs before the recorded action; later prompts may supersede it. Restore only authorities and active skills required by applicable instructions and their contracts. Do not start with a previous-session recap. In `userfacing` mode resume the current dialogue, answer or question. In `autonom` mode actually perform the authorized next work in the first response. Ask only a concrete blocking question when a real missing decision, permission or blocker prevents continuation; do not re-request a still-valid grant.

The historical index and positive-context split are semantic writer/receiver instructions, not deterministic output, retrieval or restoration guarantees. The extension does not parse or verify topic coverage, session references, entry points or historical compression.

The original Pi tool list is restored after success, cancellation, exhaustion, and any terminal writer failure.

If an attempt settles without a valid submission, the next attempt starts after `writerRetryDelaySeconds`, up to `writerAttempts` total attempts. The configured values alone control count and delay. No writer retry command exists.

After exhaustion the handoff stops visibly. Any deferred-prompt recovery file remains for `/sh recover`.

## 10. File transport and native replacement

After a valid writer submission and its settled boundary, no further model call is used to assemble the transition prompt. The extension invokes its private correlated transition command to obtain the command context required by Pi's native replacement API.

The source model writes the handoff to a reserved owner-only file under the current Pi working directory:

```text
.pi/handoff_SESSID.md
```

`SESSID` is the native source-session ID; there is no timestamp or additional subdirectory. Exclusive reservation creates a new file and fails visibly on a same-name collision rather than overwriting an existing file. A file left by a cancelled, failed or retained handoff prevents another reservation for that same source session until it is explicitly removed; retries within one active writer reuse its reserved path. The extension does not read, parse or retransmit the dossier. Before native cutover it opens the existing file without creating a missing one and checks that it is a nonempty regular file. It then appends its latest deferred-prompt snapshot synchronously, without a new asynchronous input gap before `newSession()`.

When deferred prompts exist, the extension appends this section to the handoff file:

```markdown
## Deferred Prompts
```

It then appends each unchanged prompt in original order with deterministic boundaries. The section tells the replacement model to treat the entries semantically as separate sequential user inputs after the dossier, so later deferred prompts may update or supersede earlier context. When no deferred prompt exists, the handoff is not given an empty deferred section.

The private correlated transition command normally calls `ctx.newSession({ parentSession: sourceSessionPath })`. When the source chain is at or above `maxSessionChainLength`, it omits `parentSession` and creates an independent master instead. The same file reference is sent in either case; there is no model-authored transition command.

A short first user prompt starts the replacement model with the absolute file path and receiver instructions, not the complete dossier. The receiver follows normal startup instructions and necessary basic skills, then reads the entire file, continuing until the end if a tool truncates output. Only after successful complete ingestion it performs the configured exact cleanup:

- `deleteHandoffAfterReading: true` (default): delete that exact file;
- `deleteHandoffAfterReading: false`: leave that exact file unchanged at its current path.

If reading fails or is incomplete, leave the file unchanged and report the blocker. Cleanup failures must be reported. Ingestion and post-read deletion or retention are LLM instructions, not extension-executed or verified behavior. No archive is created or used. Handoff files are plaintext and should be excluded from version control/publication by local project policy. The extension does not edit Git ignore policy.

The selected Handoff Template determines continuation behavior. The V2 default handles deferred prompts before the recorded action, resumes the actual mode without a previous-session recap and performs authorized autonomous continuation rather than only announcing it.

After the replacement session has accepted that prompt through its native replacement context and the session transition has succeeded, the corresponding deferred-prompt recovery file is deleted. That completes the handoff. `/sh recover` therefore lists only files left by interrupted, cancelled, or failed handoffs.

Persisted source transcripts remain available for targeted retrieval by the session IDs in the historical index. Native parent-session lineage additionally links the source unless this handoff starts an independent master at the chain limit. Native file-tool calls and results follow Pi's normal source and receiver session persistence; the submission tool log contains the ID, not a dossier payload.

## 11. Cancellation and lifecycle

Before GO, canonical `/sh cancel` clears the pending request, correlation key, timer, user-wait state and cached optional preparation. In-flight preparation cannot reserve a file after invalidation.

After GO and before native replacement starts, `/sh cancel` stops extension-owned writer work, restores the original tools, and leaves any deferred-prompt recovery file untouched for `/sh recover`. Every successful cancellation sends a visible follow-up instruction that tells the model to disregard the earlier readiness or writer request and submission ID, resume normal conversation and task work, and not submit a handoff. Once `ctx.newSession()` has been invoked, the cutover is committed and is no longer cancellable. Deferred prompts are not automatically replayed to the source session.

Before GO, user session navigation may discard the pending handoff. From GO until completion or cancellation, user-initiated session replacement, fork, and compaction are blocked because they would invalidate the active transfer. The extension's own native replacement is allowed.

Late readiness answers, submissions, timers, and callbacks belonging to an invalidated handoff do nothing.

A potential race between a still-pending asynchronous start and cancellation or shutdown is unreproduced in normal operation. A reproducible issue or PR with a minimal reproduction is welcome; speculative lifecycle-token machinery is not part of the product.

A reload or process interruption may end the active in-memory handoff. It does not auto-resume or auto-replay work. A deferred-prompt recovery file remains available. Reserved files may remain empty or partial after cancellation, failure or interruption; there is no automatic leftover-file execution or removal. Model file-tool calls and results follow Pi's normal session persistence.

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

The active widget advertises canonical `/sh cancel`. After **Wait**, the normal first activity line remains and a second width-safe line reads `Awaiting User GO · Tell your LLM to start when ready`.

Failure and cancellation override those states. A successful final status adds a second line with `Wait Time`, measured from initiation to accepted `GO`, and `Handoff Time`, measured from `GO` to successful completion. After `GO`, the persistent activity line shows `Inputs deferred (0)` and increments that factual count for every captured prompt. Concrete attempt information may appear in factual chat or tool status, but the persistent indicator does not invent fractional or numbered progress.

All product-facing messages, dialogs, templates, and documentation use clear English.

Failures are visible and concrete. A terminal failure restores tools, invalidates active IDs and timers, stops automatic continuation of that run, and reports whether a recovery file remains.

Cleanup failure is reported with the affected path. It does not roll back a replacement session that already succeeded.

## 14. Validation

Automated tests cover the actual deterministic contracts:

- configuration validation, immediate per-setting atomic persistence, runtime refresh, and failure retention;
- synchronization of the two shipped defaults, backup, custom-template catalogue, and fallback;
- project-template validation, per-role immediate persistence, atomic create/edit/removal, independent upward lookup, `<Autodiscover>` inheritance, `<Default>` overrides, and corrupt-file role-default fallback;
- explicit versus automatic initiation, including automatic rejection of user deferral;
- one-instruction readiness, exact keyed tool correlation, explicit-attempt user-deferral choices, source-specific one-shot reminders, and normal pre-GO input;
- the V2 default template structure and continuation instructions, writer prompt, tool isolation/restoration, submission validation, and configured attempts;
- optional Prepare while waiting retrieval, shared preparation, GO/DONE separation, prepared finalization without template retransmission and cancellation;
- real local-file reservation, collision failure, metadata-only validation, deferred-prompt ordering/append and one recovery file;
- receiver startup, complete-ingestion and configured post-read deletion/retention instructions (text contracts, not verified receiver execution);
- direct native replacement, parent-session lineage inputs, configurable chain limits including the master, parentless cutover with unchanged prompts, and persisted-lineage counting across resume/reload;
- cancellation and stale-callback invalidation;
- per-file recovery inspection, execution, discard, and delete-after-acceptance;
- public commands, native argument completion, menu start/cancel dispatch, public tool, and factual status;
- genuine overlay rendering and keyboard behavior, narrow widths, scrolling, resize/theme invalidation, input focus, dismissal, and dialog lifecycle without model-context leakage.

Tests use focused adapters and pure helpers where needed. They do not implement a second fake Pi runtime. Development and deterministic validation track current Pi 1.x using updateable `^1.2.0` dependencies, with Pi-provided packages declared as native wildcard peers rather than bundled runtime copies. Test doubles follow current `AgentSettledEvent` (`aborted`) and `ExtensionToolContext` contracts. This dependency alignment does not change the approved runtime minimum or handoff lifecycle; it is not real-model/session validation.

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

The product excludes:
- a public transition command or a parallel replacement mechanism beyond the one private bridge required by Pi's command-only session API;
- periodic readiness polling;
- deterministic free-form user-text parsing or a working-style detection engine;
- a separate session-name field;
- reading, parsing or retransmitting the dossier in extension code;
- deterministic semantic validation or verified receiver ingestion/cleanup;
- guaranteed acceleration or an artificial preparation waiting phase;
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

This document is the current product authority, including approved keyed readiness, unified overlay dialogs, file transport and optional Prepare while waiting with separate GO/DONE.

Git history, previous plan text, and previous implementation code are not product authority and must not be used as implementation context. Workers may report a concrete gap but must not edit or reinterpret this specification. The orchestrator may approve a small implementation detail when it is clearly implied by the approved concept and does not materially change public behavior, UX, authorization, security, data lifecycle, or scope. Material changes, uncertainty, and genuine product decisions go to the user. Contradictory proposals are rejected rather than incorporated.
