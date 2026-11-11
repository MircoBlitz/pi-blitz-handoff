# Security — agent reference

- Source: [root SECURITY.md](../../SECURITY.md). Meaning-equivalent derivative, no independent authority/permission/verification claim. [Human specification](../specification.md) sole product authority.
- Template-to-Finish, package2.0.0 GitHub release. Maintainer handles npm separately; no npm availability claim. Node.js >=22.19.0; `@earendil-works/pi-coding-agent` >=1.5.0. Package/Pi versions independent. Older package/Node/Pi not evaluated against contract.

## Trust and authorization

- Extension runs with full OS permissions of Pi process; trust TypeScript with that access. Project trust not extension sandbox.
- Instructions preserve authorization: continuation grants no permission; distinguish proposed/paused/approval-dependent from executable. Model guidance, not deterministic semantic guarantee.
- Finish validates exact successful-GET ID, not dossier semantics. Pre-cutover nonempty-regular-file metadata check without dossier read. No NUL/Markdown/completeness/authorization validation.

## Data flow and retrieval

- Handles persisted source transcript path; cwd/ancestor project-lookup paths; selected template; model-written dossier; ordinary interactive/RPC inputs from configured request/retrieval boundary; context usage/status.
- Retrieved instructions/dossier processed through configured source model. Native file tools write cwd `.pi/handoff_<Session-ID>.md`. `session_handoff_finish({ id })`: ID only, no content/path.
- Extension appends unchanged deferred prompts without reading dossier. First replacement user turn absolute path + ingestion/cleanup instructions. Receiver reads send dossier through configured replacement model. Native tool calls/results follow Pi normal session persistence in both sessions.
- Initial request no transport path/Finish ID. Mandatory `session_handoff_get_template({})`: template, exact reservation, transcript locator, fresh Finish ID. No write/invented path before retrieval. Early drafting allowed with unchanged source tools. Repeated GET shares active snapshot/path/ID.
- No isolated writer/persistent tool snapshot/GO/user-choice dialog/automatic writer retry. Native `write` already available. Refresh facts/results/permissions/next action before safe-checkpoint Finish; code does not verify judgment/completeness. Finish rejects missing successful retrieval/stale/duplicate ID; idle/no-pending settlement permits transition.
- `deferPromptsFrom` request|writing, writing default. UI **Request** / **Writing (template retrieved)**. Successful GET incl early retrieval starts Writing deferral, not first-filesystem-write detector. Failed/aborted GET not success/Finish authorization; reservation reusable. Active mode fixed.
- Cancel invalidates retrieval/ID immediately; exact owned reservation removed after native writes settle, no unrelated-work abort. Cancelled/superseded async GET cannot reserve late file/return live ID. Interruption/cleanup failure can leave reserved/partial file.
- Deferred strings unchanged/in arrival order; one plaintext Markdown recovery file/window when captured. No secret detection/redaction/encryption. Secrets only if configured model/local session/recovery storage appropriate.

## Filesystem and retention

- Global root `<getAgentDir()>/pi-blitz-handoff/`; project file directly `.pi/handoff_<Session-ID>.md`, no timestamp.
- New dirs `0700`, files `0600`; global config/project assignments/recovery ordinary atomic rename replacement. Exact nonrecursive cleanup.
- Exposure reduction, not filesystem security framework: deliberately configured directory symlinks followed; no inode/descriptor tracking/`O_NOFOLLOW`; existing directory permissions not tightened; no handoff/recovery/template encryption; unchanged native source tools not path sandbox; supplied-path/checkpoint/emergency restrictions model guidance. Managed-default backups retained until user removes.
- `deleteHandoffAfterReading: true` default: receiver instruction to delete exact file only after complete successful ingestion. False keeps exact path/content, increases plaintext retention; no archive.
- Failed/incomplete reading leaves file unchanged; report cleanup failure. Extension neither performs nor verifies ingestion/deletion.
- Exclude `.pi/handoff_*.md` from Git/publication through local policy; no automatic ignore edits. Interrupted writer/failed cleanup may leave empty/partial file. Successful explicit cancel deletes exact runtime reservation.
- Choose recovery/addendum directory ownership/modes fitting sensitivity; `/sh recover` explicit review, never automatic execution.

