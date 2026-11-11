# pi-blitz-handoff Product Specification

Agent reference: [meaning-equivalent derivative](llm/specification.md). This human original remains the product authority.

> **Current approved product authority.**
>
> This specification incorporates the approved template-to-Finish lifecycle, configurable input deferral, unified overlay dialogs and native file-based handoff. Material product, UX, authorization, security, or scope changes require a new explicit user decision; small implementation details clearly implied by the approved concept may be resolved by the orchestrator.

## 1. Purpose

This extension is designed for one purpose: to capture a session’s continuation context more precisely than compaction and make it available to a fresh, natively linked Pi session through a local handoff file referenced by its first prompt. How work continues is determined by the user’s existing instructions, workflow, and templates.

Automatic handoff describes only how transfer is triggered; it does not select or authorize the replacement session's working mode. Autonomous execution, interactive clarification, answering, research, and waiting are transferred continuation modes rather than extension-owned workflows.

The handoff is a self-contained continuation dossier, not a short summary. It preserves the existing instructions, next action, and authorization boundaries: continuation context is not a new request and grants no new permission.

The implementation must use Pi's native lifecycle, session, tool-execution and UI APIs. It must not simulate a replacement session or build a parallel scheduler around Pi. All core functions must work with Handoff as the only installed extension. Other extensions and personal agent configuration are not product prerequisites; optional integrations must remain optional.

## 2. Supported environment

- Pi v1.5.0 or later.
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

In Pi's terminal UI, the main menu, global settings, project-template selection, recovery (including complete prompt inspection), help use genuine native `ctx.ui.custom()` overlays. They share a compact, polished presentation: theme-aware borders and semantic colors, clear headings and descriptions, factual status where relevant, and visible keyboard hints. Use Pi's native components for selection, text input and scrolling; do not implement a second terminal renderer. Overlay-owned actions and their keyboard hints must use the injected native keybindings manager, respecting configured bindings rather than hard-coded defaults. Layout must remain usable at narrow terminal sizes, during resize and after theme changes.

The first menu action is **Start handoff** when no handoff is active and **Cancel handoff** when a handoff is active. Remaining actions are recovery, settings, project templates and help. Opening or dismissing the main menu has no start/cancel side effect; selecting its primary action invokes the same real implementation as the corresponding direct subcommand. Pi's configured cancel action closes the main menu without action (Escape by default). All direct subcommands remain available.

This is a presentation overhaul, not a lifecycle or storage redesign. Dialogs preserve the lifecycle contracts defined below: template/Finish correlation, cancellation, automatic initiation, configured deferral, template resolution, immediate per-edit persistence and observed-turn recovery deletion. Dialog input never enters model context. Existing non-TUI/RPC support deliberately retains Pi's native select/input/confirm dialogs where custom terminal overlays are unsupported; those interactions are not presented as overlays. No simulated overlay, alternate runtime or compatibility alias is introduced.

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
  "deferPromptsFrom": "writing",
  "automaticSessionHandoffPercent": 70,
  "readinessRetrySeconds": 60,
  "maxSessionChainLength": 25,
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

`deleteHandoffAfterReading` is a boolean, default `true`, exposed as **Delete handoff after reading**. It instructs the receiver to delete the exact handoff file only after successful complete ingestion (§10). When `false`, the receiver leaves the file unchanged at its current path; there is no archive move. `deferPromptsFrom` is `request` or `writing`, default `writing`, exposed as **Defer prompts from** with choices **Request** and **Writing (template retrieved)**. Successful template retrieval is the writing boundary, including early preparation. Changes affect the next request; an active handoff retains its chosen mode. Settings apply without reload. `readinessRetrySeconds` remains an integer from `1` through `300`, the single handoff-reminder delay.

`recoveryDirectory` and an optional `templateDirectory` are absolute directory paths. `callTemplate` and `handoffTemplate` are `.cmpl` filenames, not paths. A directory setting must resolve to a directory; when it does not exist, the config dialog asks whether `save` may create it. Deliberate directory symlinks are valid.

