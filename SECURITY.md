# Security Policy

For agents: [LLM counterpart](docs/llm/SECURITY.md).

## Supported versions

This policy describes the template-to-Finish contract in the GitHub release of package 2.0.0. npm publication is handled separately by the maintainer; this policy does not establish npm availability. The [product specification](docs/specification.md) is the sole product authority. It requires Node.js 22.19.0 or later and Pi (`@earendil-works/pi-coding-agent`) 1.5.0 or later; package and Pi version numbers are independent. Older package, Node, and Pi versions have not been evaluated against this contract.

## Trust boundary

`pi-blitz-handoff` is a Pi extension and runs with the full operating-system permissions of the Pi process. Installing it is equivalent to trusting its TypeScript code with that access. Pi project trust is not a sandbox for an installed extension.

The extension preserves authorization in its writer instructions: continuation context does not grant new permission, and proposed, paused, or approval-dependent work must remain distinguished from executable work. This is an instruction to the model, not a deterministic semantic guarantee. Finish validates the exact correlation ID supplied by successful template retrieval, not dossier semantics. Before cutover, the extension checks that the handoff file is a nonempty regular file, without reading its dossier. It does not validate NUL absence, Markdown structure, semantic completeness or authorization mistakes.

## Data handled

A handoff can process:

- the persisted source-session transcript path;
- the current working directory and ancestor paths used for project-template lookup;
- the configured handoff template;
- the model-written continuation dossier;
- ordinary interactive or RPC prompt text received from the configured deferral boundary, accepted request or successful template retrieval;
- context-usage and handoff-status information.

The retrieved template instructions and resulting dossier are processed through the configured model in the source session. The source model writes the dossier through Pi's native file tools to `.pi/handoff_<Session-ID>.md` under the current Pi working directory. `session_handoff_finish({ id })` receives only the Finish ID, never dossier content or a path. The extension appends its deferred prompts without reading the dossier and sends a short absolute file reference and ingestion/cleanup instructions as the replacement's first user turn. The receiver's subsequent file reads send the dossier through the configured replacement model. Pi's normal session-persistence behavior applies to native file-tool calls and results in both sessions.

The initial request supplies no transport path or Finish ID. Mandatory `session_handoff_get_template({})` returns the template, exact reserved path, source transcript locator and fresh Finish ID. No handoff may be written before retrieval. Early drafting with unchanged source tools is allowed; repeated retrieval shares the active snapshot, path and ID. No isolated writer, persistent tool snapshot, separate GO, user-choice dialog or automatic writer retry is introduced. Native `write` must already be available. The model refreshes facts, results, permissions and next action before Finish at the safe checkpoint; code does not verify that judgment or completeness. Finish requires successful retrieval and rejects stale/duplicate IDs; idle/no-pending settlement then permits native transition.

`deferPromptsFrom` is `request` or `writing`, default `writing`; settings show **Request** / **Writing (template retrieved)**. Successful retrieval, including early drafting, starts Writing deferral, not the first filesystem write. Failed/aborted GET is not success and does not authorize Finish; its reservation may be reused. The active request retains its chosen mode. Explicit cancellation invalidates retrieval/ID immediately and removes only its exact owned reservation after native writes settle, without aborting unrelated source work. Cancelled/superseded retrieval cannot reserve a late file or return a live ID. Interruption or failed cleanup can leave reserved/partial files.

Deferred prompts are preserved unchanged and in arrival order. When any exist, the extension writes one plaintext Markdown recovery file for the handoff window. It does not inspect prompt contents for secrets, redact them, or encrypt them. Do not place secrets in prompts or handoff context unless the configured model, local session storage, and recovery storage are appropriate for those secrets.

## Filesystem behavior

Global managed data defaults to `<getAgentDir()>/pi-blitz-handoff/`. Project-local transport files live directly at `.pi/handoff_<Session-ID>.md` in the current Pi working directory, without a timestamp. New private directories and files are created with restrictive modes (`0700` directories and `0600` files). Global configuration, project-template assignments, and recovery replacement use ordinary atomic rename-based writes. Cleanup is exact and nonrecursive.

These controls reduce accidental local exposure; they are not a general filesystem security framework. In particular:

- deliberately configured directory symlinks are followed;
- there is no inode or descriptor identity tracking;
- there is no `O_NOFOLLOW` policy;
- existing directory permissions are not tightened;
- handoff, recovery and template content is not encrypted;
- source native file tools remain unchanged and are not a path sandbox; safe-checkpoint, supplied-path and emergency source-work restrictions are model guidance;
- managed-default backups are retained until the user removes them.

**Delete handoff after reading** (`deleteHandoffAfterReading: true`, the default) instructs the receiver to delete the exact handoff file only after successful complete ingestion. When disabled, the file stays unchanged at the same path, increasing local plaintext retention. There is no archive move. Read failures must leave the file unchanged, and cleanup failures must be reported. Neither ingestion nor deletion is verified or performed by the extension. Exclude `.pi/handoff_*.md` from version control and publication according to your local project policy; the extension does not edit Git ignores automatically. Interrupted writers and failed cancellation cleanup may leave empty or partial handoff files for manual inspection; successful explicit cancellation removes the exact runtime-owned reservation.

