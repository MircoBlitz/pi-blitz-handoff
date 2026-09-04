# v1.0 Reimplementation Execution

## Status

- Mode: Plan mode
- Branch: `feature/v1.0-rework`
- Planning basis: frozen `docs/specification.md`, current `default.cmpl`, current Pi 0.84.4 public APIs, and recorded user decisions
- Git history: prohibited as implementation context
- Specification status: frozen and approved by the v1.0 reimplementation authorization
- Product-code authorization: granted for B01 through B05
- Real-Pi authorization: not granted; stop before B06/T01
- Accepted through: B01/T02 at `4a4790d8372edb1a1cba9c3cfee7518ff8865915`
- Completed blocks: B01 Foundation
- Next allowed action: execute B02/T01

## Goal

Build the smallest real Pi extension that creates a native parent-linked replacement session, lets the source model decide readiness, writes a self-contained authorization-preserving dossier, carries ordinary post-GO prompts in order, and provides simple configuration and recovery flows.

## Execution order

| Block | Task | Result | Depends on |
|---|---|---|---|
| B01 Foundation | T01 Package and test baseline | Installable TypeScript Pi package with working local test/typecheck commands | Plan approval |
| B01 Foundation | T02 Configuration and managed templates | Validated atomic config plus managed/addendum template resolution | T01 |
| B02 Handoff lifecycle | T01 Initiation and readiness | `/sh`, tool, auto-start, warnings, correlated readiness, retry and invalidation | B01 |
| B02 Handoff lifecycle | T02 Writer and submission | Template-driven writer attempts with isolated tool set and validated submission | B02/T01 |
| B03 Transfer and recovery | T01 Deferred prompt persistence | Ordered in-memory capture plus one atomic recovery file per handoff | B02 |
| B03 Transfer and recovery | T02 Native replacement and cancellation | Private command bridge, native lineage, direct first prompt, cleanup, lifecycle guards | B03/T01 |
| B04 User flows | T01 Configuration dialog | Draft/edit/save/cancel chat configuration | B03 |
| B04 User flows | T02 Recovery dialog and status | List/inspect/execute/discard recovery plus factual status UX | B04/T01 |
| B05 Integration | T01 Public contract and documentation | Integrated public surface, complete deterministic tests, packaging and docs | B04 |
| B06 Real Pi gate | T01 Current-Pi validation | Approved real interactive success/failure walkthrough | B05 and separate approval |

All writer tasks run sequentially. Block completion requires accepted task commits, the block's focused tests, and a narrow integrated review. Final local gate:

```text
npm test
npm run typecheck
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
git diff --check
npm pack --dry-run
```

## Block completion

- **B01:** package loads in the test harness; configuration and template contracts pass.
- **B02:** all three initiation paths reach the same readiness/writer flow; stale answers/submissions do nothing; tools restore after every terminal writer outcome.
- **B03:** ordered prompts survive interruption, successful native replacement records parent lineage, and recovery files remain only when delivery did not complete.
- **B04:** `/sh config`, `/sh recover`, `/sh cancel`, and status behavior match the specification without entering dialog answers into model context.
- **B05:** complete local gate passes on the final commit and documentation describes only verified behavior.
- **B06:** real Pi gate passes only after explicit user authorization; otherwise release remains blocked with that evidence missing.
