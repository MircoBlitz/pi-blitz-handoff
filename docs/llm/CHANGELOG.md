# Changelog — agent reference

- Source: [human changelog](../../CHANGELOG.md). Meaning-equivalent derivative, no independent product authority/publication claim. [Specification](../specification.md) sole product authority.
- Earlier entries historical; GO/DONE/settings/test claims describe those versions, not current contract.

## 2.0.0 — 2026-11-11

- GitHub release: source/version tag/package archive. Maintainer handles npm separately; no npm availability claim. Major version for breaking protocol/custom-template/settings/UI changes; independent of Pi version. Requires Pi>=1.5.0, Node>=22.19.0.

### Changed

- Request→mandatory `session_handoff_get_template({})`→draft→`session_handoff_finish({ id })`, replacing GO/DONE. Initial request no path/Finish ID. GET returns template/exact reserved file/transcript locator/fresh Finish ID; repeated GET same active snapshot/path/ID. Finish exact ID only, no content/path; missing retrieval/stale/duplicate rejected.
- Custom templates supported, mandatory GET/Finish invariants appended. Next safe checkpoint, not task completion; independent background work need not finish. Early draft with unchanged source tools; no isolation/second writer round/automatic writer retry. Pending selected Call delivered once via early GET/emergency steering when needed.
- `deferPromptsFrom`: Writing (template retrieved) default, Request alternative; active request mode fixed. Successful GET starts Writing capture; failed/aborted does not. Prompts unchanged/ordered, one recovery file, appended before native cutover; later prompts may supersede earlier context.
- Completion/recovery deletion: exact native turn actually receiving bootstrap/Recovery input, possibly not first recipient turn. Only native completed; error/abort/rejection/unobserved retain recovery. Not ingestion/receiver-cleanup verification; no queue/retry/extra semantic veto.
- Cancel invalidates retrieval/Finish immediately; exact runtime-owned reservation removed after native writes settle. No unrelated-work abort/tool change. Same-source restart; explicit recovery. Status current native theme/width-safe/fixed recorded durations.

### Removed and compatibility

- Remove GO/DONE tools, Ready/Wait/Cancel choice, `prepareWhileWaiting`, `writerAttempts`, `writerRetryDelaySeconds`. Keep canonical `/sh cancel`, menu cancel, one-shot `readinessRetrySeconds` reminder.
- Recognized previous settings validated/normalized in memory only; missing defer→writing. Retained values validate; unknown/invalid shapes errors. Load never rewrites personal config; explicit save current schema. Load compatibility, not old protocol compatibility.

### Validation and limits

- Corrected source/local candidate:197tests/typecheck/noUnused/whitespace/package-dry-run/spec-checksum passed. Dev ranges^1.2.0 resolvePi1.2.0; not Pi1.5 static proof.
- RealPi1.5/model, Handoff only extension: command/manual + model starts; early/repeated GET stable IDs/paths; native write/Finish; parent-linked replacements/full reads/retention with `deleteHandoffAfterReading: false`; cancel cleanup/restart; Writing2prompt unchanged ordered append/later precedence; one-shot reminder; explicit native Recovery inspect/execute/completed-turn deletion.
- Separate actual Pi1.5 SDK-bound tools, real contexts/no doubles/no model: invalid/stale Finish IDs rejected; active request/path/dossier/session unchanged. Not agent-loop interception/model-compliance proof.
- Bounded Pi1.5.2/configured-model smoke: unchanged prepared package; GET/repeatedGET/native write/Finish/parent-linked receiver/full read/delete=true; ordered Writing prompts/later precedence; cancel/restart/active-switch guard/explicit Recovery/completed-turn cleanup. Not full compatibility matrix. First isolated startup unexpectedly downloaded `rg`; own copy removed, existing native helper reused. No Pi/dependency version change.
- Real-model unrun: >=90% emergency, automatic initiation, Request deferral, chain rollover, broad UI; deterministic checks exist. No universal model-compliance/lossless-transfer/extension-verified ingestion/cleanup claim.

## 1.4.2 — 2026-10-21

