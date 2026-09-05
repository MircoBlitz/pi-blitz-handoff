# T01 Stable Activity Widget

## Basis

- Repository: `/Users/lindworm/development/pi/pi-blitz-handoff`
- Branch: `fix/status-widget-jitter`
- Task basis: planning commit created from `80c99cac7edfce2000d2dcfa557d1015191cfabf`
- Authority: `docs/specification.md` and `.pi/plans/status-widget-jitter/EXECUTION.md`

## Result

Stop periodic reinsertion of the Session Handoff widget while retaining elapsed duration in the one-time terminal status.

## Allowed changes

- `extensions/pi-blitz-handoff/status.ts`
- `test/status.test.ts`
- `test/extension.test.ts`

No other file may be changed, staged, or committed by the writer.

## Required behavior

1. Active status has no per-second timer and no ticking seconds text.
2. Phase changes may update the widget normally.
3. The handoff start time remains available until terminal status is rendered.
4. Finished, failed, and cancelled status includes total elapsed seconds once.
5. Existing colors, writer working indicator, public status semantics, and terminal precedence remain.

## Checks

- `node --test --experimental-strip-types --test-name-pattern="persistent status|writing status|terminal status|finished status" test/status.test.ts test/extension.test.ts`
- `npm run typecheck`
- inspect the complete assigned diff and index before committing

## Stop rule

Return `BLOCK` without inventing behavior if the plan conflicts with the current source or preserving terminal duration requires changes outside the assigned paths.