Choose recovery and addendum-template directories whose ownership and permissions fit the sensitivity of the session data. Review leftover recovery files with `/sh recover`; execution is never automatic.

## Session and recovery safety

A persisted source session is required so the replacement can use Pi's native parent lineage. The extension reserves a project-local handoff transport file, failing visibly rather than overwriting an existing same-name file. From the configured deferral boundary through terminal completion/cancellation, it protects against user replacement, fork and compaction; Finish awaiting transition is also protected. Pending cancellation cleanup additionally blocks tree navigation until native writes settle and exact cleanup concludes, even before template retrieval. Before protection begins, navigation may discard the pending request.

Canonical `/sh cancel` and menu cancellation work until native `newSession()` invocation commits cutover, including after Finish. They invalidate the request, ID, reminder and retrieval immediately; ownership of the exact reservation remains until native writes settle, then cleanup runs. Foreign collision files are never removed; a missing owned file is harmless, other errors name the path. Cancellation does not abort unrelated source work or alter its tool selection. Command paths may await native `waitForIdle()`; tool/event paths return first and clean up at settlement, never awaiting themselves. Cleanup guards new starts and stale callbacks; one follow-up is sent after cleanup, with errors rather than false clean success. Normal response abort/Escape has no new pause/cancel meaning. No crash/exit restoration or automatic leftover execution/removal exists. Deferred prompts are never automatically replayed and their recovery file remains.

A one-shot reminder may prompt template/Finish completion. At the first completed turn at or above 90% context for an active unsubmitted request, one emergency steering instruction stops source work/context gathering, retrieves if needed, finalizes and submits Finish without waiting on independent work. It preserves existing IDs/files and cancels the reminder. Neither instruction proves model compliance, forces abort, guarantees context reserve or enables disabled automatic initiation without a request.

Handoff completion and explicit recovery execution delete only the associated recovery file after the concrete turn receiving the extension-owned input returns native `TurnEndEvent.outcome === "completed"`. That need not be the first recipient turn. Rejected or unobserved delivery, native `error` and `aborted` retain the file; a void send return or a later successful turn does not suffice. Dispatch keeps its existing no-queue-option behavior, including rejection at a busy target. Native completed is used without extra stop-reason or tool-error vetoes. No new queue, retry, replay or later-run wait is added. Fresh replacement context owns dispatch and receiving runtime owns turn completion; late sender-promise settlement cannot overwrite an observed outcome. Successful handoff completion releases transfer protection; established terminal failure releases it without Finished. This observes turn completion, not semantic ingestion or receiver file cleanup, and does not wait for arbitrary later recipient work.

## Reporting a vulnerability

Report security-sensitive findings privately through the trusted channel from which you received this package. Include the affected package, Node, and Pi versions; a minimal reproduction; impact; and whether recovery or session files were exposed. Do not include secret values, private transcripts, or recovery-file contents in the report.

Package metadata links to a public issue tracker but supplies no private disclosure address. Do not post security-sensitive details in that public tracker. Coordinate disclosure privately before publishing details that could expose users or their session data.

## Validation boundary

The corrected source/local candidate passed 197 tests, typecheck, no-unused checks, whitespace checks, package dry-run and specification checksum verification. Development ranges remain `^1.2.0` and resolve Pi 1.2.0; these checks are not Pi 1.5 static compatibility proof, a sandbox audit or an adversarial model evaluation.

Separate real Pi 1.5/model runs with Handoff as the only loaded extension covered command/manual and model starts, early/repeated GET, stable IDs/paths, native writes/Finish, parent-linked replacement, full reads and retention with deletion disabled. They also covered cancellation cleanup and same-source restart, two Writing-mode deferred prompts appended unchanged in order with later-prompt precedence, the one-shot reminder, and explicit native Recovery inspection/execution with completed-turn deletion. This is bounded observed behavior, not a guarantee of semantic completeness, authorization preservation, ingestion, cleanup or general model compliance.

Invalid/stale Finish-ID rejection was tested separately through actual Pi 1.5 SDK-bound tools, real contexts and no doubles or model run. The active request, path, dossier and session remained unchanged after rejection. It was not an agent-loop interception or model-compliance test.

A bounded Pi 1.5.2/configured-model smoke loaded the unchanged prepared package and observed GET/repeated GET, native write/Finish, parent-linked replacement, full reading and deletion enabled, ordered Writing-mode prompts with later-prompt precedence, cancellation/restart, the active-session switch guard and explicit Recovery with completed-turn cleanup. This is not a full compatibility matrix. The first isolated startup unexpectedly downloaded an `rg` helper; that copy was removed and the existing native helper reused. No Pi or dependency version changed.

The >=90% emergency, automatic initiation, Request-mode deferral, chain-limit rollover and broad UI scenarios remain unrun with a real model; deterministic checks exist. Additional real host/model/session work requires separate authorization and is not authorized by this documentation update.
