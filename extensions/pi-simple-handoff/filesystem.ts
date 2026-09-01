import { constants } from "node:fs";
import { lstat, mkdir, open, rename, rmdir, unlink } from "node:fs/promises";
import {
	MAX_HANDOFF_BYTES,
	SESSION_HANDOFF_FILE_NAME,
	handoffDirectory,
	handoffPath,
	isValidHandoffContent,
} from "./core.ts";

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

function isPrivateDirectory(metadata: Awaited<ReturnType<typeof lstat>>): boolean {
	return metadata.isDirectory() && !metadata.isSymbolicLink() && (BigInt(metadata.mode) & 0o077n) === 0n;
}

export async function createPrivateHandoffDirectory(token: string): Promise<void> {
	const directory = handoffDirectory(token);
	await mkdir(directory, { mode: 0o700 });
	if (!isPrivateDirectory(await lstat(directory))) {
		throw new Error("Handoff directory is not a private regular directory.");
	}
}

export async function writeValidatedHandoff(token: string, content: string): Promise<void> {
	if (!isValidHandoffContent(content)) {
		throw new Error("Handoff content is incomplete, malformed, or too large.");
	}

	const directory = handoffDirectory(token);
	const directoryMetadata = await lstat(directory);
	if (!isPrivateDirectory(directoryMetadata)) {
		throw new Error("Handoff directory is not a private regular directory.");
	}

	const path = handoffPath(token);
	const handle = await open(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
		0o600,
	);
	let completed = false;
	try {
		await handle.writeFile(content, "utf8");
		await handle.sync();
		const metadata = await handle.stat();
		if (!metadata.isFile() || (BigInt(metadata.mode) & 0o077n) !== 0n) {
			throw new Error("Handoff file is not a private regular file.");
		}
		const currentDirectoryMetadata = await lstat(directory);
		if (
			!isPrivateDirectory(currentDirectoryMetadata) ||
			currentDirectoryMetadata.dev !== directoryMetadata.dev ||
			currentDirectoryMetadata.ino !== directoryMetadata.ino
		) {
			throw new Error("Handoff directory changed while it was being written.");
		}
		completed = true;
	} finally {
		await handle.close();
		if (!completed) {
			const currentDirectoryMetadata = await lstatOrUndefined(directory);
			if (
				currentDirectoryMetadata &&
				isPrivateDirectory(currentDirectoryMetadata) &&
				currentDirectoryMetadata.dev === directoryMetadata.dev &&
				currentDirectoryMetadata.ino === directoryMetadata.ino
			) {
				await unlink(path).catch(() => undefined);
			}
		}
	}
}

export async function readValidatedHandoff(token: string): Promise<string> {
	const directory = handoffDirectory(token);
	const directoryMetadata = await lstat(directory);
	if (!isPrivateDirectory(directoryMetadata)) {
		throw new Error("Handoff directory is not a private regular directory.");
	}

	const handle = await open(handoffPath(token), constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const metadata = await handle.stat();
		if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_HANDOFF_BYTES) {
			throw new Error("Handoff file is missing, unsafe, empty, or too large.");
		}
		const buffer = Buffer.alloc(MAX_HANDOFF_BYTES + 1);
		let bytesRead = 0;
		while (bytesRead < buffer.length) {
			const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
			if (result.bytesRead === 0) break;
			bytesRead += result.bytesRead;
		}
		if (bytesRead > MAX_HANDOFF_BYTES) throw new Error("Handoff file is too large.");

		const currentDirectoryMetadata = await lstat(directory);
		if (
			!isPrivateDirectory(currentDirectoryMetadata) ||
			currentDirectoryMetadata.dev !== directoryMetadata.dev ||
			currentDirectoryMetadata.ino !== directoryMetadata.ino
		) {
			throw new Error("Handoff directory changed while it was being read.");
		}
		const content = buffer.subarray(0, bytesRead).toString("utf8");
		if (!isValidHandoffContent(content)) {
			throw new Error("Handoff file is incomplete or malformed.");
		}
		return content;
	} finally {
		await handle.close();
	}
}

async function lstatOrUndefined(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return undefined;
		throw error;
	}
}

async function removeExpectedDirectory(directory: string): Promise<void> {
	const metadata = await lstat(directory);
	if (!isPrivateDirectory(metadata)) {
		throw new Error("Handoff cleanup directory is not a private regular directory.");
	}

	const file = `${directory}/${SESSION_HANDOFF_FILE_NAME}`;
	const fileMetadata = await lstatOrUndefined(file);
	if (fileMetadata) {
		if (!fileMetadata.isFile() && !fileMetadata.isSymbolicLink()) {
			throw new Error("Handoff cleanup file is not a regular file or symlink.");
		}
		await unlink(file);
	}
	try {
		await rmdir(directory);
	} catch (error) {
		if (errorCode(error) === "ENOTEMPTY") {
			throw new Error("Handoff cleanup directory contains unexpected entries.");
		}
		throw error;
	}
}

export async function cleanupHandoff(token: string): Promise<void> {
	const directory = handoffDirectory(token);
	const quarantine = `${directory}-cleanup`;
	const source = await lstatOrUndefined(directory);
	const existingQuarantine = await lstatOrUndefined(quarantine);

	if (!source && !existingQuarantine) return;
	if (source?.isSymbolicLink()) {
		if (existingQuarantine) throw new Error("Handoff cleanup found an unexpected quarantine directory.");
		await unlink(directory);
		return;
	}
	if (source) {
		if (!isPrivateDirectory(source)) {
			throw new Error("Handoff cleanup directory is not a private regular directory.");
		}
		if (existingQuarantine) throw new Error("Handoff cleanup found an unexpected quarantine directory.");
		await rename(directory, quarantine);
	}
	await removeExpectedDirectory(quarantine);
}