### Configuration dialog

`/sh settings` starts an extension-owned overlay dialog in the terminal UI. It shows the available settings and their current persisted values. The user chooses one setting, answers the value question, and returns to the setting list. This may repeat in any order. Template settings normally present the available readable, nonempty role-specific templates as a selection: Call Templates use the `call_` prefix and dossier templates use the `handoff_` prefix. An explicit manual-entry option remains available for another `.cmpl` filename.

Each confirmed edit is validated against the complete resulting configuration and atomically persisted immediately. The running extension applies the persisted configuration immediately; it does not require `/reload`. Invalid input, rejected directory creation, or persistence failure leaves the previous value active and shows a concrete message with a useful correction hint. A missing configured directory is created only after the user confirms its exact path.

There is no overall draft, Save action, or Cancel action. Escape discards only an unconfirmed setting input; Escape from the setting list closes the dialog without rolling back prior edits. Configuration cannot overlap an active handoff or recovery dialog, and a handoff cannot start while configuration is open. Dialog questions and answers do not enter model context. `/reload` or session replacement closes the dialog without affecting changes already persisted.

## 5. Managed templates and catalogue

The package ships exactly two templates:

- `call_default.cmpl` requests transfer at the next safe checkpoint, explains tightly coupled versus independent work, and directs template retrieval before writing followed by Finish with the returned ID. It contains no transport path or Finish ID and introduces no separate GO/writer round.
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

The previous supported saved-config shape is normalized in memory: retire `prepareWhileWaiting`, `writerAttempts` and `writerRetryDelaySeconds`, and default missing `deferPromptsFrom` to `writing`. Existing recognized omissions still receive `deleteHandoffAfterReading: true`, `maxSessionChainLength: 25` and `callTemplate: call_default.cmpl`. Validate retained values and recognized retired values before normalization; unknown keys and invalid shapes remain errors. Loading does not rewrite personal configuration. An explicit settings save writes only the new supported schema. This bounded schema upgrade preserves existing installations, not old GO/runtime behavior. `debugging` and `speedMode` remain unsupported.

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

The warning percentage produces one advisory warning. At and above the critical percentage, a critical warning may be repeated after settled turns. These are UI notifications, not model instructions. The separate fixed 90% emergency limit below escalates an already requested handoff in model context.

When automatic handoff is enabled, the extension checks context usage at each `turn_end` whose native outcome is `completed`. Error and aborted turns do not initiate an automatic attempt, consume its budget, or escalate readiness. At the first boundary at or above the configured automatic percentage, it records the automatic request and inserts readiness before the next model turn without interrupting the completed turn's tool work.

If that first automatic handoff ends without successful replacement, one final automatic attempt becomes eligible at or above `criticalWarningPercent`. It starts at the next completed turn boundary, including when the critical percentage was already exceeded before the first attempt ended. A second unsuccessful automatic attempt is not repeated. The accepted-attempt count is stored as native session metadata and reconstructed after `/reload`, so reload cannot reset the two-attempt limit.

Every successful compaction resets the accepted-attempt count to zero, whether its reason is manual, threshold, or overflow. The reset is stored in the same native session metadata and survives `/reload`. Failed or aborted compaction does not reset the count. Manual and model-requested starts remain available and ignore all context percentages.

## 7. Request, template retrieval and Finish

The lifecycle is request → template retrieval → LLM-owned drafting → Finish. There is no separate GO, second writer prompt or Ready/Wait/Cancel selection. Canonical `/sh cancel` and menu cancellation remain.

Manual and model-requested instructions normally dispatch when the native agent is settled with no pending messages; an automatic request dispatches as steering at a completed turn boundary, preserving the existing initiation budget. If successful GET precedes that first dispatch, its response includes the pending selected Call Template once and starts the same one-shot reminder. This preserves the safe-checkpoint/custom instructions without creating a separate request or writer model round; repeated GET and later settlement must not send them again. The initial Call Template is compact English Caveman: transfer at the next safe checkpoint, not whole-task completion; finish only tightly coupled in-flight work necessary for safe transfer. Independent terminal/background work can continue and must not delay the handoff. Preserve how the receiver can check it; start no additional task work to postpone transfer.

