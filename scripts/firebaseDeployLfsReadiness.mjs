#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1\n';
const FBX_BINARY_MAGIC = Buffer.from('Kaydara FBX Binary  \x00\x1a\x00', 'binary');

export const FIREBASE_DEPLOY_LFS_POLICY = Object.freeze({
	id: 'firebase-deploy-lfs-readiness-2026-08-21-v3',
	firebasePublicDirectory: '.',
	winterAssets: Object.freeze([
		'assets/models/vegetation/pine_Zt62gceKXZ.glb',
		'assets/models/vegetation/winter_tree.glb',
		'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
	]),
	celestialAssets: Object.freeze([
		'assets/models/Ay/Moon 2K.fbx',
	]),
	minimumWinterGlbBytes: 512,
	minimumCelestialFbxBytes: 1024,
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

export function classifyCelestialBuffer(buffer) {
	const generic = classifyLfsBuffer(buffer);
	if (generic.kind === 'lfs-pointer') return generic;
	if (buffer.length >= FBX_BINARY_MAGIC.length && buffer.subarray(0, FBX_BINARY_MAGIC.length).equals(FBX_BINARY_MAGIC)) {
		return Object.freeze({ kind: 'fbx-binary', bytes: buffer.length });
	}
	const prefix = buffer.subarray(0, Math.min(buffer.length, 96)).toString('utf8');
	if (/^\s*;\s*FBX\b/i.test(prefix)) return Object.freeze({ kind: 'fbx-ascii', bytes: buffer.length });
	return Object.freeze({ kind: 'invalid-fbx', bytes: buffer.length });
}

export function assertMaterializedDeployState(assetPath, state, { winter = false, celestial = false } = {}) {
	assert.notEqual(state.kind, 'lfs-pointer',
		`${assetPath} is still a Git-LFS pointer; Firebase deploy must stop before publishing it`);
	assert(state.bytes > 0, `${assetPath} must be a non-empty materialized file`);
	if (winter) {
		assert.equal(state.kind, 'glb', `${assetPath} winter asset must materialize as a binary GLB`);
		assert.equal(state.version, 2, `${assetPath} must be glTF binary version 2`);
		assert.equal(state.declaredLength, state.bytes,
			`${assetPath} GLB header length must equal the hydrated file length`);
		assert(state.bytes >= FIREBASE_DEPLOY_LFS_POLICY.minimumWinterGlbBytes,
			`${assetPath} hydrated GLB must exceed the runtime pointer-rejection threshold`);
	}
	if (celestial) {
		assert(['fbx-binary', 'fbx-ascii'].includes(state.kind),
			`${assetPath} celestial asset must materialize as a valid FBX file`);
		assert(state.bytes >= FIREBASE_DEPLOY_LFS_POLICY.minimumCelestialFbxBytes,
			`${assetPath} hydrated FBX must exceed the runtime pointer-rejection threshold`);
	}
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
	const requiredAssets = [...FIREBASE_DEPLOY_LFS_POLICY.winterAssets, ...FIREBASE_DEPLOY_LFS_POLICY.celestialAssets];
	for (const assetPath of requiredAssets) {
		assert(!ignore.includes(assetPath), `Firebase ignore must not exclude required asset ${assetPath}`);
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
		runGit(['lfs', 'pull', '--include', FIREBASE_DEPLOY_LFS_POLICY.winterAssets.join(','), '--exclude', '']);
		return;
	}
	if (scope === 'celestial') {
		runGit(['lfs', 'pull', '--include', FIREBASE_DEPLOY_LFS_POLICY.celestialAssets.join(','), '--exclude', '']);
		return;
	}
	if (scope === 'all') {
		runGit(['lfs', 'pull']);
		return;
	}
	throw new Error(`unsupported hydration scope: ${scope}`);
}

async function verifyPaths(paths, { winterSet = new Set(), celestialSet = new Set() } = {}) {
	const files = [];
	let totalVerifiedBytes = 0;
	for (const assetPath of paths) {
		const buffer = await readFile(path.join(ROOT, assetPath));
		const celestial = celestialSet.has(assetPath);
		const state = celestial ? classifyCelestialBuffer(buffer) : classifyLfsBuffer(buffer);
		assertMaterializedDeployState(assetPath, state, { winter: winterSet.has(assetPath), celestial });
		files.push(Object.freeze({ path: assetPath, ...state }));
		totalVerifiedBytes += state.bytes;
	}
	return Object.freeze({ files: Object.freeze(files), totalVerifiedBytes });
}

export async function runFirebaseDeployLfsReadiness({
	hydrate = false,
	scope = 'all',
	manifestPath = null,
} = {}) {
	await verifyFirebaseHostingContract();
	const tracked = trackedLfsPaths();
	const winterSet = new Set(FIREBASE_DEPLOY_LFS_POLICY.winterAssets);
	const celestialSet = new Set(FIREBASE_DEPLOY_LFS_POLICY.celestialAssets);
	for (const required of [...winterSet, ...celestialSet]) {
		assert(tracked.includes(required), `required deploy asset must remain Git-LFS tracked: ${required}`);
	}
	if (hydrate) hydrateLfs(scope);

	const selected = scope === 'winter'
		? FIREBASE_DEPLOY_LFS_POLICY.winterAssets
		: scope === 'celestial'
			? FIREBASE_DEPLOY_LFS_POLICY.celestialAssets
			: tracked;
	const verified = await verifyPaths(selected, { winterSet, celestialSet });
	const winterAssets = verified.files.filter((entry) => winterSet.has(entry.path));
	const celestialAssets = verified.files.filter((entry) => celestialSet.has(entry.path));
	const manifest = Object.freeze({
		policy: FIREBASE_DEPLOY_LFS_POLICY.id,
		scope,
		hydratedByCommand: hydrate,
		trackedLfsFiles: tracked.length,
		verifiedFiles: verified.files.length,
		totalVerifiedBytes: verified.totalVerifiedBytes,
		winterAssets,
		celestialAssets,
	});

	if (manifestPath) {
		const outputPath = path.resolve(ROOT, manifestPath);
		await mkdir(path.dirname(outputPath), { recursive: true });
		await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
	}
	return manifest;
}

function parseArgs(argv) {
	const options = { hydrate: false, scope: 'all', manifestPath: null };
	for (const arg of argv) {
		if (arg === '--hydrate') options.hydrate = true;
		else if (arg.startsWith('--scope=')) options.scope = arg.slice('--scope='.length);
		else if (arg.startsWith('--manifest=')) options.manifestPath = arg.slice('--manifest='.length);
		else throw new Error(`unknown argument: ${arg}`);
	}
	assert(['winter', 'celestial', 'all'].includes(options.scope), '--scope must be winter, celestial, or all');
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const manifest = await runFirebaseDeployLfsReadiness(options);
	console.log('[firebaseDeployLfsReadiness] PASS', JSON.stringify(manifest));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
	main().catch((error) => {
		console.error('[firebaseDeployLfsReadiness] FAIL', error?.stack ?? error);
		process.exitCode = 1;
	});
}