- Added fixed90% emergency for requested handoff awaiting model GO: next completed turn urgent steering stops source work, existing correlated GO immediately. Cancel reminder; preserve explicit Wait, GO/DONE split, automatic-attempt budget. No real-model compliance/reserve guarantee.

## 1.4.1 — 2026-10-21

- Fixed cancel: remove runtime-owned reservation/draft incl pre-GO preparation and after DONE before cutover; same-source restart no collision. Foreign files/recovery retained; cleanup errors name path.
- Added shared logo/repository standard. Functional tests/Pi working docs ignored local files, not public repo/npm. New release without private checkpoint commits; existing public history unchanged.
- Local checks: cancel before GO/during writing/after DONE, restart/collision/recovery/error paths. No real-model/Pi-session E2E for fix.

## 1.4.0 — 2026-10-16

- Added `prepareWhileWaiting: false` optional pre-GO `session_handoff_get_template({ key })` for genuine waiting. Same template/file/first submission ID; no resend when prepared. Without retrieval, normal after-GO writer.
- Added `deleteHandoffAfterReading: true`: exact receiver deletion after complete ingestion; false same path/content, no archive.
- Default dossier: reference-only history topic/task/session/known entry point, established lines only; retrieve only concrete unresolved need. Positive current constraints/skills/results inline, same file. Guidance, not verified compression/retrieval.
- Native file tools write cwd `.pi/handoff_SESSID.md`, native source ID/no timestamp/subdir; exclusive collision rejection. Bootstrap absolute path, not dossier.
- GO safe boundary + deferral; separate DONE `submit_session_handoff({ id })` finalized file; DONE + settled boundary permits replacement. ID only, no content/path.
- Metadata-only nonempty regular-file check; append deferred prompts without dossier read/parse. Receiver normal startup/basic skills, full read past truncation, cleanup only after complete ingestion; failed/incomplete leaves file, report cleanup failure.
- Dev/deterministic Pi1.2.0/^1.2.0; host wildcard peers/unbundled. Doubles `agent_settled.aborted`/`ExtensionToolContext`; no production workaround/lifecycle redesign.
- Defaults describe preparation/file writing, retain V2. Writer native read/write/edit/DONE then exact restore. Older exact configs two booleans in memory, no auto migration; both settings immediate.
- Fixed aborted early GET: undelivered template not suppressed; normal post-GO writer resolves/sends with reused reservation, no collision.
- Semantics/ingestion/receiver cleanup model responsibility. No preparation-speed guarantee/artificial wait; accepted GO/DONE turns remain. Deterministic protocol/transport tests only; no new real-model/Pi E2E, earlier Real-Pi older contracts only.

## 1.3.1 — 2026-10-12

- Added themed terminal overlays: menu/settings/project templates/recovery/full inspection/help/Ready-Wait-Cancel; native described prefix-filtered `/sh` completion; `/sh start`.
- `/sh` menu, primary Start/Cancel by active state; Escape no action. Direct commands/RPC/immediate settings/lifecycle unchanged.
- Call separates readiness from writing: no file during readiness; after GO wait for Handoff Template/submission ID. Model guidance, not write block. V2 unchanged.

## 1.3.0 — 2026-10-09

- Unchanged reviewed V2→`handoff_default.cmpl`: actual mode/work/grants/conditions/state/skills/evidence; deferred first, actual dialogue/authorized action, no recap. Model guidance, not lossless guarantee.
- Exactly two shipped templates: unchanged Call + V2 Handoff.
- `/sh` subcommands help/cancel/recover/settings/project-template; settings replaces config; widget `/sh cancel`. No hyphenated/config aliases.
- Settings each confirmed edit validated/saved/applied immediately. Escape unconfirmed only; saved values retained, no overall Save/Cancel.
- Added chain limit default25 incl master; next transfer at limit independent master/same full context. Persisted lineage across resume/reload; old sessions untouched.
- Removed Fast/Balanced/local development variants. Saved paths/format, custom managed/addendum/project/fallback/backups remain. Default sync with backup, no other-template deletion/selection rewrite. Adopt V2 via global selection and check project/addendum override.
- Deterministic default-pair/V2/commands/persistence/chain tests, not full Real-Pi E2E. 2026-09-30 Real-Pi existing10-chain/isolated limit10: independent master/no parent/wait, global25 unchanged. [Evidence](../session-chain-validation.md).