The first instruction directs the model to `session_handoff_get_template({})`. It contains neither the transport path nor Finish/submission ID. The tool is available for an active request, not behind a preparation option. Before retrieval, the model must not invent a path or write a handoff. The tool returns the resolved Handoff Template, exact reserved file path, source transcript locator and a fresh Finish correlation ID. That ID is not the native source-session ID or an earlier GO key. Repeated retrieval within the same active handoff shares its template snapshot, file and ID. A cancelled or superseded asynchronous retrieval cannot reserve a late file or return a live ID.

The model can retrieve early and prepare while reaching the safe checkpoint. It uses its existing tools: retrieval does not isolate tools, stop necessary source work, or introduce a dedicated writer model round. Native `write` must already be available; otherwise fail visibly. Refresh all consequential facts, results, permissions and next action before Finish. Semantic completeness and safe-checkpoint judgment belong to the model.

`session_handoff_finish({ id })` accepts only the exact ID returned by a successfully completed template call. It accepts neither dossier content nor a path. Reject missing-template, stale and duplicate Finish. A valid Finish marks the associated file ready; then the existing idle/no-pending settled boundary permits the private native transition. No automatic writer attempts, repeated template delivery, or retry model turns are added. The native batch termination hint is not proof that unrelated work has settled.

GET and Finish use native `executionMode: "sequential"`; direct exposure remains unchanged. Do not parse ordinary user prose into lifecycle decisions. One visible reminder after `readinessRetrySeconds` may prompt completing the current template/Finish flow; it is one-shot, not polling, and must not regenerate IDs, files or templates.

### 90% emergency limit

For an already requested handoff, the first completed turn at at least 90% context use sends one native steering instruction to stop source-task work, fetch the template if still missing, finalize the supplied file and submit Finish. Do not wait for independent terminals/subagents or gather more source-task context. If the selected Call Template has not yet been delivered, include it once in that same emergency instruction. The emergency stop/no-extra-context instructions override conflicting Call Template waiting guidance. Neither later template retrieval nor settlement repeats the Call or starts a reminder. Cancel the ordinary reminder. Preserve the active request/file/ID rather than starting another attempt. Disabled automatic initiation stays disabled when no request exists.

This remains an urgent model instruction, not forced abort, model-compliance proof or guaranteed remaining context reserve. A cancelled or already submitted handoff is not escalated.

## 8. Deferred prompts

`deferPromptsFrom` determines when subsequent ordinary interactive/RPC input is captured:
- `request`: immediately after a handoff request is accepted.
- `writing` (default): when template retrieval successfully returns, including early retrieval/preparation. Before that boundary input remains normal.

The selected mode is fixed for the active request. No first-filesystem-write detector is used. Failed or aborted retrieval does not start `writing` deferral; it does not authorize Finish. A reserved file from an aborted call may be reused by the next retrieval, never overwritten as a foreign collision.

During deferral, extension-owned inputs pass through. Ordinary prompt strings are retained unchanged, in order, with boundaries; they do not enter source task/drafting context. Slash commands keep native dispatch behavior. Until replacement begins, keep the latest snapshot and visibly show capture status; add no second delivery protocol for theoretical cutover races.

In-memory prompts are the runtime source. Maintain one atomic Markdown recovery file per handoff window, not per prompt, named `<filesystem-safe UTC timestamp>-<normalized source session ID>.md` in the configured recovery directory. Timestamp has millisecond precision; normalized session component contains only letters, digits and hyphens. The file preserves every prompt with extension-owned `--- Deferred Prompt N of M ---` boundaries. Do not parse, classify, summarize or rewrite prompt contents. No captured input means no recovery file.

## 9. Dossier

