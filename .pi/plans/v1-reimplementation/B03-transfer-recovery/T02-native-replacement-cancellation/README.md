# T02 — Native replacement and cancellation

## Worker result

Given a settled valid dossier and optional deferred prompts, use one private correlated command bridge to call native `ctx.newSession({ parentSession })`, deliver the assembled Markdown as the fresh linked session's first user turn, and enforce the defined cancellation/lifecycle boundaries.

## Allowed result paths

- `extensions/pi-simple-handoff/flow.ts`
- `extensions/pi-simple-handoff/transition.ts`
- `extensions/pi-simple-handoff/deferred.ts`
- `extensions/pi-simple-handoff/index.ts`
- `extensions/pi-simple-handoff/status.ts`
- `test/flow.test.ts`
- `test/transition.test.ts`
- `test/deferred.test.ts`
- `test/status.test.ts`

## Read first

- `docs/specification.md`: §§10–11, 13–15
- accepted B02 and B03/T01 code/tests
- installed Pi docs for command context, replacement lifecycle, `withSession`, and session guards

## Exclusions

No public transition command, transport file, parallel scheduler, replacement simulation, post-`newSession` cancellation, elaborate race protocol, history, or authority-file edits.

## Acceptance

- Bridge is private, correlated to current state, and is not a fourth initiation path.
- Assembly is deterministic; no empty deferred section; deferred entries are described as sequential later user inputs.
- First line remains the writer's meaningful title.
- `parentSession` is the exact source path and replacement starts from the complete first user prompt.
- Recovery file is deleted only after replacement accepts the prompt and transition succeeds.
- `/sh cancel` works before native replacement and preserves recovery; cutover is committed once `newSession` starts.
- User switch/fork/compaction are blocked only for the specified protected phase; extension replacement is allowed.
- Late IDs, timers, and callbacks are harmless.
