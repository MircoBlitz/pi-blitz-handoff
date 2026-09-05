# T01 — Deferred prompt persistence

## Worker result

Given the accepted-GO boundary, intercept ordinary user prompts before native replacement, preserve each unchanged in ordered memory, and atomically maintain one recovery Markdown file for that handoff.

## Allowed result paths

- `extensions/pi-blitz-handoff/flow.ts`
- `extensions/pi-blitz-handoff/deferred.ts`
- `extensions/pi-blitz-handoff/recovery-store.ts`
- `extensions/pi-blitz-handoff/index.ts`
- `test/flow.test.ts`
- `test/deferred.test.ts`
- `test/recovery-store.test.ts`
- `test/extension.test.ts`

## Read first

- `docs/specification.md`: §§8, 10–12, 14–15
- accepted B02 implementation
- installed Pi docs for input ordering and command-before-input behavior

## Exclusions

No per-prompt files, parsing/classification, automatic replay, outbox, dispatch state machine, generic queue framework, command interception, marker-collision protocol, history, or authority-file edits.

## Acceptance

- Before GO, ordinary user input remains source-session work.
- After GO, ordinary `input` events are handled and never reach the writer.
- Prompt strings and arrival order remain exact in memory.
- No file exists when no deferred prompt arrived.
- One correctly named file is atomically replaced as prompts arrive with deterministic boundaries.
- Slash commands retain native Pi behavior.
- Exact nonrecursive cleanup helpers affect only the selected recovery file.