The template response supplies the exact file and Finish ID together with the template; no later GO/writer round resends it. The source writes and updates the complete dossier there through native file tools, then submits Finish once at the safe checkpoint. Finish carries only its ID. Code validates correlation and file metadata, not dossier facts, Markdown, NUL absence or semantic completeness; no arbitrary byte cap or separate title channel.

The accepted English Caveman template gives instructions, not a new dossier-language restriction: dossiers use the user's conversation language. Begin with a concise task-specific Markdown title, then actual continuation mode `userfacing` or `autonom`. Neither automatic initiation nor permission alone establishes autonomy. Do not transfer extension-owned writing controls as user instructions.

Retain a short historical reference paragraph (topic, actual session ID, known entry point; line number only when established). Do not scan ancestor sessions for an inventory or create a separate history file. Instruct the receiver to retrieve history only for a concrete unresolved fact/discrepancy unavailable from positive context or current authorities.

Positive context carries still-relevant consequences, not chronology:
1. Work/assignment: confirmed goal, remaining commissioned work/order/dependencies, exact next action or current dialogue unit/question count.
2. Permissions/boundaries: provenance, scope, target, routes/elevation, continuing grants, material conditions and separate gates. Inline current permission; no vague reference substitutes or renewed approval for already-covered necessary steps.
3. Current state: consequential dirty/staged/uncommitted/unintegrated/partial/failed/reverted state and actual running work with identity/owner/status. Unknown stays unknown.
4. Binding instructions: decisions, responsible precise sources/frozen authority, active skills as name/purpose/scope. No skill-path list, read inventory or blanket reload mandate; past reading/availability is not activation.
5. Evidence/uncertainty: actual candidate/checks/results/limits, observed versus inferred facts, missing verification and precise unread frontiers. Later edits inherit no PASS.
6. Targeted retrieval: other exact current-work sources, contents and concrete retrieval reason. Historical sessions stay in the historical paragraph.

One primary place per fact; omit empty fields, never necessary conditions. No secret values, invented facts or semantic authorization guarantees. Include receiver continuation once with the next step: apply Deferred Prompts separately and in order before that action, later prompts may supersede it; restore only applicable authorities/active skills, no recap; resume actual userfacing dialogue or perform authorized autonomous work, asking only a genuine blocking question. Neither mode grants permission.

Existing source tools remain unchanged throughout this lifecycle; no isolated writer loadout or persistent tool snapshot is introduced. Cancellation and terminal failure must leave the user's exact tool selection intact.

## 10. File transport and native replacement

After valid Finish and its settled boundary, no further model call is used to assemble the transition prompt. The extension invokes its private correlated transition command to obtain the command context required by Pi's native replacement API.

The source model writes the handoff to a reserved owner-only file under the current Pi working directory:

```text
.pi/handoff_SESSID.md
```

`SESSID` is the native source-session ID; there is no timestamp or additional subdirectory. Exclusive reservation creates a new file and fails visibly on a same-name collision rather than overwriting an existing file. A file left by a failed, interrupted or retained handoff, or by a failed cancellation cleanup, prevents another reservation for that same source session until it is explicitly removed; repeated retrieval within one active handoff reuses its reserved path. The extension does not read, parse or retransmit the dossier. Before native cutover it opens the existing file without creating a missing one and checks that it is a nonempty regular file. It then appends its latest deferred-prompt snapshot synchronously, without a new asynchronous input gap before `newSession()`.

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

The handoff completes at the successful return of the concrete recipient turn in which the bootstrap prompt was delivered, which need not be the first recipient turn. Correlate the extension-owned input to its actually emitted user message and owning native turn. Only that turn's `TurnEndEvent.outcome === "completed"` sets Finished and permits deletion of its associated deferred-prompt recovery file; successful completion also releases transfer protection. An established terminal failure releases protection without Finished. `aborted` or `error`, rejected dispatch and unobserved delivery retain the file and do not display Finished. A void send return or a later successful turn is not success. Native completed is authoritative, without an additional stop-reason or tool-error veto. This boundary proves neither semantic ingestion nor receiver cleanup, and must not await unrelated later recipient work. Keep existing no-`deliverAs` dispatch behavior; do not add a queue or retry policy. Fresh replacement context owns dispatch and the receiving runtime owns turn completion; late sender-promise settlement cannot overwrite an already observed turn result.

