# T01 Result

## Outcome

Accepted after two real-TUI feedback corrections at `56ca7711acbd94da2074c65493b36fb3e4c7eb1b` against corrected task basis `a6cddaa`.

- `388e9ccd588e9780f389e93c3d35460245c9c490` removed periodic updates but still reinserted the widget on real phase changes: `REWORK`.
- `8c1c35a80ddc8457e2cb5b5ebe23ed6e657837cd` kept one persistent component but ignored `render(width)`, causing Pi to exit at terminal width 75 when visible line width reached 79: `REWORK`.
- `56ca7711acbd94da2074c65493b36fb3e4c7eb1b` retains the persistent component and applies Pi TUI's ANSI-aware `truncateToWidth()` on every render: `ACCEPT`.

## Final behavior

- No periodic one-second widget update or ticking active duration.
- One persistent TUI widget registration at session startup, including while inactive.
- Active, phase, terminal, and clear updates mutate the same component without another `setWidget` call.
- Every rendered status line is truncated to the supplied terminal width with ANSI styling preserved.
- Non-TUI contexts retain string-array widget transport.
- One start timestamp survives phase changes; terminal `finished`, `failed`, and `cancelled` status reports total duration once.
- Existing colors, writer indicator, terminal precedence, public status, and shutdown cleanup remain.

## Dependency truth

- Peer dependency: `@earendil-works/pi-tui: "*"`.
- Development dependency: `@earendil-works/pi-tui: "^0.84.2"`.
- Lockfile root matches the manifest and resolves 0.84.4 for local validation.

## Review

Fresh read-only cumulative review of `a6cddaa..56ca771` returned `ACCEPT`.

The reviewer confirmed the width regression fails against `8c1c35a` at width 75 and passes on the final candidate at widths 0, 1, 20, and 75. Persistent registration, in-place updates, non-TUI fallback, terminal duration, and cleanup remain covered.

## Validation

Final candidate evidence:

- focused status/extension/integration/package tests: 32 passed, 0 failed;
- complete `npm test`: 99 passed, 0 failed;
- `npm run typecheck`: passed;
- `npx tsc --noEmit --noUnusedLocals --noUnusedParameters`: passed;
- `git diff --check`: passed;
- `npm pack --dry-run`: passed, 23 package files reported;
- reviewer observed a clean worktree and index.

## Real-TUI acceptance

The user confirmed the final candidate remains visually stable with Handoff loaded before the Async agents widget and does not reproduce the terminal-width crash. Version 1.0.1 and publication to GitHub and npm were then explicitly authorized.
