# T01 — Public contract, integration, and documentation

## Worker result

Given accepted feature blocks, prove the complete public deterministic contract through integrated tests, finalize package metadata, and document only behavior verified on the candidate commit.

## Allowed result paths

- `package.json`
- `package-lock.json`
- `README.md`
- `SECURITY.md`
- `test/integration.test.ts`
- `test/public-contract.test.ts`
- `test/package.test.ts`

## Read first

- complete approved `docs/specification.md`
- all accepted task results and current public implementation
- package metadata and root template

## Exclusions

No behavior changes in extension source. Any discovered source defect is `BLOCK` and becomes a separately scoped forward FIX task. No GitHub CI, publication, real-model invocation, Git history, or authority-file edits.

## Acceptance

- Only `/sh`, `/sh cancel`, `/sh recover`, `/sh config`, and `blitz_handoff` are public.
- Package contains required runtime files and excludes local/test artifacts.
- Documentation is English and matches verified current behavior.
- Full local gate passes on the unchanged candidate commit.
- Success, explicit rejection/failure, cancellation, and recovery paths have correctly classified evidence.