Persisted source transcripts remain available for targeted retrieval by the session IDs in the historical index. Native parent-session lineage additionally links the source unless this handoff starts an independent master at the chain limit. Native file-tool calls and results follow Pi's normal source and receiver session persistence; the submission tool log contains the ID, not a dossier payload.

## 11. Cancellation and lifecycle

Canonical `/sh cancel` and the menu invalidate the current request, template/Finish ID, reminder and in-flight retrieval immediately. No Ready/Wait/Cancel selection, pause mode or new Escape/response-abort meaning exists. Before native `newSession()` invocation, even after Finish, cancellation removes only the exact reservation owned by this runtime. The receiver's deletion setting does not govern abandoned attempts. Foreign collision files remain untouched; a missing owned file is harmless, other cleanup errors name the path.

Source tools are not isolated and source work may still be settling; cancellation must not abort unrelated source work. Retain reservation ownership through native write settlement, then remove the file. Command cancellation may await command-context `waitForIdle()`; event/tool paths must return first and finish at a native settled boundary, never await themselves. No new start or stale callback may reactivate the handoff during cleanup. Send the existing visible cancellation follow-up once after cleanup concludes; failures are reported without claiming clean success. Preserve deferred recovery files, never replay them automatically.

Once native `newSession()` is invoked, cutover is committed and cannot be cancelled. From the configured deferral boundary until terminal completion/cancellation, protect against user replacement, fork and compaction; also protect while Finish awaits transition. Cancellation cleanup additionally guards tree navigation and can block even before template retrieval. Before protection begins, navigation may discard a pending request.

Late cancelled/superseded template results, Finish calls, timers and callbacks cannot revive old work or reserve a new file. Reload or interruption may end in-memory state; no crash/exit restoration or automatic leftover execution/removal is added. Cleanup failure/interruption can leave an empty/partial reservation; recovery remains explicit.

## 12. Recovery

Recovery is explicit and file-based. The extension never automatically executes leftover prompts.

`/sh recover` lists every remaining handoff recovery file with its date. The user selects one file at a time and may:

- inspect its complete prompt contents;
- execute it;
- discard it;
- return to the file list or cancel recovery.

Recovery questions and answers are extension-owned and do not enter model context.

Executing a file sends all prompts from that file to the current session as one combined user turn, preserving their stored order and boundaries and instructing the model to treat them as separate sequential inputs. The file is deleted only after the concrete turn receiving that extension-owned recovery input returns native `TurnEndEvent.outcome === "completed"`. Correlation uses observed delivery, not an immediate void-send return or an unrelated turn. `aborted`, `error`, rejected or unobserved delivery retain the file; later success cannot heal a failed matched turn. Existing no-`deliverAs` semantics remain, so a busy target may reject dispatch without deletion. Do not add a stop-reason/tool-error veto, semantic ingestion acknowledgement, automatic queue, retry or replay.

Discarding deletes only the explicitly selected file. Inspecting never changes it. Unreadable files are reported and left untouched.

Recovery has no per-prompt selection, `pending`/`dispatching` states, checkpoint identity protocol, automatic replay, Outbox, or delivery-uncertain state machine.

## 13. Status and failures

The extension exposes concise factual status in chat and through `blitz_handoff status`. The persistent status surface distinguishes:

- yellow `Waiting for Session Handoff`;
- `Writing Session Handoff` with an indeterminate activity indicator;
- `Session Handoff Finished` in the replacement session until the next agent run starts, ordinary user input arrives, or another handoff begins.

The active widget advertises canonical `/sh cancel`. There is no Awaiting User GO or User Input Required handoff state. Successful template retrieval enters Writing; accepted Finish waits for native settled transition.