## Session, cancellation and observed completion

- Persisted source required for native parent lineage. Exclusive reservation rejects same-name collision, never overwrites.
- Configured deferral boundary→terminal completion/cancel protects user replacement/fork/compaction; Finish awaiting transition also protected. Cancellation cleanup additionally guards tree navigation, even before GET, until native writes settle/exact cleanup. Before protection navigation may discard request.
- Canonical `/sh cancel`/menu until `newSession()` commits cutover, incl after Finish. Immediately invalidate request/ID/reminder/retrieval, retain exact ownership through native writes, then cleanup. Foreign files untouched; missing owned file harmless, other errors name path.
- No unrelated-work abort/tool-selection change. Command may await `waitForIdle()`; tool/event returns first, cleans at settlement, never self-waits. Cleanup guards new starts/stale callbacks. One follow-up after cleanup; errors not false success. Escape/response abort no new pause/cancel. No crash/exit restoration or automatic leftover execution/removal. Deferred recovery retained, never auto-replayed.
- One-shot reminder prompts flow completion. Active unsubmitted request first completed turn >=90%: emergency steering stops source work/context gathering, fetches if missing, finalizes, Finish; no independent-work wait. Preserve IDs/files, cancel reminder. No compliance proof/forced abort/reserve guarantee; disabled automatic not activated without request.
- Handoff/recovery delete only associated recovery file after concrete turn actually receiving extension-owned input returns `TurnEndEvent.outcome === "completed"`, not necessarily first recipient turn.
- Error/aborted/rejected/unobserved retain; void send or unrelated later success insufficient. Existing no-queue-option dispatch; busy target can reject. Native completed authoritative, no stop-reason/tool-error veto/new queue/retry/replay/later-run wait.
- Fresh replacement context owns dispatch; receiver runtime owns completion; late sender settlement cannot override observed outcome. Successful handoff releases protection; established terminal failure releases without Finished. Completion not semantic ingestion/receiver cleanup, no unrelated later-work wait.

## Vulnerability reporting

- Privately use trusted channel package received through. Include affected package/Node/Pi versions, minimal reproduction, impact, whether session/recovery exposed. No secrets/private transcripts/recovery contents.
- Metadata links public issue tracker, no private disclosure address. No security-sensitive details in public tracker. Coordinate privately before public details exposing users/data.

## Validation limits

- Corrected source/local candidate passed197tests/typecheck/noUnused/whitespace/package-dry-run/spec-checksum. Dev ranges^1.2.0 resolvePi1.2.0; not Pi1.5 static proof/sandbox audit/adversarial model evaluation.
- Separate realPi1.5/model runs, Handoff only extension: command/manual + model starts; early/repeated GET stable IDs/paths; native write/Finish; parent-linked replacement/full read/retention with delete=false; cancellation cleanup/same-source restart; Writing2prompt unchanged ordered append/later precedence; one-shot reminder; explicit native Recovery inspect/execute/completed-turn deletion.
- Bounded observations only; no guaranteed semantics/authorization preservation/ingestion/cleanup/general model compliance.
- Separate actual Pi1.5 SDK-bound tools, real contexts/no doubles/no model: invalid/stale Finish rejected, active request/path/dossier/session unchanged. Not agent-loop interception/model-compliance test.
- Bounded Pi1.5.2/configured-model smoke: unchanged prepared package; GET/repeatedGET/native write/Finish/parent-linked receiver/full read/delete=true; ordered Writing prompts/later precedence; cancel/restart/active-switch guard/explicit Recovery/completed-turn cleanup. Not full compatibility matrix. First isolated startup unexpectedly downloaded `rg`; own copy removed, existing native helper reused. No Pi/dependency version change.
- Real-model unrun: >=90% emergency, automatic initiation, Request deferral, chain rollover, broad UI; deterministic checks exist. Further host/model/session work separately authorized, not authorized by documentation update.
