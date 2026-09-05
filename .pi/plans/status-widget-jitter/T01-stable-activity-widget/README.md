# T01 Stable Activity Widget

## Basis

- Repository: `/Users/lindworm/development/pi/pi-blitz-handoff`
- Branch: `fix/status-widget-jitter`
- Task basis: planning commit created from `80c99cac7edfce2000d2dcfa557d1015191cfabf`
- Authority: `docs/specification.md` and `.pi/plans/status-widget-jitter/EXECUTION.md`

## Result

Stop all TUI reinsertion of the Session Handoff widget after session startup while retaining elapsed duration in the one-time terminal status. This is a forward correction of candidate `388e9ccd588e9780f389e93c3d35460245c9c490` after local visual testing found phase-change movement.

## Allowed changes

- `extensions/pi-blitz-handoff/status.ts`
- `extensions/pi-blitz-handoff/index.ts`
- `test/status.test.ts`
- `test/extension.test.ts`
- `test/integration.test.ts`

No other file may be changed, staged, or committed by the writer.

## Required behavior

1. Active status has no per-second timer and no ticking seconds text.
2. TUI session startup registers one persistent widget component even while inactive.
3. Later active, phase, terminal, and clear updates mutate that component in place and request rendering without another `setWidget` call.
4. Non-TUI contexts continue receiving string-array widget updates.
5. Session shutdown disposes the reserved widget and associated state.
6. The handoff start time remains available until terminal status is rendered.
7. Finished, failed, and cancelled status includes total elapsed seconds once.
8. Existing colors, writer working indicator, public status semantics, and terminal precedence remain.

## Checks

- focused status, extension, and integration tests covering TUI registration count, in-place rendering, non-TUI fallback, shutdown cleanup, and terminal duration
- `npm run typecheck`
- inspect the complete assigned diff and index before committing

## Stop rule

Return `BLOCK` without inventing behavior if the plan conflicts with the current source or preserving terminal duration requires changes outside the assigned paths.
