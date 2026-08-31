#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WINTER_VEGETATION_ASSET_POLICY } from '../src/3d/world/winterVegetationAsset.js';

const firebase = JSON.parse(await readFile(new URL('../firebase.json', import.meta.url), 'utf8'));
const attributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8');
const hosting = firebase.hosting;

assert(hosting && typeof hosting === 'object', 'firebase.json must keep an explicit Hosting configuration');
assert.equal(hosting.public, '.',
	'hosting contract assumes Firebase publishes the repository checkout directly from public:"."');
assert.match(attributes, /^\*\.glb\s+filter=lfs\s+diff=lfs\s+merge=lfs\s+-text$/m,
	'GLB binaries must remain under the canonical Git-LFS rule');

const ignore = Array.isArray(hosting.ignore) ? hosting.ignore : [];
for (const assetPath of WINTER_VEGETATION_ASSET_POLICY.candidates) {
	assert(assetPath.startsWith('assets/models/vegetation/'), `winter candidate must remain in vegetation assets: ${assetPath}`);
	assert(!ignore.some((pattern) => pattern === 'assets/**' || pattern === '**/assets/**' || pattern === assetPath),
		`Firebase ignore rules must not exclude winter asset ${assetPath}`);
}

const catchAllHeader = (hosting.headers ?? []).find((entry) => entry.source === '**');
assert(catchAllHeader, 'Firebase Hosting must retain a catch-all cache policy');
const cacheControl = (catchAllHeader.headers ?? []).find((header) => String(header.key).toLowerCase() === 'cache-control');
assert(cacheControl, 'catch-all Firebase header must define Cache-Control');
assert.match(String(cacheControl.value), /no-cache/i,
	'hosting must not permanently cache an LFS pointer response after a later hydrated deployment');
assert.match(String(cacheControl.value), /no-store/i,
	'hosting must not store stale pointer responses while the winter asset deployment state changes');

function classifyCheckout(buffer) {
	if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'glTF') {
		const version = buffer.readUInt32LE(4);
		const declaredLength = buffer.readUInt32LE(8);
		return { kind: 'glb', version, declaredLength, checkoutBytes: buffer.length };
	}

	const text = buffer.toString('utf8');
	if (text.startsWith('version https://git-lfs.github.com/spec/v1\n')) {
		const oid = text.match(/^oid sha256:([0-9a-f]{64})$/m)?.[1] ?? null;
		const declaredSize = Number.parseInt(text.match(/^size (\d+)$/m)?.[1] ?? '', 10);
		return { kind: 'lfs-pointer', oid, declaredSize, checkoutBytes: buffer.length };
	}
	return { kind: 'unknown', checkoutBytes: buffer.length };
}

const checkout = {};
for (const assetPath of WINTER_VEGETATION_ASSET_POLICY.candidates) {
	const buffer = await readFile(new URL(`../${assetPath}`, import.meta.url));
	const state = classifyCheckout(buffer);
	checkout[assetPath] = state;
	assert.notEqual(state.kind, 'unknown', `${assetPath} must be either a valid LFS pointer or a materialized GLB`);

	if (state.kind === 'lfs-pointer') {
		assert.match(state.oid ?? '', /^[0-9a-f]{64}$/, `${assetPath} pointer must declare a SHA-256 oid`);
		assert(Number.isFinite(state.declaredSize) && state.declaredSize >= WINTER_VEGETATION_ASSET_POLICY.hostedPreflightMinBytes,
			`${assetPath} LFS metadata must describe a real binary larger than the hosted preflight threshold`);
		assert(state.checkoutBytes < WINTER_VEGETATION_ASSET_POLICY.hostedPreflightMinBytes,
			`${assetPath} pointer checkout must remain small enough for HEAD preflight to reject before GLTFLoader`);
	} else {
		assert.equal(state.version, 2, `${assetPath} materialized binary must be glTF v2`);
		assert.equal(state.declaredLength, state.checkoutBytes,
			`${assetPath} GLB header length must equal the materialized checkout byte length`);
		assert(state.checkoutBytes >= WINTER_VEGETATION_ASSET_POLICY.hostedPreflightMinBytes,
			`${assetPath} materialized binary must clear the runtime hosted-preflight minimum`);
	}
}

console.log('[checkFirebaseWinterAssetHostingContract] PASS', JSON.stringify({
	publicDirectory: hosting.public,
	cacheControl: cacheControl.value,
	preflightMinBytes: WINTER_VEGETATION_ASSET_POLICY.hostedPreflightMinBytes,
	checkout,
}));
