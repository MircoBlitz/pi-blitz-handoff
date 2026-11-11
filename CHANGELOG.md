# Changelog

For agents: [LLM counterpart](docs/llm/CHANGELOG.md).

## 2.0.0 — 2026-11-11

GitHub release with source, version tag and package archive. npm publication is handled separately by the maintainer; this entry does not establish npm availability. Package 2.0.0 marks breaking protocol, custom-template, settings and UI changes; it is independent of the supported Pi version. Requires Pi >=1.5.0 and Node.js >=22.19.0.

### Changed

- Replaced GO/DONE with request → mandatory `session_handoff_get_template({})` → drafting → `session_handoff_finish({ id })`. The initial request contains no path or Finish ID. GET supplies the template, exact reserved file, transcript locator and fresh Finish ID; repeated GET reuses the active snapshot/path/ID. Finish accepts only that ID, not content or a path, and rejects missing retrieval, stale and duplicate submissions.
- Custom templates remain supported, but cannot remove the mandatory retrieval/Finish rules. Transfer happens at the next safe checkpoint, not whole-task completion; independent background work need not finish. Early drafting uses unchanged source tools, without isolation, another writer round or automatic writer retries. A pending selected Call is delivered once through early GET or emergency steering when needed.
- Added **Defer prompts from** (`deferPromptsFrom`): **Writing (template retrieved)** by default, or **Request**. The active request retains its chosen mode. Successful GET starts Writing capture; failed/aborted GET does not. Deferred prompts remain unchanged and ordered in one recovery file and are appended before native cutover; later prompts may supersede earlier context.
- Native completion and associated recovery deletion track the exact turn actually receiving bootstrap or Recovery input, even when it is not the first recipient turn. Only native `completed` counts; error, abort, rejected or unobserved delivery retains recovery. Completion does not verify ingestion or receiver cleanup; no queue, retry or extra semantic veto was added.
- Cancellation invalidates retrieval/Finish immediately and removes only the runtime-owned reservation after native writes settle, without aborting unrelated work or changing source tools. Same-source restart is supported; recovery remains explicit. Status uses the current native theme, width-safe rendering and fixed recorded durations.

### Removed and compatibility

- Removed separate GO/DONE tools, the **Ready / Wait / Cancel** choice, and `prepareWhileWaiting`, `writerAttempts` and `writerRetryDelaySeconds`. Canonical `/sh cancel`, menu cancellation and the one-shot `readinessRetrySeconds` reminder remain.
- Recognized previous saved settings are validated and normalized only in memory, with missing deferral mode defaulting to `writing`; retained values must validate, and unknown keys/invalid shapes remain errors. Loading does not rewrite personal configuration. Explicit settings saves use the supported schema. This is load compatibility, not old protocol compatibility.

### Validation and limits

- Corrected source/local candidate: 197 passing tests, typecheck, no-unused checks, whitespace checks, package dry-run and specification checksum verification. Development dependencies remain `^1.2.0`, resolving Pi 1.2.0; these checks are not Pi 1.5 static proof.
- Real Pi 1.5/model runs with Handoff alone covered command/manual and model starts, early/repeated GET with stable IDs/paths, native writes/Finish, parent-linked replacements, full reads and configured retention (`deleteHandoffAfterReading: false`). Also observed cancellation cleanup/restart, two Writing-mode deferred prompts appended unchanged in order with later-prompt precedence, the one-shot reminder, and explicit native Recovery inspection/execution/completed-turn deletion.
- Separate actual Pi 1.5 SDK-bound tool calls with real contexts, no doubles and no model rejected invalid/stale Finish IDs without changing the active request, path, dossier or session. Not agent-loop interception or model-compliance proof.
- A bounded Pi 1.5.2/configured-model smoke loaded the unchanged prepared package and observed GET/repeated GET, native write/Finish, parent-linked replacement, full reading and deletion enabled, ordered Writing-mode prompts with later-prompt precedence, cancellation/restart, the active-session switch guard and explicit Recovery with completed-turn cleanup. This is not a full compatibility matrix. The first isolated startup unexpectedly downloaded an `rg` helper; that copy was removed and the existing native helper reused. No Pi or dependency version changed.
- Real-model >=90% emergency, automatic initiation, Request-mode deferral, chain-limit rollover and broad UI scenarios remain unrun; deterministic checks exist. No universal model-compliance, lossless-transfer or extension-verified ingestion/cleanup claim.

