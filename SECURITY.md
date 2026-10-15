# Security Policy

## Supported versions

This policy covers the 1.4 code line, currently prepared as the unpublished 1.4.0 release candidate. It requires Node.js 22.19.0 or later and Pi (`@earendil-works/pi-coding-agent`) 0.84.2 or later. Older package, Node, and Pi versions have not been evaluated against this contract.

## Trust boundary

`pi-blitz-handoff` is a Pi extension and runs with the full operating-system permissions of the Pi process. Installing it is equivalent to trusting its TypeScript code with that access. Pi project trust is not a sandbox for an installed extension.

The extension preserves authorization in its writer instructions: continuation context does not grant new permission, and proposed, paused, or approval-dependent work must remain distinguished from executable work. This is an instruction to the model, not a deterministic semantic guarantee. The submission tool validates attempt correlation only. Before cutover, the extension checks that the handoff file is a nonempty regular file, without reading its dossier. It does not validate NUL absence, Markdown structure, semantic completeness or authorization mistakes.

## Data handled

A handoff can process:

- the persisted source-session transcript path;
- the current working directory and ancestor paths used for project-template lookup;
- the configured handoff template;
- the model-written continuation dossier;
- ordinary interactive or RPC prompt text received after the accepted readiness boundary;
- context-usage and handoff-status information.

The writer prompt and resulting dossier are sent through the configured model in the source session. The source model writes the dossier through Pi's native file tools to `.pi/handoff_<Session-ID>.md` under the current Pi working directory. The private submission tool receives only the attempt ID. The extension appends its deferred prompts without reading the dossier and sends a short absolute file reference and ingestion/cleanup instructions as the replacement's first user turn. The receiver's subsequent file reads send the dossier through the configured replacement model. Pi's normal session-persistence behavior applies to native file-tool calls and results in both sessions.

`prepareWhileWaiting: true` permits optional pre-GO retrieval and drafting with the source's existing tools. It changes neither authorization nor the safe boundary. GO starts prompt deferral, not cutover; DONE is accepted only during post-GO writing, then the native settled boundary permits transition. The source model must update prepared drafts before DONE; factual completeness is not checked by code. Cancelled preparation can leave a reserved or partial file, just like an interrupted normal writer.

Deferred prompts are preserved unchanged and in arrival order. When any exist, the extension writes one plaintext Markdown recovery file for the handoff window. It does not inspect prompt contents for secrets, redact them, or encrypt them. Do not place secrets in prompts or handoff context unless the configured model, local session storage, and recovery storage are appropriate for those secrets.

## Filesystem behavior

Global managed data defaults to `<getAgentDir()>/pi-blitz-handoff/`. Project-local transport files live directly at `.pi/handoff_<Session-ID>.md` in the current Pi working directory, without a timestamp. New private directories and files are created with restrictive modes (`0700` directories and `0600` files). Global configuration, project-template assignments, and recovery replacement use ordinary atomic rename-based writes. Cleanup is exact and nonrecursive.

These controls reduce accidental local exposure; they are not a general filesystem security framework. In particular:

- deliberately configured directory symlinks are followed;
- there is no inode or descriptor identity tracking;
- there is no `O_NOFOLLOW` policy;
- existing directory permissions are not tightened;
- handoff, recovery and template content is not encrypted;
- the writer's native file tools are real tools, not a path sandbox; restricting source-task work and writes to the supplied handoff path is model guidance;
- managed-default backups are retained until the user removes them.

**Delete handoff after reading** (`deleteHandoffAfterReading: true`, the default) instructs the receiver to delete the exact handoff file only after successful complete ingestion. When disabled, the file stays unchanged at the same path, increasing local plaintext retention. There is no archive move. Read failures must leave the file unchanged, and cleanup failures must be reported. Neither ingestion nor deletion is verified or performed by the extension. Exclude `.pi/handoff_*.md` from version control and publication according to your local project policy; the extension does not edit Git ignores automatically. Interrupted or cancelled writers may leave empty or partial handoff files for manual inspection.

Choose recovery and addendum-template directories whose ownership and permissions fit the sensitivity of the session data. Review leftover recovery files with `/sh recover`; execution is never automatic.

## Session and recovery safety

A persisted source session is required so the replacement can use Pi's native parent lineage. The extension reserves a project-local handoff transport file, failing visibly rather than overwriting an existing same-name file. It blocks user-initiated replacement, fork, and compaction only during the post-readiness transfer window, when those operations would invalidate the active transfer.

Cancellation before native cutover stops extension-owned writer work and restores the saved tool list. Deferred prompts are not automatically replayed and any recovery file is retained. Recovery execution sends all entries as one combined user turn and deletes the selected file only after dispatch returns without an immediate error. This does not prove that a model completed or correctly interpreted the recovered work.

## Reporting a vulnerability

Report security-sensitive findings privately through the trusted channel from which you received this package. Include the affected package, Node, and Pi versions; a minimal reproduction; impact; and whether recovery or session files were exposed. Do not include secret values, private transcripts, or recovery-file contents in the report.

No public issue tracker or disclosure address is asserted by this package metadata. Coordinate disclosure before publishing details that could expose users or their session data.

## Validation boundary

Automated unit, integration, and package tests verify deterministic local behavior. They do not constitute a sandbox audit, adversarial model evaluation, or end-to-end validation in a real interactive Pi session. Real interactive/model/session validation has not yet been performed for this candidate.
