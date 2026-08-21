#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	FIREBASE_DEPLOY_LFS_POLICY,
	classifyCelestialBuffer,
} from './firebaseDeployLfsReadiness.mjs';
import { CELESTIAL_ASSET_POLICY } from '../src/3d/lighting.js';

const ROOT = new URL('../', import.meta.url);
const repositoryPath = CELESTIAL_ASSET_POLICY.moonRepositoryPath;
const decodedRuntimePath = decodeURIComponent(CELESTIAL_ASSET_POLICY.moonAssetUrl);

assert.equal(decodedRuntimePath, repositoryPath,
	'runtime Moon URL must decode to the exact repository path hydrated by deployment QA');
assert.deepEqual([...FIREBASE_DEPLOY_LFS_POLICY.celestialAssets], [repositoryPath],
	'Firebase celestial hydration must use the same Moon file as runtime lighting');
assert.equal(CELESTIAL_ASSET_POLICY.moonAssetUrl.includes(' '), false,
	'runtime URL must percent-encode the space in the Moon filename');
assert(CELESTIAL_ASSET_POLICY.moonTargetDiameterMeters >= 24 && CELESTIAL_ASSET_POLICY.moonTargetDiameterMeters <= 48,
	'Moon visual diameter must remain readable without becoming an oversized sky object');

const attributes = await readFile(new URL('.gitattributes', ROOT), 'utf8');
const fbxRules = attributes.split(/\r?\n/)
	.map((line) => line.trim())
	.filter((line) => /^\*\.fbx\s/i.test(line));
assert(fbxRules.some((line) => /filter=lfs/.test(line) && /diff=lfs/.test(line) && /merge=lfs/.test(line) && /-text/.test(line)),
	'Moon FBX must remain covered by a canonical Git-LFS binary rule');

const moonBuffer = await readFile(new URL(repositoryPath, ROOT));
const moonState = classifyCelestialBuffer(moonBuffer);
if (moonState.kind === 'lfs-pointer') {
	assert.match(moonState.oid ?? '', /^[0-9a-f]{64}$/,
		'Moon LFS pointer must contain a SHA-256 object id');
	assert(Number.isInteger(moonState.declaredSize) && moonState.declaredSize >= FIREBASE_DEPLOY_LFS_POLICY.minimumCelestialFbxBytes,
		'Moon LFS pointer must declare a plausible materialized FBX size');
} else {
	assert(['fbx-binary', 'fbx-ascii'].includes(moonState.kind),
		`materialized Moon checkout must be valid FBX, got ${moonState.kind}`);
	assert(moonState.bytes >= FIREBASE_DEPLOY_LFS_POLICY.minimumCelestialFbxBytes,
		'materialized Moon checkout must exceed the pointer/error threshold');
}

const lightingSource = await readFile(new URL('src/3d/lighting.js', ROOT), 'utf8');
for (const requiredStatus of ['loading', 'active', 'fallback-placeholder', 'fallback-empty-model', 'fallback-error', 'detached']) {
	assert(lightingSource.includes(`'${requiredStatus}'`),
		`Moon readiness contract must retain the ${requiredStatus} diagnostic state`);
}
assert(lightingSource.includes('moonAssetReady'),
	'createDayNightLighting must expose the asynchronous Moon readiness result for browser/runtime QA');
assert(lightingSource.includes('object.position.sub(center)'),
	'hydrated Moon geometry must be centered on the celestial orbit anchor after normalization');

console.log('[checkCelestialAssetContract] PASS', JSON.stringify({
	policy: CELESTIAL_ASSET_POLICY.id,
	repositoryPath,
	runtimeUrl: CELESTIAL_ASSET_POLICY.moonAssetUrl,
	checkoutKind: moonState.kind,
	checkoutBytes: moonState.bytes,
	declaredSize: moonState.declaredSize ?? moonState.bytes,
	targetDiameterMeters: CELESTIAL_ASSET_POLICY.moonTargetDiameterMeters,
}));