## 1.4.2 — 2026-10-21

### Added

- A fixed 90% emergency limit for a requested handoff still waiting for model GO. At the next completed turn it sends one urgent, model-visible steering instruction to stop source-task work and call the existing correlated GO immediately, rather than treating the UI warning as a model instruction. It cancels the normal reminder timer and preserves explicit user Wait, GO/DONE separation and the normal automatic-attempt budget. No real-model compliance or remaining-capacity guarantee is claimed.

## 1.4.1 — 2026-10-21

### Fixed

- Cancelling a handoff removes its runtime-owned file reservation and draft, including optional pre-GO preparation and the interval after DONE before native cutover. A subsequent handoff in the same source session no longer collides with the cancelled attempt's file. Existing unrelated files and deferred-prompt recovery files remain untouched; cleanup failures report the affected path.

### Changed

- Added the shared pi-blitz logo and repository standard. Functional tests and Pi working documents are now ignored local maintainer files rather than public repository content. The npm package continues to exclude them. The new release is published without private checkpoint commits; existing public history is unchanged.

### Validation limits

- Local functional checks cover cancellation before GO, during writing and after DONE before native cutover, same-session restart, collision protection, recovery retention and cleanup errors. No real-model/Pi-session end-to-end validation was performed for this fix.

## 1.4.0 — 2026-10-16

### Added

- Optional **Prepare while waiting** (`prepareWhileWaiting`, default `false`) and pre-GO `session_handoff_get_template({ key })` retrieval for drafting during genuine waiting. Prepared handoffs retain one template snapshot, file and first submission ID; finalization does not resend the template. Skipping retrieval keeps the normal after-GO writer path.
- **Delete handoff after reading** (`deleteHandoffAfterReading`, default `true`): the receiver is instructed to delete the exact file only after complete ingestion. When disabled, the file remains unchanged at the same path; there is no archive move.

### Changed

- The Handoff default now separates a reference-only historical paragraph (topic/task, session ID and known entry point) from positive continuation context. History is loaded only for a concrete unresolved need; current constraints, active skills and consequential results stay inline. Starting lines must be established, not invented. Both parts remain in one handoff file; this is model guidance, not verified compression or retrieval behavior.
- The source writes its dossier with native file tools to `.pi/handoff_SESSID.md` using only the native source-session ID, without a timestamp or additional subdirectory. Exclusive reservation rejects collisions. The replacement's first prompt references the absolute path, not the full dossier.
- GO confirms only the safe boundary and starts prompt deferral. Separate DONE via `submit_session_handoff({ id })` confirms file finalization; only DONE plus the native settled boundary permits replacement. The submission tool no longer accepts content or a path.
- The extension checks nonempty regular-file metadata and appends its own deferred prompts without reading or parsing the dossier. The receiver is instructed to apply normal startup/basic skills, read the whole file past tool truncation and clean up only after complete ingestion. Failed/incomplete ingestion leaves the file unchanged; cleanup errors must be reported.
- Development and deterministic validation now use Pi 1.2.0 with updateable `^1.2.0` ranges. Host-provided packages use native wildcard peers without bundling. Test doubles now carry `agent_settled.aborted` and use `ExtensionToolContext`; no production API workaround or lifecycle redesign was needed.
- The two defaults now describe optional preparation and file writing while retaining the V2 dossier structure. Writer tools are native `read`, `write`, `edit` and DONE, then restored exactly. Older exact configs receive the two new boolean defaults in memory without automatic migration; both settings apply immediately.

### Fixed

- An aborted early GET no longer suppresses a template that was never returned. After GO the writer resolves and sends its normal template while reusing any existing reservation, avoiding a same-name collision.

### Validation limits

- Dossier correctness, complete ingestion and receiver cleanup remain model responsibilities, not extension-verified guarantees. Prepare while waiting has no guaranteed acceleration and adds accepted GO/DONE calls/turns, not an artificial wait.
- Deterministic local tests cover the new transport and protocol. No real-model/Pi-session end-to-end validation has been performed for this feature; earlier Real-Pi evidence covers only the earlier contracts.

## 1.3.1 — 2026-10-12

### Added

