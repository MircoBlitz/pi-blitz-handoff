# Changelog

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
