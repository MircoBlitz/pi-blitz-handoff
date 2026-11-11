# pi-blitz-handoff — agent reference

- Source: [root README](../../README.md). Meaning-equivalent derivative, no independent authority. [Human specification](../specification.md) sole product authority; [agent specification](specification.md), [security](SECURITY.md), [changelog](CHANGELOG.md).
- Package2.0.0 GitHub release: source/tag/archive. Maintainer handles npm separately; GitHub release does not establish npm2.0.0 availability. Breaking protocol/settings changes; package version independent of supported Pi version. Implemented template-to-Finish; local checks + bounded nativePi1.5/model observations below, not blanket verification.
- Purpose: precise continuation dossier through local file to fresh native Pi session, normally parent-linked. Existing instructions/workflow/templates determine continuation. Automatic = trigger only; autonomous work, dialogue, clarification, answering, research, waiting all valid modes. Context grants no new permission.
- “Blitz” = author's surname, not speed claim. Not faster-than-compaction or lossless guarantee; dossier/continuation model-generated.
- V2 default: actual `userfacing`/`autonom`, commissioned work, continuing grants/conditions, dirty state/blockers/evidence; active skills name/purpose/scope, not past-read inventory. Inline continuation core; known detail sources only for concrete need. One short history paragraph with topics/session IDs/known entry points, starting lines only established. Load history only for concrete unresolved need; continuing consequences remain positive context. Deferred prompts first; resume actual dialogue/authorized autonomous action, no recap.
- [Source screenshots](../../README.md#successful-autonomous-handoff): historical pre-V2 autonomous run, replacement starts authorized action, validates state, dispatches authorized reviewer without another user prompt. Not current integration evidence.

## Requirements and installation

- Node.js >=22.19.0; `@earendil-works/pi-coding-agent` >=1.5.0; interactive chat; persisted source session; native `write`; writable cwd `.pi/`.
- Reject `--no-session`/in-memory source: no transcript path/native parent lineage.
- npm: `pi install npm:pi-blitz-handoff`.
- One run without global install: `pi -e npm:pi-blitz-handoff`.
- Git: `pi install git:github.com/MircoBlitz/pi-blitz-handoff`.
- Reference commands, not authorization to install. Pi entry point from `package.json`; review third-party extensions first. Extension has Pi process permissions.

## Public interface

| Command | Effect |
|---|---|
| `/sh` | Menu; opening does not initiate |
| `/sh start` | Request transfer |
| `/sh help` | Usage |
| `/sh cancel` | Cancel before native cutover invocation |
| `/sh recover` | Inspect/execute/discard deferred leftovers |
| `/sh settings` | Global settings, each edit immediate |
| `/sh project-template` | Current-cwd per-role selection/removal |

- Only `/sh` registered publicly; six described/filterable native subcommand completions after `/sh `. No former hyphenated aliases, `/sh config`, public retry/cleanup/transition.
- TUI: themed overlays for menu, setting inputs/directory confirmations, project templates, scrollable complete recovery inspection, Help. No Ready/Wait/Cancel choice. Native configured keybinding hints; cancel (Escape default) dismisses menu without action.
- Menu primary Start if inactive, Cancel if active; remaining Recovery, Settings, Project templates, Help. Direct commands remain. RPC native select/input/confirm, no simulated overlay. Dialog answers outside model context; overlays preserve lifecycle/persistence.
- `blitz_handoff status`: context use, warning/automatic thresholds, one-shot reminder delay, status.
- `blitz_handoff start`: explicit user request only; discussion/questions/criticism/testing/mentions ≠ request.

## Transfer sequence

1. Exactly three initiation routes: command/menu, explicit model `blitz_handoff start`, enabled automatic. Explicit ignores thresholds. One active request; second rejects without replacing state. Manual/model instructions normally dispatch at native idle/no pending messages; automatic steering at completed boundary. Early successful GET includes still-pending selected Call instruction once in its response and starts same one-shot reminder; no extra model round or later repeat.
2. Compact Call Template: next safe checkpoint, not whole-task completion. Finish only tightly coupled in-flight work necessary for safe transfer. Independent terminals/background jobs may continue; never wait on them or add work to postpone transfer. Initial request directs `session_handoff_get_template({})`, no transport path/Finish ID. No invented path/write before retrieval.
3. GET returns selected template, exact reserved file, source transcript locator, fresh Finish ID (not native session ID). Early retrieval/drafting allowed. Repeated active GET shares snapshot/path/ID, no second writer prompt. Native `write` must already exist; source tools unchanged, no isolation/persistent snapshot.
4. `deferPromptsFrom`: accepted request OR successful GET, default GET. Active mode fixed. Successful early GET starts Writing capture; failed/aborted GET neither starts Writing deferral nor authorizes Finish. Captured interactive/RPC prompts unchanged/ordered/separate, memory plus one atomic recovery file. Extension inputs pass through; slash commands native.
5. Refresh consequential facts/results/permissions/exact next action. Complete file + safe checkpoint: `session_handoff_finish({ id })` once, exact returned ID only, no content/path. Missing-template/stale/duplicate reject. GET/Finish sequential native tools. No GO, user-choice round, automatic writer retry or redundant template delivery. Model owns semantics/checkpoint; native batch termination hint does not prove unrelated work settled.
6. Valid Finish + idle/no-pending settlement permits private correlated command bridge to `ctx.newSession()`, no assembly model call. Metadata-only nonempty-regular-file check; never read dossier. Append latest deferred snapshot synchronously before cutover. Short first prompt: absolute path, startup/cleanup. Normally `parentSession`; chain limit independent master, unchanged file reference.
7. Receiver normal startup/basic skills; entire file read, continue past truncation. Complete successful ingestion only: configured exact deletion or unchanged retention. Failed/incomplete read leaves file, reports blocker. Finished/associated recovery deletion only concrete actually delivered bootstrap turn native `completed`, possibly later than first recipient turn. Error/abort/rejected/unobserved retain recovery. No stop-reason/tool-error veto/new queue/retry/later-work wait. Late sender settlement cannot overwrite observed recipient outcome. Turn completion proves neither ingestion nor receiver cleanup; report cleanup failures.

## Deferral, reminder and emergency

- Settings **Defer prompts from**: **Request** / **Writing (template retrieved)**, default Writing. Successful GET = observable writing boundary, not first-filesystem-write detector. Settings affect next request only.
- Aborted GET reservation may be reused; not successful retrieval. Cancelled/superseded async GET cannot reserve late file/return live ID.
- No captured input→no recovery file. Otherwise one file/window, `<filesystem-safe UTC timestamp>-<normalized source session ID>.md`; UTC milliseconds; session component letters/digits/hyphens. Strings never parsed/classified/summarized/rewritten; `--- Deferred Prompt N of M ---` boundaries. Keep latest snapshot/capture status until replacement; no second delivery protocol.
- One visible reminder after `readinessRetrySeconds`: complete current template/Finish flow. No regenerated IDs/files/templates, polling or retry model turns. No prose lifecycle parser.
- Fixed emergency: active requested/unsubmitted handoff, first completed turn >=90% context. One steering instruction stops source work/context gathering, fetches if missing, finalizes supplied file, Finish; no waiting on independent terminals/subagents. Cancel reminder, retain current request/file/ID, no new attempt. Cancelled/submitted not escalated.
- Emergency separate from warning/automatic thresholds. No request + automatic disabled stays disabled. Model instruction, not forced abort/compliance proof/reserve guarantee; large results can cross before boundary.
- Automatic default off; zero threshold also disables. Enabled: first completed qualifying turn inserts request as steering before next model turn, no completed-tool interruption. Error/aborted neither initiate/spend budget/escalate. Trigger determines neither mode nor permission.
- Failed/cancelled first automatic attempt: one final eligible at critical threshold, no repeat after second failure. Native metadata retains budget across reload; successful manual/threshold/overflow compaction resets, failed/aborted does not.
- Task-specific model-written Markdown title inside dossier, not initial prompt. Finish validates correlation; metadata check not Markdown/title/NUL absence/semantics. Native cutover invoked→cannot cancel.

## Status, cancellation and recovery

- Widget above input editor, independent of footer/powerline. Yellow `Waiting for Session Handoff`; `Writing Session Handoff` indeterminate activity; `Session Handoff Finished`. No Awaiting User GO/User Input Required or numbered/fractional progress.
- Failure/cancel override. Finished until next agent run/ordinary input/new request. `Wait Time` request→successful GET; `Handoff Time` GET→successful recipient turn. Whenever capture active show `Inputs deferred (0)`, increment per prompt, including Request-mode waiting. Advertise `/sh cancel`; current theme/width-safe; rendering/theme changes never advance recorded times.
- Canonical cancel/menu immediately invalidate request, Finish ID, reminder, retrieval. Before `newSession()`, even after Finish, remove only exact owned reservation; independent of receiver deletion setting. Foreign collision untouched; missing owned file harmless, other errors name path.
- Source tools unchanged; cancellation never aborts unrelated source work. Ownership retained through native-write settlement then cleanup. Command may `waitForIdle()`; event/tool return first, finish at settlement, never await self. Cleanup guards new starts/stale callbacks. One follow-up after cleanup; report failures, no false success. Retain recovery for explicit action; no automatic replay. Normal response abort/Escape no pause/cancel meaning.
- Configured deferral boundary→terminal completion/cancel protects user replacement/fork/compaction; Finish awaiting transition protected too. Cancellation cleanup additionally guards tree, even before GET. Before protection navigation may discard pending request. Late callbacks cannot revive work. Reload/interruption can end memory state/leave partial files; no crash restore/automatic leftover execution/removal.
- `/sh recover`: top-level recovery Markdown files/dates, one file at a time. Inspect entire unchanged contents; execute all as one current-session turn with original order/boundaries; discard exact file; return/cancel. Always explicit; unreadable reported/retained.
- Recovery deletion only concrete delivered recovery turn native completed. Void send ≠ delivery. Error/abort/rejection/unobserved retain; later success cannot heal failure. Existing no-queue-option dispatch; busy may reject. Tool error/length stop no extra veto; no semantic ingestion check.

## Settings

- Interactive `/sh settings`: each confirmed edit validates whole config, atomically persists, immediately applies without reload. Invalid input/rejected directory creation/persist failure retains prior value, concrete hint. Missing directory created only after exact-path confirmation.
- No overall draft/Save/Cancel. Escape only unconfirmed input; closing list retains saved edits. No overlap handoff/recovery; no start during settings. Current loaded extension updated directly.
- Readable nonempty role catalogue `call_*.cmpl` / `handoff_*.cmpl`; **Enter another filename** manual entry available.

| Key | Default | Constraint |
|---|---|---|
| `contextWarningPercent` | `60` | Finite; >=1, below critical |
| `criticalWarningPercent` | `90` | Finite; above warning, <=100 |
| `automaticSessionHandoff` | `false` | Boolean |
| `deferPromptsFrom` | `writing` | request/writing; next request only |
| `deleteHandoffAfterReading` | `true` | Boolean; false leaves exact file unchanged |
| `automaticSessionHandoffPercent` | `70` | Finite 0..100; zero disables automatic |
| `readinessRetrySeconds` | `60` | Integer 1..300; one visible reminder |
| `maxSessionChainLength` | `25` | Positive integer, master included |
| `recoveryDirectory` | managed recovery directory | Absolute directory |
| `templateDirectory` | `null` | Null or absolute addendum directory |
| `callTemplate` | `call_default.cmpl` | Initial-request `.cmpl` filename, not path |
| `handoffTemplate` | `handoff_default.cmpl` | Dossier `.cmpl` filename, not path |

- Warning once; critical may repeat at settled turns and gates final automatic attempt. Percentages never gate explicit starts.
- `pi-subagents` foreground normally `--no-session`: reject. Persisted child (`sessionFile`/`sessionDir`) may hand off itself, not parent. Leave automatic disabled unless intentional or exclude extension from children; parent orchestration does not automatically follow child replacement.

## Managed paths, templates and projects

- Root `<getAgentDir()>/pi-blitz-handoff/`: `config.json`, `project-templates.json`, `recovery/`, `templates/` with `backups/`, `call_default.cmpl`, `handoff_default.cmpl`.
- Load creates missing dirs; supports deliberate directory symlinks. Two default assets installed; different same-name managed content moved to timestamped `templates/backups/` before replacement. Nonrecursive catalogue excludes backups; other templates retained.
- GET supplies exclusive owner-only cwd `.pi/handoff_SESSID.md`, native source ID, no timestamp/subdir. Existing same-name never overwritten; leftover blocks same-source reservation until explicitly removed. Repeated GET reuses active reservation/snapshot/ID; aborted GET can reuse reservation, not authorize Finish.
- Delete-after-read true by default; false same path/content unchanged, no archive. Extension neither reads dossier nor performs/verifies receiver cleanup. Interrupted/failed attempts/cleanup may leave empty/partial file. Exclude `.pi/handoff_*.md` from Git/publication by local policy; extension never edits ignores. Retention increases when deletion disabled. Native model writes/reads still subject to output limits despite no full dossier in Finish/initial prompt.
- Shipped Call: tightly coupled work only, next checkpoint, GET before write, then Finish; initial path/ID absent. Shipped Handoff = V2 dossier. No packaged Fast/Balanced/development variants; custom managed/addendum supported.
- V2 upgrade syncs default with backup; preserves other files/selections. Choose `handoff_default.cmpl` globally; project Handoff `<Default>` explicit default, `<Autodiscover>` inherit. Addendum may shadow default.
- Manual legacy cleanup only if unchanged: first switch referencing global/project selections, then remove obsolete `default.cmpl`, `call_fast.cmpl`, `handoff_fast.cmpl`, `call_balanced.cmpl`, `handoff_balanced.cmpl`, `call_next.cmpl`, `handoff_next.cmpl`, optionally unchanged `handoff_v2.cmpl`. Keep customized files and both current defaults. No automatic deletion; retained `.cmpl` can remain selectable.
- Narrow previous-supported-config normalization in memory: validate retained/recognized retired values, remove `prepareWhileWaiting`, `writerAttempts`, `writerRetryDelaySeconds`; missing defer→writing, recognized old omissions delete→true, chain→25, call→default. Unknown keys/invalid shapes errors; no auto rewrite. Explicit settings save current schema only. No old GO/runtime compatibility; `debugging`/`speedMode` unsupported.
- Chain setting immediate; persisted native parent headers survive resume/reload; master=1. At limit next transfer independent master, full prompts unchanged; unreadable required ancestor visibly fails, no guessed count.
- `/sh project-template`: current cwd, separate Call/Handoff boxes. Autodiscover=no local role override; Default=concrete role-default filename; readable nonempty role catalogue omits duplicate default. Enter persists role immediately; absent entry other role starts Autodiscover. Escape only current unconfirmed choice, no Save. Both Autodiscover remove exact assignment; absent entry no write, factual message.
- Each start rereads assignment file; independent upward lookup from cwd, nearest concrete role selection, unresolved→global. Default bypasses further project/global, same resolver. Never descendants.
- Read/JSON/validation failure: one category warning, role defaults active, user may ask Pi to inspect. Both defaults must genuinely resolve; otherwise start fails. No automatic repair/rewrite.
- Customize template semantics/length/precision, not extension correlation/tool/interaction invariants. Code appends mandatory GET/Finish protocol, never initial path/ID.
- Nonrecursive shared resolver, separate roles: selected addendum if configured/present else selected managed; addendum role default; managed role default. Each physical candidate once, every failure reported; readable/nonempty `.cmpl`. Startup/settings-open check both roles. Failed non-default warns with failure/actual fallback; selected default itself no warning. Unresolved default visibly fails. No placeholder engine/embedded/fourth fallback.

## Data and development evidence

- Plaintext dossiers/recovery; prompt strings unchanged plus boundaries. Project file stores absolute dirs/template names. Restrictive new creation modes not sandbox/secret detection/encryption/inode tracking/filesystem-adversary policy. [Security](SECURITY.md).
- Checkout development install reference: `npm install`; not authorization. Dev ranges `^1.2.0`, lock Pi 1.2.0; host packages wildcard peers, not bundled. Older-dev checks ≠ supported >=1.5.0 proof.
- Functional tests ignored/local, not public repo/npm distribution. Private Pi working docs/checkpoints excluded from new public release; earlier public history unchanged. [Layout/logo standard](../pi-blitz-standard.md).
- Repository source/package gates:
  ```text
  npm run typecheck
  npx tsc --noEmit --noUnusedLocals --noUnusedParameters
  git diff --check
  npm pack --dry-run
  ```
- Maintainers with local functional tests also `npm test` before release. Corrected source/local candidate passed197tests/typecheck/noUnused/whitespace/package-dry-run/spec-checksum. Dev Pi1.2 copies mean no Pi1.5 static proof. Required deterministic coverage: [spec](../specification.md#14-validation).
- RealPi1.5/configured-model, Handoff only extension: command/manual + model starts; early/repeated GET stable path/ID; native write/Finish; parent-linked replacement; full dossier read; configured `deleteHandoffAfterReading: false` retention.
- Same real runs: cancellation reservation cleanup + same-source restart; Writing capture2prompts, unchanged ordered append, later prompt precedence; existing one-shot reminder; explicit native Recovery full inspection/execute/matched-completed-turn deletion. Observed runs only, not universal model compliance/extension-verified ingestion.
- Separate actual Pi1.5 SDK-bound tool test, real contexts/no doubles/no model: invalid/stale Finish IDs rejected; active request/path/dossier/session unchanged. Not agent-loop interception/model-compliance evidence.
- Bounded Pi1.5.2/configured-model smoke: unchanged prepared package; GET/repeatedGET/native write/Finish/parent-linked receiver/full read/delete=true; ordered Writing prompts/later precedence; cancel/restart/active-switch guard/explicit Recovery/completed-turn cleanup. Not full compatibility matrix. First isolated startup unexpectedly downloaded `rg`; own copy removed, existing native helper reused. No Pi/dependency version change.
- Real-model unrun: >=90% emergency, automatic initiation, Request deferral, chain-limit rollover, broad UI. Deterministic coverage retained; no real-model result for these cases. Further host/model/session work separately authorized. Historical results/screenshots not current-candidate verdicts.
- 2026-09-30 historical Real-Pi: existing 10-chain/test limit10→independent master/no parent, replacement re-entry summary/wait. Default25 deterministic only there; [chain evidence/scope](../session-chain-validation.md).
