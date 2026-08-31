#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WINTER_VEGETATION_ASSET_POLICY } from '../src/3d/world/winterVegetationAsset.js';

const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1';
const LFS_OID_PATTERN = /^oid sha256:([0-9a-f]{64})$/m;
const LFS_SIZE_PATTERN = /^size ([1-9][0-9]*)$/m;
const GLB_MAGIC = 'glTF';
const GLB_HEADER_BYTES = 12;
const GLB_VERSION_2 = 2;
const MIN_REASONABLE_TREE_BYTES = 1024;

export function classifyWinterAssetBytes(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
		return Object.freeze({ kind: 'invalid', reason: 'empty' });
	}

	const prefix = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 200)));
	if (prefix.startsWith(LFS_POINTER_PREFIX)) {
		const oidMatch = prefix.match(LFS_OID_PATTERN);
		const sizeMatch = prefix.match(LFS_SIZE_PATTERN);
		if (!oidMatch || !sizeMatch) {
			return Object.freeze({ kind: 'invalid', reason: 'malformed-lfs-pointer' });
		}
		const declaredSize = Number(sizeMatch[1]);
		if (!Number.isSafeInteger(declaredSize) || declaredSize < MIN_REASONABLE_TREE_BYTES) {
			return Object.freeze({ kind: 'invalid', reason: 'implausible-lfs-size', declaredSize });
		}
		return Object.freeze({
			kind: 'lfs-pointer',
			oid: oidMatch[1],
			declaredSize,
		});
	}

	if (bytes.byteLength < GLB_HEADER_BYTES) {
		return Object.freeze({ kind: 'invalid', reason: 'short-binary' });
	}
	const magic = new TextDecoder('ascii').decode(bytes.subarray(0, 4));
	if (magic !== GLB_MAGIC) {
		return Object.freeze({ kind: 'invalid', reason: 'unknown-header' });
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint32(4, true);
	const declaredLength = view.getUint32(8, true);
	if (version !== GLB_VERSION_2) {
		return Object.freeze({ kind: 'invalid', reason: 'unsupported-glb-version', version });
	}
	if (declaredLength !== bytes.byteLength) {
		return Object.freeze({
			kind: 'invalid',
			reason: 'glb-length-mismatch',
			declaredLength,
			actualLength: bytes.byteLength,
		});
	}
	if (declaredLength < MIN_REASONABLE_TREE_BYTES) {
		return Object.freeze({ kind: 'invalid', reason: 'implausibly-small-glb', declaredLength });
	}
	return Object.freeze({ kind: 'materialized-glb', version, declaredLength });
}

function assertLfsRule(gitattributes) {
	const glbRules = gitattributes
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith('*.glb '));
	assert.equal(glbRules.length, 1, '.gitattributes must contain exactly one canonical *.glb rule');
	const rule = glbRules[0];
	for (const token of ['filter=lfs', 'diff=lfs', 'merge=lfs', '-text']) {
		assert.ok(rule.includes(token), `*.glb rule must include ${token}`);
	}
}

function makeSyntheticGlb(byteLength = 2048) {
	const bytes = new Uint8Array(byteLength);
	bytes.set(new TextEncoder().encode(GLB_MAGIC), 0);
	const view = new DataView(bytes.buffer);
	view.setUint32(4, GLB_VERSION_2, true);
	view.setUint32(8, byteLength, true);
	return bytes;
}

{
	const pointer = new TextEncoder().encode(
		`${LFS_POINTER_PREFIX}\noid sha256:${'a'.repeat(64)}\nsize 224076\n`,
	);
	const result = classifyWinterAssetBytes(pointer);
	assert.equal(result.kind, 'lfs-pointer');
	assert.equal(result.declaredSize, 224076);
}

{
	const glb = makeSyntheticGlb();
	const result = classifyWinterAssetBytes(glb);
	assert.equal(result.kind, 'materialized-glb');
	assert.equal(result.version, 2);
	assert.equal(result.declaredLength, glb.byteLength);
}

{
	const malformedPointer = new TextEncoder().encode(`${LFS_POINTER_PREFIX}\nsize 20\n`);
	assert.equal(classifyWinterAssetBytes(malformedPointer).kind, 'invalid');
	const badMagic = new Uint8Array(2048);
	assert.equal(classifyWinterAssetBytes(badMagic).reason, 'unknown-header');
	const wrongVersion = makeSyntheticGlb();
	new DataView(wrongVersion.buffer).setUint32(4, 1, true);
	assert.equal(classifyWinterAssetBytes(wrongVersion).reason, 'unsupported-glb-version');
	const wrongLength = makeSyntheticGlb();
	new DataView(wrongLength.buffer).setUint32(8, wrongLength.byteLength + 4, true);
	assert.equal(classifyWinterAssetBytes(wrongLength).reason, 'glb-length-mismatch');
}

const gitattributes = await readFile(new URL('../.gitattributes', import.meta.url), 'utf8');
assertLfsRule(gitattributes);

const checkoutStates = [];
for (const candidate of WINTER_VEGETATION_ASSET_POLICY.candidates) {
	assert.match(candidate, /^assets\/models\/vegetation\/.+\.glb$/,
		`winter candidate must remain inside assets/models/vegetation: ${candidate}`);
	const bytes = await readFile(new URL(`../${candidate}`, import.meta.url));
	const classification = classifyWinterAssetBytes(bytes);
	assert.notEqual(
		classification.kind,
		'invalid',
		`${candidate} must be either a valid Git LFS pointer or a materialized glTF v2 binary (${classification.reason})`,
	);
	checkoutStates.push(Object.freeze({ candidate, ...classification }));
}

assert.equal(checkoutStates.length, WINTER_VEGETATION_ASSET_POLICY.candidates.length);
const summary = checkoutStates
	.map(({ candidate, kind, declaredSize, declaredLength }) => {
		const bytes = declaredSize ?? declaredLength;
		return `${candidate}=${kind}:${bytes}`;
	})
	.join(', ');
console.log(`[checkWinterVegetationRepositoryContract] PASS: ${summary}`);
