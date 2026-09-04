# T02 — Recovery dialog and status

## Worker result

Given leftover recovery files, implement `/sh recover` for one-file-at-a-time list, inspect, execute, and discard actions, and finish the concise chat/tool/persistent status surface.

## Allowed result paths

- `extensions/pi-simple-handoff/recovery-dialog.ts`
- `extensions/pi-simple-handoff/status.ts`
- `extensions/pi-simple-handoff/flow.ts`
- `extensions/pi-simple-handoff/index.ts`
- `extensions/pi-simple-handoff/public-tool.ts`
- `test/recovery-dialog.test.ts`
- `test/status.test.ts`
- `test/extension.test.ts`
- `test/flow.test.ts`

## Read first

- `docs/specification.md`: §§3, 11–13
- accepted recovery store, transition, and config dialog code/tests
- installed Pi docs for dialog UI, `sendUserMessage`, and status UI

## Exclusions

No per-prompt selection, automatic replay, pending/dispatching/outbox protocol, overlay, generic progress fractions, history, or authority-file edits.

## Acceptance

- List includes every leftover file and date; unreadable files are reported and retained.
- Inspect shows complete content without mutation.
- Execute sends one combined turn preserving boundaries and sequential-input instruction, then deletes after no immediate dispatch error.
- Discard deletes only the selected file; return/cancel are nonmutating.
- Persistent states and failure/cancellation overrides match the specification.
- `simple_handoff status` is concise and factual.
- All user-facing text is English.
