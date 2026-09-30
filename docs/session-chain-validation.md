# Session-chain rollover validation

## Real-Pi check — 2026-09-30

Mirco requested a visible right-hand Herdr pane, resumption at the end of a long existing session chain, and one actual session handoff. He confirmed the result with “funktioniert”.

- **Implementation:** commit `1e57e0a`, using the production handoff implementation unchanged.
- **Source:** an existing persisted project chain containing 10 sessions, including its master; source session ID `01a07f13-097b-712d-b2df-34f3ab9530ea`.
- **Test configuration:** an explicitly identified test loader supplied isolated project-local handoff storage with `maxSessionChainLength=10`. It did not modify global configuration. The product default remained 25.
- **Execution:** the resumed model accepted the handoff request, used the correlated GO and writer protocol, and performed a native session replacement. No transition was mocked and no session chain was synthesized.
- **Observed replacement:** session ID `01a0f3e3-f6d2-754a-8cae-0aaf79bd77b4`, created at `2026-09-30T19:56:38.482Z`. Its persisted native session header contained no `parentSession` field.
- **Observed continuation:** the replacement delivered its re-entry summary, identified the master-rollover test, and waited for Mirco as instructed instead of continuing old tasks.
- **Visible result:** `Session Handoff Finished`; wait time 8 seconds and handoff time 106 seconds.

This establishes actual parentless master rollover at a configured limit, using an existing chain and a real model-driven handoff. It is not a Real-Pi check of the default 25-session boundary, the configuration dialog, deferred-input delivery, or every cancellation/failure path. It does not establish publication or installation of a release.

## Automated checks

The implementation passed all 139 deterministic tests, TypeScript checking, unused-symbol checking, `git diff --check`, and package dry-run checking before integration.

Focused coverage includes:

- default 25 and positive-integer validation;
- immediate configuration persistence and runtime application;
- intentional in-memory defaults for older complete configurations without automatic rewriting;
- a master counted as session one;
- linking below the limit and cutting at or above it, including a reduced limit;
- counting persisted lineage after context reconstruction rather than relying on a process-local counter;
- unchanged dossier and deferred prompts during parentless replacement;
- cancellation during lineage lookup and deferred input arriving before its final snapshot;
- visible failure when required lineage is unavailable.

Automated lineage fixtures and focused context adapters are test doubles, not claims of additional real Pi sessions.
