# pi-blitz-handoff — product contract reference

- Source/authority: [human product specification](../specification.md). This file = agent derivative, not independent product authority.
- Approved: request → mandatory template retrieval → LLM-owned drafting → Finish; configurable Request/Writing deferral, unified overlays, native file transport. No separate GO/writer round or Ready/Wait/Cancel choice.
- Material product/UX/authorization/security/scope change or uncertainty → explicit user decision. Orchestrator may resolve only clearly implied small implementation details without material behavior/lifecycle/scope change. Workers report concrete gaps; never edit/reinterpret authority. Reject contradictory proposals.
- Git history, previous plans/code ≠ product authority or implementation context.
- Contract implemented. Requirements below ≠ proof every scenario verified. Actual local/model/SDK evidence and remaining limits: [validation scope](README.md#data-and-development-evidence).

## 1. Purpose and environment

- Capture continuation context more precisely than compaction; self-contained dossier in local file referenced by fresh native session's first prompt. Existing instructions/workflow/templates determine continuation; context ≠ new request/permission.
- Automatic handoff selects trigger only, never working mode/authorization. Autonomous work, dialogue/clarification, answering, research, waiting are transferred modes, not extension workflows.
- Use native Pi lifecycle/session/tool/UI APIs; no simulated replacement/parallel scheduler. Core works with Handoff alone; other extensions/personal config not prerequisites. Integrations optional.
- Pi >=1.5.0; Node.js >=22.19.0; interactive chat; native `write`; writable cwd `.pi/`; persisted source transcript. Reject `--no-session`/in-memory source visibly: no transcript path/native lineage.
- Native replacement through command-context `ctx.newSession()`, normally `parentSession`, independent master at chain limit.

## 2. Public surface and UI

| Command | Action |
|---|---|
| `/sh` | Menu |
| `/sh start` | Request handoff |
| `/sh help` | Usage |
| `/sh cancel` | Cancel active handoff before cutover |
| `/sh recover` | Leftover deferred-prompt files |
| `/sh settings` | Global config dialog |
| `/sh project-template` | Current cwd template assignments/removal |

- Only `/sh` public registration; six native argument-completed subcommands with descriptions/filtering. No former hyphenated aliases, `/sh config`, `/sh retry`, `/sh cleanup`, `/shconfig`, public transition command.
- One private correlated command bridge permitted solely to obtain `ExtensionCommandContext` for `ctx.newSession()`. Not advertised/initiation path; current transition only.
- `blitz_handoff`: `status` reports context/relevant config/status; `start` records explicit user request and lets model work settle. Discussion/questions/criticism/testing/mention ≠ start request.
- Exactly three initiation paths: command/menu, explicit model `start`, optional automatic. One active; second request rejects visibly without replacing IDs/state. Explicit starts ignore context percentages.
- TUI: genuine native `ctx.ui.custom()` overlays for menu, settings, project selections, recovery/full inspection, help. Compact themed borders/semantic colors, headings/descriptions/factual status/key hints; native selection/input/scroll components, no second renderer.
- Use injected native keybindings manager, not hard-coded keys. Narrow width/resize/theme changes remain usable.
- Primary menu action Start if inactive, Cancel if active; remaining recovery/settings/project/help. Opening/dismissing no side effect; selecting uses direct-command implementation. Configured cancel (Escape default) closes without action. Direct subcommands remain.
- Dialog answers stay out of model context. Non-TUI/RPC retains native select/input/confirm; no simulated overlay/alternate runtime/alias. Presentation does not redesign lifecycle/storage/readiness/cancel/automatic/deferral/resolution/persistence/recovery contracts.

## 3. Managed data and configuration

- Root `<getAgentDir()>/pi-blitz-handoff/`: `config.json`, `project-templates.json`, `recovery/`, `templates/` containing `backups/`, `call_default.cmpl`, `handoff_default.cmpl`.
- Check/create missing managed dirs on load. Deliberate directory symlinks supported. No inode/descriptor identity checks, `O_NOFOLLOW` or general filesystem-adversary framework.
- Generated filenames cannot traverse paths. New private dirs/files restrictive creation modes. Config/recovery replacement ordinary atomic writes. Exact nonrecursive cleanup.

| Key | Default | Validity/effect |
|---|---|---|
| `contextWarningPercent` | `60` | Finite; 1 <= warning < critical |
| `criticalWarningPercent` | `90` | Finite; warning < critical <=100 |
| `automaticSessionHandoff` | `false` | Boolean |
| `deleteHandoffAfterReading` | `true` | Boolean; exact receiver deletion only after full ingestion; false leaves unchanged/no archive |
| `deferPromptsFrom` | `writing` | `request` or `writing`; Request / Writing (template retrieved); active request retains mode |
| `automaticSessionHandoffPercent` | `70` | Finite 0..100; 0 or automatic=false disables automatic only |
| `readinessRetrySeconds` | `60` | Integer seconds 1..300; one-shot visible reminder |
| `maxSessionChainLength` | `25` | Positive integer, master counts as one |
| `recoveryDirectory` | `<getAgentDir()>/pi-blitz-handoff/recovery/` | Absolute directory |
| `templateDirectory` | `null` | Null or absolute addendum directory |
| `callTemplate` | `call_default.cmpl` | `.cmpl` filename, not path |
| `handoffTemplate` | `handoff_default.cmpl` | `.cmpl` filename, not path |

- At/above chain limit, next transfer omits parent, independent master; unchanged full dossier/deferred prompts, old sessions untouched. Bounds `/resume` readability, not duration. Persisted native parent headers determine length across resume/reload; new master=1. Unreadable required lineage fails cutover visibly; no guessed count. Setting immediate.
- Directory setting must resolve directory; if absent, ask exact-path creation confirmation before save. Symlinks valid.
- Settings: terminal overlay with current persisted values; choose/edit repeatedly in any order. Role template catalogue readable/nonempty `call_` or `handoff_` prefix; manual other `.cmpl` entry available.
- Each confirmed edit validates entire resulting config; atomic persist; runtime apply immediately, no reload. Invalid input/rejected creation/persist failure retains previous value with concrete correction hint.
- No overall draft/Save/Cancel. Escape only unconfirmed input; closing list keeps prior edits. Cannot overlap active handoff/recovery; no handoff during config. Dialog contents outside model context. Reload/replacement closes dialog without rolling back saves.

## 4. Templates and project selection

- Exactly two shipped templates:
  - `call_default.cmpl`: compact English Caveman request at next safe checkpoint, tightly coupled versus independent work, mandatory retrieval before writing, then Finish with returned ID. No transport path/Finish ID, GO or second writer prompt.
  - `handoff_default.cmpl`: write supplied file, submit only ID; V2 mode/work/grants/conditions/state/decisions/skills/evidence/targeted retrieval.
- No packaged Fast/Balanced/development variants. Keep custom managed/addendum templates and existing selections.
- Load synchronization per asset: equal→no write; missing→install; different→move old managed file to `backups/<filename>.backup-<UTC timestamp>`, install package asset. Filesystem-safe UTC millisecond timestamp. Backups not `.cmpl`, not selectable, never auto-deleted. Catalogue nonrecursive; other files preserved.
- Shared resolver, separate role selections:
  1. Selected addendum candidate if configured/present, otherwise selected managed candidate.
  2. Configured addendum role default.
  3. Managed role default.
- Each physical path tried at most once. Require readable/nonempty `.cmpl`; report every failed candidate. No placeholder engine, embedded TypeScript template or fourth fallback.
- Startup/settings-open health-check both roles. Non-default failure falls back with visible failed-candidate/actual-fallback warning. Default selection itself no warning; unresolved default fails visibly, no pretend content.
- Narrow previous-supported-config normalization, in memory only: validate retained values and recognized retired `prepareWhileWaiting`, `writerAttempts`, `writerRetryDelaySeconds`, then remove retired keys. Missing `deferPromptsFrom`→`writing`; recognized older omissions delete→true, chain→25, call→`call_default.cmpl`. Unknown keys/invalid shapes remain errors. Load never rewrites personal config; explicit settings save writes only current schema. No old GO/runtime compatibility. `debugging`/`speedMode` unsupported.
- Project file root keyed normalized absolute dir; each value exactly both `callTemplate` and `handoffTemplate`; null or role-prefixed `.cmpl`, at least one concrete. Null = `<Autodiscover>`; null/null invalid stored state (remove entry instead). Missing file = no assignments.
- `/sh project-template` uses `ctx.cwd`, no path question. Independent role boxes: Autodiscover, Default, readable/nonempty role catalogue without duplicate default. Default stores role-default filename. Enter persists role atomically/immediately, absent entry other role starts Autodiscover. Escape only current unconfirmed choice; no Save. Both Autodiscover remove exact entry; distinguish removed from no prior entry/no write.
- Every explicit/automatic request rereads assignments. Walk only upward from normalized cwd, independently per role; nearest concrete selection wins, unresolved role global after root. Default concrete bypasses ancestors/global but retains same resolver/addendum shadow. Never inspect descendants.
- Read/parse/validation failure: one concise native warning, category + settings not loaded + both role defaults active + user may ask Pi to inspect. No parser fragment/repair/overwrite/retry/repair dialog/separate status. Start continues only if both defaults genuinely resolve; same explicit/automatic behavior.

## 5. Warnings and automatic attempts

- Warning threshold: one advisory notification. Critical: may repeat after settled turns. UI only, distinct from fixed emergency model instruction.
- Enabled automatic: check each `turn_end` with native `completed`; error/aborted neither initiate, spend budget nor escalate. First qualifying threshold boundary records request, readiness as steering before next model turn, no interruption of completed tools.
- First automatic unsuccessful replacement: one final attempt eligible at critical threshold, next completed boundary even if already above critical when first ended. Second unsuccessful not repeated.
- Accepted-attempt count native session metadata, reconstructed after reload. Every successful manual/threshold/overflow compaction resets/persists zero; failed/aborted does not. Explicit starts always available independent of percentages.

## 6. Request, template retrieval and Finish

- Lifecycle: request → `session_handoff_get_template({})` → model drafts/updates with original tools → `session_handoff_finish({ id })` at safe checkpoint → idle/no-pending native transition. No GO, second writer prompt or Ready/Wait/Cancel; canonical cancel/menu remain.
- Manual/model instruction normally dispatches at native settled/no pending messages; automatic as steering at completed boundary, preserving budget/tool work. Early successful GET before first dispatch includes pending selected Call Template once in its response and starts same one-shot reminder. Preserve safe-checkpoint/custom instructions without extra request/writer model round; repeated GET/later settlement never resend.
- Compact English Caveman Call Template: next transferable checkpoint, not whole-task completion. Finish only tightly coupled in-flight work necessary for safe transfer. Independent terminals/background work may continue; preserve how receiver can check, never wait on them or add task work to postpone transfer.
- First instruction directs GET with empty object; no transport path or Finish ID. No invented path or handoff write before retrieval. GET available for active request, no preparation option.
- GET returns resolved Handoff Template, exact reserved path, source transcript locator, fresh Finish correlation ID; not source-session ID/old GO key. Repeated retrieval shares active snapshot/file/ID. Cancelled/superseded async retrieval cannot reserve late file/return live ID.
- Early retrieval/drafting allowed while reaching checkpoint. Existing source tools unchanged; no isolated loadout, dedicated writer round, persistent tool snapshot or stopping necessary source work. Native `write` must already exist; otherwise visible failure. Refresh consequential facts/results/permissions/next action before Finish; semantics/checkpoint model-owned.
- Finish accepts exact successfully returned GET ID only, neither content nor path. Reject missing-template/stale/duplicate. Valid Finish marks file ready; existing idle/no-pending settlement permits private native transition. No automatic writer attempts/retry model turns/redundant template delivery. Native batch termination hint does not prove unrelated work settled.
- GET/Finish native `executionMode: "sequential"`; direct exposure unchanged. No ordinary-prose lifecycle parser.
- One visible reminder after `readinessRetrySeconds`: complete current flow; no polling, regenerated IDs/files/templates.

### Fixed 90% emergency

- Active requested/unsubmitted handoff: first completed turn >=90% sends one native steering instruction. Stop source-task work/context gathering; fetch if missing, finalize supplied file, Finish. Do not wait on independent terminals/subagents.
- Selected Call not yet delivered: include once in same emergency instruction. Emergency stop/no-extra-context overrides conflicting Call waiting guidance. Later GET/settlement neither repeats Call nor starts reminder.
- Cancel ordinary reminder; preserve request/file/ID, no new attempt. Cancelled/submitted requests not escalated. No request + automatic disabled remains disabled.
- Urgent model guidance, not forced abort/compliance proof/guaranteed reserve; large results may cross limit before check.

## 7. Configurable deferred prompts

- `request`: capture subsequent ordinary interactive/RPC input immediately after accepted request.
- `writing` default: successful GET return, including early preparation; before boundary input normal. No first-filesystem-write detector. Failed/aborted GET neither starts Writing deferral nor authorizes Finish. Reservation from aborted call may be reused, never treated as foreign collision.
- Mode fixed for active request; settings affect next request only. Extension-owned input passes through; slash commands native. Captured strings unchanged/in order/with boundaries; stay outside source task/drafting context. Never parse/classify/summarize/rewrite.
- Keep latest snapshot and visible capture status until replacement begins; no second protocol for theoretical cutover races.
- Memory runtime source. One atomic Markdown recovery file per entire window, never per prompt; no captured input→no file.
- Filename `<filesystem-safe UTC timestamp>-<normalized source session ID>.md`; UTC milliseconds; normalized ID letters/digits/hyphens only. Boundaries `--- Deferred Prompt N of M ---`; enclosed strings unchanged.

## 8. V2 dossier

- GET supplies template/file/Finish ID together, no later writer round. Source writes/updates complete dossier through native tools, submits ID-only Finish once at safe checkpoint. Before Finish refresh facts/results/permissions/next action; model owns completeness. Writing controls are extension controls, never transferred as user/task restrictions.
- Correlation and metadata only; no dossier-fact/Markdown/NUL/completeness validation, arbitrary byte cap or separate title channel. Accepted Caveman describes instructions; dossier uses user's conversation language.
- First line concise meaningful task-specific Markdown title inside file, not initial prompt/automatic navigation name. No generic status prefix, separate name field/parser/sanitizer/second title channel. Structure/title model instructions only.
- Distinguish completed verified/unverified, partial/reverted, authorized/fresh-approval work, blockers/questions/files/evidence/decisions/cold-context references. Discussion/criticism/rejected proposals/unanswered questions never become authorization.
- V2 after title: `Working mode` actual continuing `userfacing` or `autonom`. Automatic trigger/drafting neither establishes autonomy nor grants permission.
- Same file `Historical context`: one short reference-only paragraph, topic/task label — actual session ID — known entry point. Transcript starting line only if established, otherwise known alternative/unknown. Known references only; no ancestor inventory scan, separate history file or narrative.
- History loading instruction: only concrete unresolved fact/discrepancy not answered by positive context/known governing-detail source; otherwise keep unloaded. Historical references only here.
- `Positive context`: all still relevant regardless of age; completed-work consequences under state/evidence, past compressed into history. Sections:
  1. `Work and assignment`: confirmed goal, remaining commissioned work/order/dependencies, exact next action or current dialogue unit/question count; ideas/discussion not commissions.
  2. `Permissions and boundaries`: continuing grants/provenance/remaining coverage, access/elevation, material conditions/separate gates. Do not reactivate completed individual acts; undertaking grant not consumed by one completed step.
  3. `Current work state`: consequential dirty/staged/uncommitted/unintegrated/partial/failed/reverted file/system state, actually running work with identity/owner/status, effective blockers; unknown remains unknown.
  4. `Binding instructions`: decisions/genuine governing sources/active skills name-purpose-scope; no cumulative read inventory, skill-path field or blanket reload. Frozen authority through actual plan/source reference.
  5. `Evidence and uncertainty`: observations/checks/results/limits/unresolved-unread frontiers; later edits inherit no earlier PASS.
  6. `Targeted retrieval`: current detail sources/content/concrete reading occasion, not historical sessions.
- No secrets/invented facts/semantic authorization guarantees. Core inline: permissions/material conditions/decisive facts/actual state never replaced by pointers. Known unambiguous governing sources may carry detail. One primary place/fact; no completeness-replacing length quota; omit empty/inapplicable optional fields.
- Open step includes receiver instruction once: Deferred Prompts first, separate sequential inputs; later may supersede. Restore only authorities/skills required by applicable contracts. No previous-session recap. Userfacing: resume dialogue/answer/question. Autonom: actually perform authorized next work in first response. Ask only concrete blocking missing decision/permission/blocker; do not re-request valid grant.
- Semantic writer/receiver contract, not verified output/retrieval/restoration guarantee; extension parses no coverage/references/entry points/history compression.
- Source tools remain unchanged throughout; cancellation/terminal failure preserve exact user selection. No isolation, persistent snapshot or automatic writer retries.

## 9. File transport, replacement and completion

- Valid Finish + settled boundary: no assembly model call; private correlated command obtains native replacement context.
- Owner-only exclusive `.pi/handoff_SESSID.md` directly under cwd; native source ID, no timestamp/subdir. Same-name collision fails, never overwrite. Leftover failed/interrupted/retained file blocks same-source reservation until explicitly removed; repeated retrieval in same active handoff reuses reservation.
- Extension never reads/parses/retransmits dossier. Pre-cutover open existing without creating; require nonempty regular file. Append latest deferred snapshot synchronously, no fresh async input gap before `newSession()`.
- Deferred prompts present→append `## Deferred Prompts` with unchanged ordered entries/deterministic boundaries; instruct separate sequential inputs after dossier, later entries can supersede earlier context. No prompts→no empty section.
- Normally `ctx.newSession({ parentSession: sourceSessionPath })`; at/above limit omit parent. Same file reference either way; no model-authored transition command.
- Short first user prompt absolute path + receiver instructions, not full dossier. Receiver normal startup/basic skills, read to EOF continuing truncation.
- Complete successful ingestion only: delete exact file if true/default, otherwise keep exact path/content. Failed/incomplete read: unchanged, report blocker. Report cleanup failure. Extension neither performs nor verifies ingestion/cleanup; no archive. Plaintext: local Git/publication exclusion, no automatic ignore edits.
- Selected template owns continuation. V2: deferred prompts first, actual mode/no recap, actual authorized autonomous action rather than announcement.
- Completion: correlate extension-owned bootstrap input→actually emitted user message→owning native recipient turn. That concrete turn may not be first. Only its `TurnEndEvent.outcome === "completed"` sets Finished/permits associated recovery deletion; success also releases protection. Established terminal failure releases protection without Finished.
- Error/aborted/rejected/unobserved→retain/no Finished. Void send or later successful turn insufficient. Native completed authoritative, no stop-reason/tool-error veto; no semantic ingestion/receiver-cleanup proof or wait for unrelated later work.
- Keep no-`deliverAs` dispatch; add no queue/retry policy. Fresh replacement context owns dispatch; receiving runtime owns completion. Late sender-promise settlement cannot overwrite observed turn result.
- Persisted source transcripts available for targeted retrieval via historical IDs. Parent lineage additionally links source unless independent master. Native tool calls/results persist normally; submission log ID only.

## 10. Cancellation and lifecycle

- Canonical `/sh cancel`/menu immediately invalidate active request, template/Finish ID, reminder, in-flight retrieval. No Ready/Wait/Cancel selection, pause mode or new Escape/response-abort meaning.
- Before native `newSession()` invocation, even after Finish: delete only exact runtime-owned reservation, independent of receiver-delete setting. Foreign collisions untouched; missing owned file harmless, other errors name path. Exact/nonrecursive, no scan.
- Source tools unchanged; do not abort unrelated source work. Retain reservation ownership through native write settlement, then remove. Command may await native `waitForIdle()`; event/tool paths return first, finish at native settlement, never await themselves.
- No start/stale callback reactivation during cleanup. Existing visible follow-up once after cleanup; report errors, not clean success. Preserve deferred recovery, never replay automatically.
- `newSession()` invocation commits cutover, no cancellation. Configured deferral boundary→terminal completion/cancel protects user replacement/fork/compaction; also protect accepted Finish awaiting transition. Cleanup additionally guards tree navigation, can block before GET. Before protection navigation may discard pending request. Own correlated replacement allowed.
- Late cancelled/superseded retrievals, Finish, timers/callbacks cannot revive old work or reserve new file. Reload/interruption may end memory state; no crash/exit restore or automatic leftover execution/removal. Cleanup failure/interruption may leave empty/partial reservation; recovery explicit.

## 11. Explicit recovery

- `/sh recover`: every remaining recovery file/date; one selected at a time. Inspect complete prompts, execute, discard, return/cancel. Questions/answers outside model context.
- Execute all stored prompts as one current-session combined user turn, original order/boundaries, instructions to treat as separate sequential inputs.
- Delete only after correlated actually delivered recovery input's concrete turn native completed. Void send/unrelated turn insufficient. Error/abort/rejected/unobserved retain; later success cannot heal failed match. Existing no-`deliverAs`, busy may reject. No stop-reason/tool-error veto, semantic acknowledgement, automatic queue/retry/replay.
- Discard exact selected file; inspect never modifies; unreadable reported/retained.
- No per-prompt selection, pending/dispatching states, checkpoint identity, Outbox or delivery-uncertain state machine.

## 12. Status and failure

- Concise factual chat and `blitz_handoff status`. Persistent widget above editor:
  - yellow `Waiting for Session Handoff`;
  - `Writing Session Handoff`, indeterminate activity;
  - `Session Handoff Finished` in replacement until next agent run/ordinary input/new handoff.
- Advertise canonical `/sh cancel`; no Awaiting User GO/User Input Required state. Successful GET enters Writing; accepted Finish awaits native settlement.
- Failure/cancel override. Success second line `Wait Time` request→successful GET and `Handoff Time` GET→recipient-turn success. Whenever configured capture active, `Inputs deferred (0)` increment per prompt, including Request mode before GET. Attempt info factual chat/tool only; no invented numbered/fractional persistent progress.
- Current injected theme, width-safe after changes without status update. Durations captured at update; rendering/theme invalidation never advances them.
- All product messages/dialogs/templates/docs clear English.
- Terminal failure: preserve exact tools, invalidate IDs/timers, stop run's automatic continuation, concrete failure/recovery-file status. Cleanup errors name path; no rollback of already successful replacement.

## 13. Validation requirements and evidence limits

- Required deterministic coverage:
  - Full config validation, per-setting atomic immediate persistence/refresh/failure retention.
  - Two-default sync/backups/catalogue/fallback.
  - Project validation/per-role create/edit/remove/upward resolution/Autodiscover/Default/corrupt defaults.
  - Explicit/automatic initiation, compact bounded request, one-shot reminder/emergency, no GO/user-choice tools.
  - Mandatory empty-object GET; no path/Finish ID initially; stable repeated GET, cancellation/aborted-call invalidation, exact Finish correlation.
  - Request/Writing deferral, early successful versus failed/aborted GET, one ordered recovery file.
  - Caveman default/full dossier/receiver semantics; unchanged tools, no automatic writer/retry/template resend.
  - Real local reservation/collision/metadata-only checks/deferred ordering/append/one recovery file.
  - Receiver startup/complete-read/configured cleanup text contracts, not actual receiver execution.
  - Native replacement/parent lineage/chain including master/parentless unchanged transfer/persisted resume-reload count.
  - Cancellation/stale invalidation, native-write settlement without unrelated-work abort, no tool/event self-deadlock, exact source-tool invariance.
  - Exact delivered-turn completion/recovery deletion: later indices, independent receivers, unrelated/failed turns, rejected/unobserved delivery, late sender settlement.
  - Per-file recovery inspect/execute/discard/matched-completed deletion.
  - Public commands/completion/menu dispatch/tool/factual status.
  - Genuine overlays/keybindings/narrow width/scroll/resize/theme/focus/dismiss/lifecycle/no context leakage.
- Focused adapters/pure helpers allowed, no second fake Pi runtime. Pi packages native wildcard peers, not bundled.
- Dev ranges `^1.2.0`, lock Pi 1.2.0; those checks do not establish supported >=1.5.0 compatibility. Same candidate separately against available 1.5.0 host packages, label evidence accurately.
- Test doubles current `TurnEndEvent` outcomes, `AgentSettledEvent` (`aborted`), `ExtensionToolContext`. Check core independent of other extensions/personal config.
- Local gate, repository cwd (listed commands ≠ checks run by this documentation task):
  ```text
  npm test
  npm run typecheck
  npx tsc --noEmit --noUnusedLocals --noUnusedParameters
  git diff --check
  npm pack --dry-run
  ```
- Real current-Pi/model/session gate separate, fresh user approval required: mutates real session state. No such validation claimed here.

## 14. Exclusions

- No public/parallel transition beyond private command bridge; periodic readiness polling; deterministic free-text parsing/work-style detector; separate session-name field; extension dossier reading/parsing/retransmission; semantic validation/verified ingestion-cleanup; guaranteed speedup/artificial waiting; per-prompt recovery files; automatic replay; recovery dispatch state machine; filesystem-adversary framework; obsolete config/state shims; embedded template fallback; generic extra continuation turn; strict headings; arbitrary dossier size cap; optional-extension-specific readiness beyond in-flight boundary; GitHub CI.
