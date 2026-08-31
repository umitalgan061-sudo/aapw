#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	FIREBASE_DEPLOY_LFS_POLICY,
	classifyCelestialBuffer,
} from './firebaseDeployLfsReadiness.mjs';
import {
	CELESTIAL_ASSET_POLICY,
	celestialAltitudeWeightFromY,
} from '../src/3d/lighting.js';

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
assert.equal(CELESTIAL_ASSET_POLICY.moonLightingAltitudeModulated, true,
	'Moon directional illumination must remain tied to celestial altitude');
assert.equal(CELESTIAL_ASSET_POLICY.sunLightingAltitudeModulated, true,
	'Sun directional illumination must remain tied to celestial altitude');
assert.equal(CELESTIAL_ASSET_POLICY.twilightSkyAltitudeModulated, true,
	'twilight sky colour must remain tied to solar altitude');

assert.equal(celestialAltitudeWeightFromY(-100), 0,
	'a celestial body well below the horizon must contribute no directional key');
const horizonWeight = celestialAltitudeWeightFromY(0);
assert(horizonWeight > 0 && horizonWeight < 0.1,
	'a body touching the horizon should fade in gently instead of popping to full strength');
assert.equal(celestialAltitudeWeightFromY(900), 1,
	'a high celestial body must reach full altitude weighting');

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
assert(lightingSource.includes('MOON_MAX_INTENSITY * smoothNightFactor * moonAltitudeFactor'),
	'Moon directional key must combine darkness with actual Moon altitude');
assert(lightingSource.includes('lights.sun.intensity = baseSunIntensity * sunAltitudeFactor'),
	'Sun DirectionalLight must apply the same altitude attenuation used by custom shader lighting');
assert(lightingSource.includes('sunIntensity: lights.sun.intensity'),
	'custom shader celestial state must publish the already altitude-modulated Sun intensity exactly once');
assert(lightingSource.includes('SKY_TWILIGHT'),
	'lighting runtime must retain a dedicated solar-altitude twilight sky state');

console.log('[checkCelestialAssetContract] PASS', JSON.stringify({
	policy: CELESTIAL_ASSET_POLICY.id,
	repositoryPath,
	runtimeUrl: CELESTIAL_ASSET_POLICY.moonAssetUrl,
	checkoutKind: moonState.kind,
	checkoutBytes: moonState.bytes,
	declaredSize: moonState.declaredSize ?? moonState.bytes,
	targetDiameterMeters: CELESTIAL_ASSET_POLICY.moonTargetDiameterMeters,
	horizonAltitudeWeight: horizonWeight,
}));