- Unified themed terminal overlays for the main menu, settings, project templates, recovery and complete prompt inspection, help, and **Ready / Wait / Cancel**.
- Native `/sh` argument completion with short descriptions and prefix filtering.
- `/sh start` for requesting a handoff directly.

### Changed

- `/sh` opens the handoff menu instead of starting immediately. The first action is **Start handoff**, or **Cancel handoff** while a handoff is active; Escape closes without action.
- Dialog presentation is consistent across the extension. Existing direct subcommands, RPC dialogs, immediate settings persistence and handoff lifecycle remain unchanged.
- The default Call Template now explicitly separates readiness from handoff writing: no handoff or continuation file during readiness; after GO, wait for the writer instruction with the Handoff Template and submission ID. This is model guidance, not a technical write block. The V2 Handoff Template remains unchanged.

## 1.3.0 — 2026-10-09

### Changed

- **V2 is the new default Handoff Template.** The unchanged reviewed template replaces the previous default as `handoff_default.cmpl`. It records the actual working mode, commissioned work, continuing permissions, current state, active skills and evidence limits. The replacement handles deferred prompts first, then resumes the dialogue or performs authorized work without a previous-session recap. These are model instructions, not a lossless-transfer guarantee.
- The package ships exactly two templates: the unchanged `call_default.cmpl` and the V2 `handoff_default.cmpl`.
- All public commands now use `/sh` with subcommands: `help`, `cancel`, `recover`, `settings` and `project-template`. `/sh settings` replaces `/sh config`; the status widget now points to `/sh cancel`.
- Every confirmed settings change is validated, saved and applied immediately. Escape discards only an unconfirmed input or closes the dialog without undoing saved changes. There is no overall Save/Cancel step.

### Added

- Configurable maximum session chain length in `/sh settings`, default 25 including the master. At the limit, the next handoff starts an independent master with the same continuation context. Native persisted lineage keeps the count accurate across resume and reload; old sessions remain untouched.

### Removed

- Fast, Balanced and local development template variants from the product.
- Hyphenated `/sh-*` commands and the `/sh config` subcommand, without compatibility aliases.

### Upgrade notes

- Stored settings retain their existing paths and format. Custom managed and addendum templates, project assignments, fallback resolution and managed backups remain supported.
- Loading the package updates the managed default with a backup when needed, but does not delete other user-owned templates or rewrite existing selections. To adopt V2 when another template is selected, choose `handoff_default.cmpl` in `/sh settings` and check any project override or same-name addendum template.

### Validation

- Deterministic tests cover the shipped default pair, V2 text instructions, the new command surface, immediate settings persistence and native chain-limit inputs. They are not end-to-end Real-Pi validation of every template behavior.
- Native master rollover was confirmed in Real-Pi on 2026-09-30 with an isolated limit of 10 at the end of an existing 10-session chain. The replacement had no parent reference and waited as instructed; the global default stayed 25. See [validation scope and evidence](docs/session-chain-validation.md).

## 1.2.4 — 2026-09-12

### Added

- Added a repository-hosted two-image sequence from one successful run, showing autonomous startup and continued authorized work in the fresh session without adding the screenshots to the npm package.

### Changed

- Clarified the extension's sole purpose: capture continuation context more precisely than compaction and pass it as the first prompt to a fresh, natively linked Pi session. Existing user instructions, workflows, and templates determine how work continues.

## 1.2.3 — 2026-09-10

### Changed

- The one-shot readiness reminder now reapplies the selected Call Template instead of imposing a separate hard-coded work-boundary policy.
- Removed duplicated source-task stopping language from the Fast and Balanced Handoff Templates; turn-local writer control remains solely extension-owned.

## 1.2.2 — 2026-09-10

### Changed

- Managed template backups now live in the nonrecursive `templates/backups/` subdirectory so they cannot appear in template selection.

### Fixed

- Scoped extension-owned writer control to the current writer turn so it cannot be transferred as a user instruction that stops authorized autonomous continuation.

## 1.2.1 — 2026-09-10

### Added

- Added paired Fast and Balanced Call and Handoff Template profiles alongside the existing Precise defaults.

### Changed

- Fast prioritizes a condensed indexed handoff without a previous-session recap; Balanced transfers more context initialization to the replacement session while retaining a brief re-entry summary.
- Every shipped profile now tells an autonomously continuing replacement to perform the next work instead of merely announcing continuation.

