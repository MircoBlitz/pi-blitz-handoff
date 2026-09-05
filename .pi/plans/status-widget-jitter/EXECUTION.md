# Status Widget Jitter Fix

## Status

- Mode: Plan mode
- Branch: `fix/status-widget-jitter`
- Planning basis: frozen `docs/specification.md`, user-provided screenshots, Pi 0.84.2 project dependency, and current Pi 0.85.0 runtime behavior
- Plan authorization: granted by the user on 2026-09-05
- Product-code authorization: granted by the user on 2026-09-05 for the approved local fix and validation
- T01 initial implementation: `REWORK` after local visual testing at `388e9ccd588e9780f389e93c3d35460245c9c490`
- Rework authorization: granted by the user on 2026-09-05
- Visual finding: periodic jitter is gone, but real phase changes still reinsert the widget and briefly move it below the Async agents widget
- Release authorization: not yet requested; corrected local visual testing comes first
- Next allowed action: implement persistent in-place widget rendering as a forward commit

## Goal

Keep the persistent Session Handoff widget visually stable while other Pi widgets update, without losing factual terminal duration.

## Confirmed behavior

- Active handoff phases do not update the widget once per second.
- In TUI mode, the Handoff widget is registered once per session and all later state changes update that same component in place.
- The extension reserves its widget slot at session start; when Handoff is loaded before Subagents, the Handoff widget remains above the Async agents widget.
- Non-TUI modes retain their normal string-array status transport.
- Terminal `finished`, `failed`, and `cancelled` status reports the total elapsed duration once.
- Existing status colors and the writer's indeterminate activity indicator remain.
- Session shutdown disposes the reserved widget cleanly.
- No Pi-core patch, compatibility layer, or alternate status surface is introduced.

## Root cause

`pi-blitz-handoff` currently calls `setWidget` every second to refresh elapsed time. Pi 0.84.2 and 0.85.0 implement a widget update by deleting the keyed widget from its placement map and inserting it again. When the Async agents widget also refreshes, both widgets repeatedly exchange insertion order and jump above and below one another.

## Execution

| Task | Result | Paths |
|---|---|---|
| T01 Stable activity widget | Remove periodic updates and use one persistent in-place TUI component while retaining terminal duration and non-TUI transport | `extensions/pi-blitz-handoff/status.ts`, `extensions/pi-blitz-handoff/index.ts`, `test/status.test.ts`, `test/extension.test.ts`, `test/integration.test.ts` |
| T02 Verification and closeout | Run focused status tests and the complete local validation gate; record exact results | `.pi/plans/status-widget-jitter/EXECUTION.md`, `.pi/plans/status-widget-jitter/T01-stable-activity-widget/RESULT.md` |

## Acceptance

1. TUI session startup registers exactly one persistent Handoff widget component, including while its content is empty.
2. Active and terminal phase changes update that component without another `setWidget` call.
3. Active widget text contains no ticking elapsed-seconds value.
4. Terminal status contains the elapsed duration measured from handoff start.
5. Non-TUI status transport remains a string array and does not depend on TUI components.
6. Session shutdown clears the persistent component and its state.
7. Writer activity continues to use the configured indeterminate working indicator.
8. Existing public status, terminal-state precedence, cancellation, and cleanup behavior remain unchanged.
9. `npm test`, `npm run typecheck`, `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`, `git diff --check`, and `npm pack --dry-run` pass on the candidate.

## External validation

After deterministic validation, the user will test the candidate in already-open local Pi sessions that need a refresh. Version bump, GitHub/npm publication, and any non-NAS push occur only after that visual acceptance and immediate target confirmation.
