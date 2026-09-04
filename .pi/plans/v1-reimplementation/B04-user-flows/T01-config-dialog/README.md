# T01 — In-chat configuration dialog

## Worker result

Given the configuration service, implement `/sh config` as a simple extension-owned select/question loop with one in-memory draft, explicit save, and explicit cancel.

## Allowed result paths

- `extensions/pi-simple-handoff/config-dialog.ts`
- `extensions/pi-simple-handoff/index.ts`
- `test/config-dialog.test.ts`
- `test/extension.test.ts`

## Read first

- `docs/specification.md`: §4 and relevant §13 messages
- accepted config implementation
- installed Pi docs for `ctx.ui.select`, `input`, and `confirm`

## Exclusions

No overlay, custom TUI component, partial persistence, model-context messages, generic form framework, history, or authority-file edits.

## Acceptance

- Setting list shows current draft values and can be revisited in any order.
- Nothing persists before save.
- Save validates the complete draft, confirms missing directories, creates only confirmed paths, and atomically persists.
- Cancel/reload/session replacement discards the draft.
- Dialog questions and answers do not enter model context.
- All user-facing text is clear English.