## 1.2.0 — 2026-09-10

### Added

- Added `/sh-project-template` for project-directory-specific Call and Handoff Template assignments.
- Added independent nearest-ancestor discovery per template role, with explicit `<Autodiscover>` and `<Default>` selections.

### Changed

- Project-template selections persist immediately per confirmed role; selecting `<Autodiscover>` for both roles removes the exact assignment.
- Automatic handoffs now permit only direct readiness so an extension-owned choice cannot stop autonomous continuation.
- Handoff templates are resolved again when each writer attempt starts, allowing intentional live template updates.
- The default dossier records session-specific operational runtime state separately from its cumulative skill inventory and requires every replacement session to begin with a concise re-entry summary.

### Fixed

- Invalid or unreadable project-template assignments now warn once and use genuinely resolved role defaults without automatic repair.
- Cancelled deferred-readiness selections no longer retain their pending Handoff Template selection.

## 1.1.3 — 2026-09-08

### Fixed

- Clear the completed handoff widget when the replacement session starts its next agent run.
- After cancellation, explicitly release the model from any earlier readiness or writer instruction.

### Changed

- Moved packaged and development templates from the repository root into `templates/`.
- Promoted the validated development dossier template to the shipped default, including cumulative loaded-skill transfer and a concise user re-entry summary when the replacement waits for input.
- Expanded the package description to identify template-guided readiness checks and handoff dossiers.

### Removed

- Removed the obsolete packaged `default.cmpl` compatibility template.
- Removed the `*_next.cmpl` development variants from version control and package contents; local ignored copies remain available for future iteration.

## 1.1.2 — 2026-09-08

### Fixed

- Use the standard single-extension package layout so Pi displays the installed extension as `pi-blitz-handoff` without a redundant resource suffix.

## 1.1.1 — 2026-09-08

### Fixed

- Detect automatic-handoff thresholds at completed turn boundaries so autonomous continuation cannot postpone initiation until user interaction.
- Allow one final automatic attempt at the critical-warning threshold after an unsuccessful first attempt, with the two-attempt limit preserved across reloads and reset after successful compaction.

## 1.1.0 — 2026-09-06

### Added

- Added correlated `session_handoff_go` and `session_handoff_go_with_user_deferral` readiness tools.
- Added an extension-owned **Ready / Wait / Cancel** choice with a model-supplied reason for genuinely active user collaboration.
- Added separate managed and configurable `call_default.cmpl` and `handoff_default.cmpl` templates.
- Added a factual deferred-input count and separate wait/handoff timing to the persistent status widget.

### Changed

- Replaced repeated exact-text `GO` / `NOT-YET` readiness prompts with one Call Template, one keyed decision, and at most one configured-delay silent re-evaluation turn.
- Readiness now waits only for genuinely in-flight work. Future tasks and ordinary resumable questions are not blockers, and direct GO is preferred when user deferral is uncertain.
- Selecting **Wait** suspends the reminder, keeps normal input available, and displays `Awaiting User GO · Tell your LLM to start when ready` until the user authorizes direct GO or cancels.
- `readinessRetrySeconds` now controls the delay before the single deadlock-prevention reminder rather than a repeated retry loop.
- Both configured template roles are checked at startup and whenever configuration opens; failed non-default selections visibly fall back to their role defaults, while an unresolved role default fails visibly.
- The status widget now advertises canonical `/sh-cancel`; spaced `/sh cancel` remains accepted.

### Compatibility

- Existing exact configurations lacking only `callTemplate` receive `call_default.cmpl` in memory without automatic file migration.
- Existing `handoffTemplate: "default.cmpl"` remains supported as the compatible legacy dossier-template name.

## 1.0.1 — 2026-09-05

### Fixed

- Stabilized the persistent status widget and made its rendering terminal-width-safe.

## 1.0.0 — 2026-09-05

### Added

- Added structured handoff dossiers into fresh, natively linked Pi sessions with source-session lineage.
- Added manual `/sh`, model-callable `blitz_handoff`, and optional context-threshold initiation.
- Added deterministic deferred-input capture, one-file recovery persistence, and explicit recovery actions.
- Added in-chat configuration, managed dossier templates, readiness and writer retries, and context warnings.
- Added persistent lifecycle status, cancellation, and guards against conflicting session changes during transfer.
