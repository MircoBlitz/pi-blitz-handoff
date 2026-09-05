# T02 — Configuration and managed templates

## Worker result

Given the package baseline and an agent directory, load validated defaults/configuration, atomically save complete configuration, create confirmed directories with restrictive modes, synchronize the shipped managed default, and resolve the configured template through the specified three-tier fallback.

## Allowed result paths

- `extensions/pi-blitz-handoff/config.ts`
- `extensions/pi-blitz-handoff/filesystem.ts`
- `extensions/pi-blitz-handoff/templates.ts`
- `extensions/pi-blitz-handoff/index.ts`
- `test/config.test.ts`
- `test/filesystem.test.ts`
- `test/templates.test.ts`
- `test/package.test.ts`

## Read first

- `docs/specification.md`: §§4–5, 14–15
- `default.cmpl`
- B01/T01 result and current entrypoint/harness

## Exclusions

No config dialog, handoff lifecycle, generic filesystem hardening, inode tracking, recursive cleanup, embedded template, history, or control-file edits.

## Acceptance

- Defaults and every validation boundary match the specification.
- Directory symlinks remain valid.
- Managed default equal/missing/different behavior and timestamped backup pass.
- Catalogue is nonrecursive; addendum shadow and deduplicated fallback pass.
- Atomic config writes and exact nonrecursive operations have executable tests.
- Full B01 tests and typecheck pass.
