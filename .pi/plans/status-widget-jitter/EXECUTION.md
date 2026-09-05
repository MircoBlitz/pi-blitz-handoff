# Status Widget Jitter Fix

## Status

- Mode: Plan mode
- Branch: `fix/status-widget-jitter`
- Planning basis: frozen `docs/specification.md`, user-provided screenshots, Pi 0.84.2 project dependency, and current Pi 0.85.0 runtime behavior
- Plan authorization: granted by the user on 2026-09-05
- Product-code authorization: granted by the user on 2026-09-05 for the approved local fix and validation
- T01 implementation: accepted at `388e9ccd588e9780f389e93c3d35460245c9c490`
- Local validation gate: passed on `388e9ccd588e9780f389e93c3d35460245c9c490`
- Visual validation: pending user test in refreshed local Pi sessions
- Release authorization: not yet requested; local visual testing comes first
- Next allowed action: user performs local visual validation

## Goal

Keep the persistent Session Handoff widget visually stable while other Pi widgets update, without losing factual terminal duration.

## Confirmed behavior

- Active handoff phases do not update the widget once per second.
- Active status changes only on real handoff phase changes.
- Terminal `finished`, `failed`, and `cancelled` status reports the total elapsed duration once.
- Existing status colors and the writer's indeterminate activity indicator remain.
- No Pi-core patch, compatibility layer, or alternate status surface is introduced.

## Root cause

`pi-blitz-handoff` currently calls `setWidget` every second to refresh elapsed time. Pi 0.84.2 and 0.85.0 implement a widget update by deleting the keyed widget from its placement map and inserting it again. When the Async agents widget also refreshes, both widgets repeatedly exchange insertion order and jump above and below one another.

## Execution

| Task | Result | Paths |
|---|---|---|
| T01 Stable activity widget | Remove periodic widget reinsertion while retaining one terminal duration calculation and current status semantics | `extensions/pi-blitz-handoff/status.ts`, `test/status.test.ts`, `test/extension.test.ts` |
| T02 Verification and closeout | Run focused status tests and the complete local validation gate; record exact results | `.pi/plans/status-widget-jitter/EXECUTION.md`, `.pi/plans/status-widget-jitter/T01-stable-activity-widget/RESULT.md` |

## Acceptance

1. An active handoff creates or updates its widget only when the handoff state actually changes.
2. Active widget text contains no ticking elapsed-seconds value.
3. Terminal status contains the elapsed duration measured from handoff start.
4. Writer activity continues to use the configured indeterminate working indicator.
5. Existing public status, terminal-state precedence, cancellation, and cleanup behavior remain unchanged.
6. `npm test`, `npm run typecheck`, `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `git diff --check`, and `npm pack --dry-run` pass on the candidate.

## External validation

After deterministic validation, the user will test the candidate in already-open local Pi sessions that need a refresh. Version bump, GitHub/npm publication, and any non-NAS push occur only after that visual acceptance and immediate target confirmation.
