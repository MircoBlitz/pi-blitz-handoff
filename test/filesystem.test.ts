import assert from "node:assert/strict";
import { chmod, lstat, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { MAX_HANDOFF_BYTES, handoffDirectory, handoffPath, makeHandoffToken } from "../extensions/pi-simple-handoff/core.ts";
import { cleanupHandoff, createPrivateHandoffDirectory, readValidatedHandoff, writeValidatedHandoff } from "../extensions/pi-simple-handoff/filesystem.ts";

function token(label: string): string {
	return makeHandoffToken(`filesystem-${label}-${Date.now()}-${Math.random()}`);
}

function validHandoff(): string {
	return `# Context Handoff

## Goal
Keep the handoff safe.

## Current State
Tests are running.

## Decisions and Constraints
Do not follow unsafe files.

## Next Steps
Validate the private file.

## Open Questions and Blockers
None.

## Working Set
- test/filesystem.test.ts

## Behavior Changes
None.

## Precision Anchors
None.

## Cold Context
No transcript reference is available.`;
}

async function withPrivateDirectory(run: (value: { token: string; directory: string; file: string }) => Promise<void>): Promise<void> {
	const value = token("handoff");
	const directory = handoffDirectory(value);
	try {
		await createPrivateHandoffDirectory(value);
		await run({ token: value, directory, file: handoffPath(value) });
	} finally {
		await rm(directory, { recursive: true, force: true });
		await rm(`${directory}-cleanup`, { recursive: true, force: true });
	}
}

test("the extension writes and reads only a valid private regular handoff file", async () => {
	await withPrivateDirectory(async ({ token }) => {
		await writeValidatedHandoff(token, validHandoff());
		assert.equal(await readValidatedHandoff(token), validHandoff());
		await assert.rejects(writeValidatedHandoff(token, validHandoff()), /EEXIST/);
	});
});

test("invalid delivered content creates no handoff file", async () => {
	await withPrivateDirectory(async ({ token, file }) => {
		await assert.rejects(writeValidatedHandoff(token, "# Context Handoff"), /incomplete, malformed, or too large/);
		await assert.rejects(lstat(file), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
	});
});

test("rejects symlink, public, nonregular, malformed, and oversized handoff files", async () => {
	await withPrivateDirectory(async ({ token, directory, file }) => {
		await symlink("/tmp", file);
		await assert.rejects(readValidatedHandoff(token));
		await rm(file);

		await writeFile(file, validHandoff(), "utf8");
		await chmod(directory, 0o755);
		await assert.rejects(readValidatedHandoff(token), /private/);
		await chmod(directory, 0o700);

		await rm(file);
		await mkdir(file);
		await assert.rejects(readValidatedHandoff(token));
		await rm(file, { recursive: true });

		await writeFile(file, "# Context Handoff\n", "utf8");
		await assert.rejects(readValidatedHandoff(token), /malformed/);
		await writeFile(file, `${validHandoff()}${"x".repeat(MAX_HANDOFF_BYTES)}`, "utf8");
		await assert.rejects(readValidatedHandoff(token), /too large/);
	});
});

test("cleanup removes only the expected file and keeps unexpected entries retryable", async () => {
	await withPrivateDirectory(async ({ token, directory, file }) => {
		await writeFile(file, validHandoff(), "utf8");
		await writeFile(`${directory}/unexpected`, "keep", "utf8");
		await assert.rejects(cleanupHandoff(token), /unexpected entries/);
		const quarantined = `${directory}-cleanup`;
		assert.equal((await lstat(quarantined)).isDirectory(), true);
		assert.equal((await lstat(`${quarantined}/unexpected`)).isFile(), true);
		await rm(`${quarantined}/unexpected`);
		await cleanupHandoff(token);
		await assert.rejects(lstat(quarantined));
	});
});

test("cleanup rejects an unsafe directory without deleting it", async () => {
	const value = token("unsafe");
	const directory = handoffDirectory(value);
	try {
		await mkdir(directory, { mode: 0o755 });
		await chmod(directory, 0o755);
		await assert.rejects(cleanupHandoff(value), /private/);
		assert.equal((await lstat(directory)).isDirectory(), true);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
