# T01 Result

## Outcome

Accepted after visual-feedback rework at `8c1c35a80ddc8457e2cb5b5ebe23ed6e657837cd` against corrected task basis `a6cddaa`.

The initial candidate `388e9ccd588e9780f389e93c3d35460245c9c490` removed periodic updates but still reinserted the widget on real phase changes. Local visual testing classified that candidate as `REWORK`. The accepted forward commit keeps one TUI component for the complete session lifecycle.

## Changes

- Removed periodic one-second widget updates and ticking active duration.
- Registered one persistent TUI widget component at session startup, including while inactive.
- Changed active, phase, terminal, and clear updates to mutate that component in place without another `setWidget` call.
- Kept string-array widget transport for non-TUI contexts.
- Retained one start timestamp across phase changes and one-time elapsed duration for `finished`, `failed`, and `cancelled`.
- Preserved active colors, writer indicator, terminal precedence, and public status semantics.
- Added explicit shutdown disposal for widget and activity state.

## Review

Fresh read-only cumulative review of `a6cddaa..8c1c35a` returned `ACCEPT`.

The reviewer confirmed the TUI registration count stays one across active and terminal transitions, in-place rendering updates correctly, non-TUI arrays remain, shutdown clears state, and the original timer and phase-change regressions are covered.

## Validation

Focused candidate checks:

- status, extension, and integration tests: 27 passed, 0 failed;
- `npm run typecheck`: passed;
- cumulative `git diff --check`: passed.

Full local gate on `8c1c35a80ddc8457e2cb5b5ebe23ed6e657837cd`:

- `npm test`: 98 passed, 0 failed;
- `npm run typecheck`: passed;
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: passed;
- `git diff --check`: passed;
- `npm pack --dry-run`: passed, 23 package files reported.

## Remaining evidence

Automated rigs cannot prove final relative ordering against the live Async agents widget. The user will rerun the visual test with Handoff loaded before Subagents so the reserved Handoff slot is inserted first. Version bump and publication remain pending that acceptance and immediate target confirmation.
