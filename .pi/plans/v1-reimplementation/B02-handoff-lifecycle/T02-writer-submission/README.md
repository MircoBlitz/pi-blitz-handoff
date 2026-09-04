# T02 — Writer and submission

## Worker result

Given accepted readiness, run the configured number of template-driven writer attempts in the source session with only `submit_session_handoff` active, accept exactly one correlated dossier, and restore the prior tool list on every terminal outcome.

## Allowed result paths

- `extensions/pi-simple-handoff/flow.ts`
- `extensions/pi-simple-handoff/writer.ts`
- `extensions/pi-simple-handoff/submission-tool.ts`
- `extensions/pi-simple-handoff/index.ts`
- `test/flow.test.ts`
- `test/writer.test.ts`
- `test/submission-tool.test.ts`

## Read first

- `docs/specification.md`: §§5, 7, 9, 13–15
- `default.cmpl`
- accepted B02/T01 implementation and tests
- installed Pi docs for active tools, tool termination, user-message delivery, and `agent_settled`

## Exclusions

No Markdown parser, title sanitizer, dossier byte cap, embedded fallback, extra continuation turn, replacement, recovery, history, or authority-file edits.

## Acceptance

- Each attempt resolves the current template anew and reports failed tiers.
- Prompt includes complete template, exact submission ID, and exact source transcript path.
- Submission validates only current ID, nonempty content, and NUL absence.
- Attempt count includes the first and delays use config exactly.
- Success waits for the writer run's settled boundary.
- Cancellation, success, exhaustion, and terminal failure restore the exact saved active tools.
