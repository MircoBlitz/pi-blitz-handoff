# Security Policy

## Supported versions

The current 1.0 code line is the supported and tested package contract. It requires Node.js 22.19.0 or later and Pi (`@earendil-works/pi-coding-agent`) 0.84.2 or later. Older package, Node, and Pi versions have not been evaluated against this contract.

## Trust boundary

`pi-simple-handoff` is a Pi extension and runs with the full operating-system permissions of the Pi process. Installing it is equivalent to trusting its TypeScript code with that access. Pi project trust is not a sandbox for an installed extension.

The extension preserves authorization in its writer instructions: continuation context does not grant new permission, and proposed, paused, or approval-dependent work must remain distinguished from executable work. This is an instruction to the model, not a deterministic semantic guarantee. The extension validates submission correlation, nonempty content, and absence of NUL, but it does not parse the dossier structure or detect authorization mistakes.

## Data handled

A handoff can process:

- the persisted source-session transcript path;
- the configured handoff template;
- the model-written continuation dossier;
- ordinary interactive or RPC prompt text received after the accepted readiness boundary;
- context-usage and handoff-status information.

The writer prompt and resulting dossier are sent through the configured model in the source session. The dossier is supplied as the content of the writer's private submission tool call. The assembled dossier and deferred prompts are then sent as the first user turn of the replacement session. Pi's normal session-persistence behavior applies to both sessions.

Deferred prompts are preserved unchanged and in arrival order. When any exist, the extension writes one plaintext Markdown recovery file for the handoff window. It does not inspect prompt contents for secrets, redact them, or encrypt them. Do not place secrets in prompts or handoff context unless the configured model, local session storage, and recovery storage are appropriate for those secrets.

## Filesystem behavior

Managed data defaults to `<getAgentDir()>/pi-simple-handoff/`. New private directories and files are created with restrictive modes (`0700` directories and `0600` files). Configuration and recovery replacement use ordinary atomic rename-based writes. Cleanup is exact and nonrecursive.

These controls reduce accidental local exposure; they are not a general filesystem security framework. In particular:

- deliberately configured directory symlinks are followed;
- there is no inode or descriptor identity tracking;
- there is no `O_NOFOLLOW` policy;
- existing directory permissions are not tightened;
- recovery and template content is not encrypted;
- managed-default backups are retained until the user removes them.

Choose recovery and addendum-template directories whose ownership and permissions fit the sensitivity of the session data. Review leftover recovery files with `/sh recover`; execution is never automatic.

## Session and recovery safety

A persisted source session is required so the replacement can use Pi's native parent lineage. The extension does not create an intermediate dossier transport file. It blocks user-initiated replacement, fork, and compaction only during the post-readiness transfer window, when those operations would invalidate the active transfer.

Cancellation before native cutover stops extension-owned writer work and restores the saved tool list. Deferred prompts are not automatically replayed and any recovery file is retained. Recovery execution sends all entries as one combined user turn and deletes the selected file only after dispatch returns without an immediate error. This does not prove that a model completed or correctly interpreted the recovered work.

## Reporting a vulnerability

Report security-sensitive findings privately through the trusted channel from which you received this package. Include the affected package, Node, and Pi versions; a minimal reproduction; impact; and whether recovery or session files were exposed. Do not include secret values, private transcripts, or recovery-file contents in the report.

No public issue tracker or disclosure address is asserted by this package metadata. Coordinate disclosure before publishing details that could expose users or their session data.

## Validation boundary

Automated unit, integration, and package tests verify deterministic local behavior. They do not constitute a sandbox audit, adversarial model evaluation, or end-to-end validation in a real interactive Pi session. Real interactive/model/session validation has not yet been performed for this candidate.
