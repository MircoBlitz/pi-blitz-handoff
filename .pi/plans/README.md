# pi-blitz-handoff Plan Contract

## Authority

The user-approved `docs/specification.md` governs product behavior once frozen. `default.cmpl` governs the built-in writer dossier. Current user decisions and repository instructions remain authoritative.

The orchestrator owns:

- `docs/specification.md` and `docs/specification.sha256`;
- `default.cmpl`;
- `.pi/` plan and control files;
- product, UX, authorization, security, scope, release, and publication decisions.

Workers and reviewers may read those files but must not modify them. They must not inspect Git history, other branches, old commits, or reflogs. The sole historical-file exception (`default.cmpl`) has already been performed by the orchestrator and grants no continuing history access.

## Worker findings

A worker may report a useful detail that the specification does not spell out. The orchestrator classifies it:

1. **Clearly implied detail:** local implementation choice, no material change to public behavior, UX, authorization, security, data lifecycle, or scope. The orchestrator may approve it.
2. **Material or uncertain decision:** stop and ask the user.
3. **Contradiction or unnecessary expansion:** reject it.

Workers never rewrite the specification to make their implementation fit. Missing context means `BLOCK`, not invention. Escalation goes to the orchestrator; the orchestrator asks the user when the decision is material or uncertain.

## Execution

- No worktrees.
- Use the current feature branch and sequential writer tasks; central extension files intentionally overlap between later tasks.
- Before each worker: record current basis commit, verify an empty index, verify assigned paths contain no foreign changes, and materialize the task's exact read index.
- Each worker changes and stages only assigned paths, checks the complete assigned diff and full index, and commits one coherent result.
- Each candidate receives one fresh, narrow, read-only review against its task contract and cumulative task diff.
- Corrections are forward commits; no history rewriting.
- The orchestrator updates `EXECUTION.md`, `RESULT.md`, and `RUN-HISTORY.jsonl` after decisions.
- Product documentation is written only from implemented and verified behavior.
- Real-Pi validation, publication, and non-NAS pushes require their own explicit user approval.

## Design bias

KISS governs implementation. Use Pi's public lifecycle, session, tool, input, and UI APIs directly. Add code only for required behavior or a clear recurring UX benefit. Do not create a parallel scheduler, generic queue framework, transport subsystem, filesystem-security framework, compatibility layer, or speculative edge-case machinery.