## 1.2.4 — 2026-09-12

- Added repository-hosted two-image successful autonomous startup/continued authorized work sequence; screenshots excluded npm.
- Clarified sole purpose: more precise continuation context than compaction, fresh native-linked session first prompt; existing user instructions/workflow/templates own continuation.

## 1.2.3 — 2026-09-10

- One-shot reminder reapplies selected Call, no separate hardcoded work-boundary policy.
- Removed duplicate source-stop language from Fast/Balanced dossiers; turn-local writer control extension-owned.

## 1.2.2 — 2026-09-10

- Managed backups→nonrecursive `templates/backups/`, absent from selection.
- Writer control current writer turn only; not transferable user instruction stopping autonomous continuation.

## 1.2.1 — 2026-09-10

- Added paired Fast/Balanced Call/Handoff profiles beside Precise defaults. Fast condensed indexed/no recap; Balanced more receiver initialization/brief re-entry summary.
- All shipped profiles instruct autonomous receiver to perform next work, not merely announce.

## 1.2.0 — 2026-09-10

- Added `/sh-project-template`, independent nearest-ancestor per-role lookup, Autodiscover/Default selections.
- Per-role immediate persistence; both Autodiscover remove exact entry.
- Automatic direct readiness only, no extension choice stopping autonomy. Resolve Handoff each writer attempt for intentional live changes.
- Default session operational state separate from cumulative skills; every replacement concise re-entry summary.
- Invalid/unreadable assignments once warn/genuine role-default fallback/no auto repair. Cancelled deferred-readiness choices retain no template selection.

## 1.1.3 — 2026-09-08

- Finished widget cleared on next replacement agent run; cancellation explicitly releases model from readiness/writer instruction.
- Templates moved root→`templates/`; reviewed dev dossier promoted to default, cumulative skills + waiting receiver re-entry summary. Package description includes template-guided readiness/dossiers.
- Removed obsolete packaged `default.cmpl` compatibility file and tracked/packaged `*_next.cmpl`; ignored local copies remain.

## 1.1.2 — 2026-09-08

- Standard single-extension layout: installed name `pi-blitz-handoff`, no redundant resource suffix.

## 1.1.1 — 2026-09-08

- Automatic thresholds at completed turns, autonomous continuation cannot postpone until user input.
- One final critical-threshold attempt after first failure; two-attempt budget survives reload, successful compaction resets.

## 1.1.0 — 2026-09-06

- Added correlated `session_handoff_go`/`session_handoff_go_with_user_deferral`, Ready/Wait/Cancel with model reason for genuine collaboration, separate managed/configurable Call/Handoff, deferred count + wait/handoff times.
- Replaced repeated exact GO/NOT-YET prompts with one Call/keyed decision/at most one configured-delay silent re-evaluation.
- Readiness only genuine in-flight work; future tasks/resumable questions not blockers, direct GO if deferral uncertain.
- Wait suspends reminder, normal input, `Awaiting User GO · Tell your LLM to start when ready` until authorized GO/cancel. `readinessRetrySeconds` single deadlock reminder, not retry loop.
- Startup/settings-open both template roles checked; nondefault failure visible fallback, unresolved default fails. Widget `/sh-cancel`, spaced `/sh cancel` accepted.
- Exact old config missing only callTemplate gets `call_default.cmpl` in memory/no migration. `handoffTemplate: "default.cmpl"` legacy name supported.

## 1.0.1 — 2026-09-05

- Persistent status widget stabilized/terminal-width-safe.

## 1.0.0 — 2026-09-05

- Structured dossiers→fresh native-linked Pi sessions/source lineage; manual `/sh`, `blitz_handoff`, optional context-threshold initiation.
- Deterministic deferred capture/one-file recovery/explicit actions; in-chat config/managed templates/readiness+writer retries/context warnings; persistent status/cancel/session-change guards.
