#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1\n';

export const FIREBASE_DEPLOY_LFS_POLICY = Object.freeze({
	id: 'firebase-deploy-lfs-readiness-2026-08-21-v1',
	firebasePublicDirectory: '.',
	winterAssets: Object.freeze([
		'assets/models/vegetation/winter_tree.glb',
		'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
	]),
	minimumWinterGlbBytes: 512,
});

export function classifyLfsBuffer(buffer) {
	if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'glTF') {
		return Object.freeze({
			kind: 'glb',
			bytes: buffer.length,
			version: buffer.readUInt32LE(4),
			declaredLength: buffer.readUInt32LE(8),
		});
	}
	const text = buffer.toString('utf8');
	if (text.startsWith(LFS_POINTER_PREFIX)) {
		return Object.freeze({
			kind: 'lfs-pointer',
			bytes: buffer.length,
			oid: text.match(/^oid sha256:([0-9a-f]{64})$/m)?.[1] ?? null,
			declaredSize: Number.parseInt(text.match(/^size (\d+)$/m)?.[1] ?? '', 10),
		});
	}
	return Object.freeze({ kind: 'materialized', bytes: buffer.length });
}

export function assertMaterializedDeployState(assetPath, state, { winter = false } = {}) {
	assert.notEqual(state.kind, 'lfs-pointer',
		`${assetPath} is still a Git-LFS pointer; Firebase deploy must stop before publishing it`);
	assert(state.bytes > 0, `${assetPath} must be a non-empty materialized file`);
	if (!winter) return state;
	assert.equal(state.kind, 'glb', `${assetPath} winter asset must materialize as a binary GLB`);
	assert.equal(state.version, 2, `${assetPath} must be glTF binary version 2`);
	assert.equal(state.declaredLength, state.bytes,
		`${assetPath} GLB header length must equal the hydrated file length`);
	assert(state.bytes >= FIREBASE_DEPLOY_LFS_POLICY.minimumWinterGlbBytes,
		`${assetPath} hydrated GLB must exceed the runtime pointer-rejection threshold`);
	return state;
}

export function parseLfsTrackedPaths(output) {
	return Object.freeze(String(output)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => line.replace(/^\*\s+/, '')));
}

function runGit(args, { allowFailure = false } = {}) {
	const result = spawnSync('git', args, {
		cwd: ROOT,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	if (!allowFailure && result.status !== 0) {
		const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
		throw new Error(`git ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
	}
	return result;
}

async function verifyFirebaseHostingContract() {
	const firebase = JSON.parse(await readFile(path.join(ROOT, 'firebase.json'), 'utf8'));
	const hosting = firebase.hosting;
	assert(hosting && typeof hosting === 'object', 'firebase.json must define Hosting');
	assert.equal(hosting.public, FIREBASE_DEPLOY_LFS_POLICY.firebasePublicDirectory,
		'deploy readiness assumes Firebase publishes the repository checkout directly');
	const ignore = Array.isArray(hosting.ignore) ? hosting.ignore : [];
	for (const assetPath of FIREBASE_DEPLOY_LFS_POLICY.winterAssets) {
		assert(!ignore.includes(assetPath), `Firebase ignore must not exclude required winter asset ${assetPath}`);
	}
	return hosting;
}

function trackedLfsPaths() {
	const result = runGit(['lfs', 'ls-files', '-n']);
	const paths = parseLfsTrackedPaths(result.stdout);
	assert(paths.length > 0, 'repository must expose at least one Git-LFS tracked file');
	return paths;
}

function hydrateLfs(scope) {
	runGit(['lfs', 'version']);
	runGit(['lfs', 'install', '--local']);
	if (scope === 'winter') {
		runGit([
			'lfs', 'pull',
			`--include=${FIREBASE_DEPLOY_LFS_POLICY.winterAssets.join(',')}`,
			'--exclude=',
		]);
		return;
	}
	runGit(['lfs', 'pull']);
}

async function inspectPath(assetPath, { winter = false } = {}) {
	let buffer;
	try {
		buffer = await readFile(path.join(ROOT, assetPath));
	} catch (error) {
		throw new Error(`${assetPath} is missing from the Firebase deployment checkout`, { cause: error });
	}
	const state = classifyLfsBuffer(buffer);
	assertMaterializedDeployState(assetPath, state, { winter });
	return Object.freeze({ path: assetPath, ...state });
}

function parseCliArgs(argv) {
	let scope = 'winter';
	let hydrate = false;
	let manifest = null;
	for (const arg of argv) {
		if (arg === '--hydrate') hydrate = true;
		else if (arg.startsWith('--scope=')) scope = arg.slice('--scope='.length);
		else if (arg.startsWith('--manifest=')) manifest = arg.slice('--manifest='.length);
		else throw new Error(`unknown argument: ${arg}`);
	}
	assert(['winter', 'all'].includes(scope), '--scope must be winter or all');
	return { scope, hydrate, manifest };
}

export async function runFirebaseDeployLfsReadiness({ scope = 'winter', hydrate = false, manifest = null } = {}) {
	assert(['winter', 'all'].includes(scope), 'scope must be winter or all');
	await verifyFirebaseHostingContract();
	const tracked = trackedLfsPaths();
	for (const assetPath of FIREBASE_DEPLOY_LFS_POLICY.winterAssets) {
		assert(tracked.includes(assetPath), `${assetPath} must remain tracked by Git LFS`);
	}
	if (hydrate) hydrateLfs(scope);

	const selected = scope === 'all' ? tracked : FIREBASE_DEPLOY_LFS_POLICY.winterAssets;
	const inspected = [];
	let totalBytes = 0;
	for (const assetPath of selected) {
		const state = await inspectPath(assetPath, {
			winter: FIREBASE_DEPLOY_LFS_POLICY.winterAssets.includes(assetPath),
		});
		inspected.push(state);
		totalBytes += state.bytes;
	}

	const report = Object.freeze({
		policy: FIREBASE_DEPLOY_LFS_POLICY.id,
		scope,
		hydratedByCommand: hydrate,
		trackedLfsFiles: tracked.length,
		verifiedFiles: inspected.length,
		totalVerifiedBytes: totalBytes,
		winterAssets: Object.freeze(inspected.filter((entry) => FIREBASE_DEPLOY_LFS_POLICY.winterAssets.includes(entry.path))),
	});

	if (manifest) {
		const destination = path.resolve(ROOT, manifest);
		await mkdir(path.dirname(destination), { recursive: true });
		await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	}
	return report;
}

async function main() {
	const options = parseCliArgs(process.argv.slice(2));
	const report = await runFirebaseDeployLfsReadiness(options);
	console.log('[firebaseDeployLfsReadiness] PASS', JSON.stringify(report));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
	main().catch((error) => {
		console.error('[firebaseDeployLfsReadiness] FAIL', error?.stack ?? error);
		process.exitCode = 1;
	});
}
