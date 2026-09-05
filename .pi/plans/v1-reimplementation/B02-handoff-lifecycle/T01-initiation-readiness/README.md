# T01 — Initiation and readiness

## Worker result

Given valid configuration, make `/sh`, `blitz_handoff start`, and optional automatic initiation enter one pending handoff and use the correlated GO/NOT-YET readiness exchange only at settled, no-pending boundaries.

## Allowed result paths

- `extensions/pi-blitz-handoff/index.ts`
- `extensions/pi-blitz-handoff/flow.ts`
- `extensions/pi-blitz-handoff/readiness.ts`
- `extensions/pi-blitz-handoff/public-tool.ts`
- `extensions/pi-blitz-handoff/status.ts`
- `test/extension.test.ts`
- `test/flow.test.ts`
- `test/readiness.test.ts`
- `test/status.test.ts`

## Read first

- `docs/specification.md`: §§3, 6–7, 13–15
- current config and entrypoint
- installed Pi extension docs for `input`, `agent_settled`, pending messages, context usage, commands, and tools

## Exclusions

No writer, deferred capture, replacement, recovery dialog, command interception framework, Git history, or authority-file edits.

## Acceptance

- A second start is visibly rejected without replacing active IDs/state.
- Explicit starts ignore thresholds; automatic start obeys its enable flag and threshold.
- Readiness begins only at the specified settled/no-pending boundary.
- Every attempt has fresh unpredictable GO and NOT-YET IDs; only exact current GO advances.
- Ordinary input invalidates active IDs and passes unchanged; steering/follow-up are recognized.
- One retry timer replaces polling; stale callbacks do nothing.
- Persisted source-session prerequisite is enforced visibly.