Failure and cancellation override those states. A successful final status adds a second line with `Wait Time`, measured from initiation to successful template retrieval, and `Handoff Time`, measured from template retrieval to successful recipient-turn completion. Whenever configured deferral is active, show `Inputs deferred (0)` and increment for every captured prompt, including Request mode before retrieval. Concrete attempt information may appear in factual chat or tool status, but the persistent indicator does not invent fractional or numbered progress.

Persistent status applies the current injected native theme during rendering and remains width-safe after theme changes without a status update. Durations are captured at the status update; theme invalidation or rendering does not advance them.

All product-facing messages, dialogs, templates, and documentation use clear English.

Failures are visible and concrete. A terminal failure preserves the user's existing tools, invalidates active IDs and timers, stops automatic continuation of that run, and reports whether a recovery file remains.

Cleanup failure is reported with the affected path. It does not roll back a replacement session that already succeeded.

## 14. Validation

Automated tests cover the actual deterministic contracts:

- configuration validation, immediate per-setting atomic persistence, runtime refresh, and failure retention;
- synchronization of the two shipped defaults, backup, custom-template catalogue, and fallback;
- project-template validation, per-role immediate persistence, atomic create/edit/removal, independent upward lookup, `<Autodiscover>` inheritance, `<Default>` overrides, and corrupt-file role-default fallback;
- explicit/automatic initiation, compact bounded request, one-shot reminder/emergency, absent GO/user-choice tools;
- mandatory template retrieval, no path/Finish ID before retrieval, stable repeated retrieval, cancellation/aborted-call invalidation, exact Finish correlation;
- configurable Request/Writing deferral including early successful versus failed/aborted template calls and one ordered recovery file;
- Caveman default instructions, full dossier/receiver semantics, unchanged source tools and no automatic writer/retry/template-resend round;
- real local-file reservation, collision failure, metadata-only validation, deferred-prompt ordering/append and one recovery file;
- receiver startup, complete-ingestion and configured post-read deletion/retention instructions (text contracts, not verified receiver execution);
- direct native replacement, parent-session lineage inputs, configurable chain limits including the master, parentless cutover with unchanged prompts, and persisted-lineage counting across resume/reload;
- cancellation and stale-callback invalidation;
- exact delivered-turn completion and recovery deletion, including later turn indices, independent receiver instances, unrelated/unsuccessful turns, rejected/unobserved delivery and late sender settlement;
- per-file recovery inspection, execution, discard, and delete-after-matching-completed-turn;
- cancellation cleanup after native write settlement without aborting unrelated source work, no tool/event self-deadlock, and unchanged exact tool selection;
- public commands, native argument completion, menu start/cancel dispatch, public tool, and factual status;
- genuine overlay rendering and keyboard behavior, narrow widths, scrolling, resize/theme invalidation, input focus, dismissal, and dialog lifecycle without model-context leakage.

Tests use focused adapters and pure helpers where needed. They do not implement a second fake Pi runtime. Pi-provided packages remain native wildcard peers rather than bundled runtime copies. The existing development dependency ranges are `^1.2.0`; their lockfile currently resolves Pi 1.2.0. These local checks alone do not establish compatibility with the supported Pi >=1.5.0 runtime. Validate the same candidate separately against the available Pi 1.5.0 host packages without representing older dependency checks as current-host evidence. Test doubles follow the current `TurnEndEvent` outcome, `AgentSettledEvent` (`aborted`) and `ExtensionToolContext` contracts. Validation must also check that core functions do not depend on another extension or personal agent configuration.

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

This document is the current product authority, including the approved request/template/Finish lifecycle, configurable deferral, unified overlays and native file transport.

Git history, previous plan text, and previous implementation code are not product authority and must not be used as implementation context. Workers may report a concrete gap but must not edit or reinterpret this specification. The orchestrator may approve a small implementation detail when it is clearly implied by the approved concept and does not materially change public behavior, UX, authorization, security, data lifecycle, or scope. Material changes, uncertainty, and genuine product decisions go to the user. Contradictory proposals are rejected rather than incorporated.
