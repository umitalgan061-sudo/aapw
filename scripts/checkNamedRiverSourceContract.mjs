#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REFERENCE_RIVERS, REFERENCE_RIVERS_POLICY } from '../src/3d/world/worldReferenceRivers.js';
import { NAMED_RIVER_RUNTIME_POLICY } from '../src/3d/world/namedRiverRuntime.js';
import { NAMED_RIVER_VALLEY_POLICY } from '../src/3d/world/terrainNamedRiverValleys.js';
import { RIVER_MOUTH_POLICY } from '../src/3d/world/riverMouth.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const referenceSource = read('src/3d/world/worldReferenceRivers.js');
const runtimeSource = read('src/3d/world/namedRiverRuntime.js');
const mouthSource = read('src/3d/world/riverMouth.js');
const valleySource = read('src/3d/world/terrainNamedRiverValleys.js');
const riversSource = read('src/3d/world/rivers.js');

assert.equal(REFERENCE_RIVERS.length, 10);
assert.equal(REFERENCE_RIVERS_POLICY.sourcePolicy, 'headwater-from-owner-map-course-from-live-terrain');
assert.equal(REFERENCE_RIVERS_POLICY.materialAuthority, 'world/rivers.js');
assert.equal(NAMED_RIVER_RUNTIME_POLICY.tracerAuthority, 'world/rivers.js.generateRiverPath');
assert.equal(RIVER_MOUTH_POLICY.terminalOnly, true);
assert.equal(NAMED_RIVER_VALLEY_POLICY.onlyCutsDown, true);

for (const id of ['green-fork','red-fork','blue-fork','blackwater-rush','mander','greenblood','white-knife','rhoyne','skahazadhan','sarne']) {
	assert(referenceSource.includes(`id: '${id}'`), `missing canonical river definition: ${id}`);
}
for (const snippet of [
	"from './rivers.js'",
	'generateRiverPath({',
	'localSampler',
	'extendCourseToCanonicalWater',
	'buildTerrainConformingRiverSurface',
	'groundRiverRibbonBanks',
	'createRiverMesh(surface, river.widthMeters)',
	'detectWaterfalls(surface)',
]) assert(runtimeSource.includes(snippet), `runtime ownership/wiring lost: ${snippet}`);
for (const snippet of [
	"classifyReferenceBaseSurface",
	'worldXZToNormalizedReference',
	'maxExtensionMeters: 2000',
	'canonicalSurfaceAtWorld',
]) assert(mouthSource.includes(snippet), `mouth authority lost: ${snippet}`);
for (const snippet of [
	'onlyCutsDown: true',
	'canonicalDryLandPreserved: true',
	'Math.min',
	'minLandFreeboardMeters',
	'buildNamedRiverValleyField',
]) assert(valleySource.includes(snippet), `valley safety contract lost: ${snippet}`);

// New geography modules may reuse the existing river engine, but may not fork RNG/material/height authority.
for (const source of [referenceSource, runtimeSource, mouthSource, valleySource]) {
	assert(!source.includes('Math.random()'), 'named-river geography must remain deterministic');
	assert(!source.includes('new THREE.MeshStandardMaterial'), 'named-river geography forked river material authority');
	assert(!source.includes('createHeightSampler('), 'named-river helper became a second terrain owner');
}
assert(riversSource.includes('export function generateRiverPath'), 'existing downhill tracer disappeared');
assert(riversSource.includes('export function createRiverMesh'), 'existing river material factory disappeared');

console.log('[checkNamedRiverSourceContract] PASS');
console.log(JSON.stringify({
	referencePolicyId: REFERENCE_RIVERS_POLICY.id,
	runtimePolicyId: NAMED_RIVER_RUNTIME_POLICY.id,
	mouthPolicyId: RIVER_MOUTH_POLICY.id,
	valleyPolicyId: NAMED_RIVER_VALLEY_POLICY.id,
	riverCount: REFERENCE_RIVERS.length,
}, null, 2));
