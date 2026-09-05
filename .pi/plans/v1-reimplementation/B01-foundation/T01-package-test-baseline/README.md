# T01 — Package and test baseline

## Worker result

Given an empty implementation tree, create an installable Node 22/TypeScript Pi package whose test and typecheck commands execute successfully and whose extension entrypoint can be loaded by a focused test harness.

## Allowed result paths

- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `.gitignore`
- `extensions/pi-blitz-handoff/index.ts`
- `test/extension-harness.ts`
- `test/package.test.ts`

## Read first

- `docs/specification.md`: §§2, 14, 15
- `.pi/plans/README.md`
- this task

## Exclusions

No product behavior beyond a real loadable entrypoint. No CI, runtime simulation, compatibility layer, Git history, specification, template, or plan edits.

## Acceptance

- Node and Pi dependency floors match the specification.
- Package includes the extension and root `default.cmpl`.
- The harness uses focused adapters rather than a second fake Pi runtime.
- `npm test`, `npm run typecheck`, strict unused-symbol typecheck, and `npm pack --dry-run` execute.
- One coherent worker commit contains only allowed paths.
