# Changelog

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
