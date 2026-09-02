#!/usr/bin/env node
import assert from 'node:assert/strict';
import { evaluateConfiguredNpcHabitat, evaluateConfiguredNpcRoute, resolveConfiguredNpcSpawnPlacement, sampleConfiguredNpcGeography } from '../src/3d/gameplay/npcWorldPlacement.js';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import { classifyReferenceBaseSurface } from '../src/3d/world/worldReferenceSurfacePindexes.js';

function findCanonicalSurface(type) {
	for (let y = 0; y <= 128; y += 1) {
		for (let x = 0; x <= 128; x += 1) {
			const nx = x / 128;
			const ny = y / 128;
			if (classifyReferenceBaseSurface(nx, ny) !== type) continue;
			return normalizedReferenceToWorldXZ(nx, ny, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
		}
	}
	throw new Error(`canonical ${type} surface not found`);
}

const flatGround = () => 18;
const sea = findCanonicalSurface('sea');
const seaGeography = sampleConfiguredNpcGeography(sea.x, sea.z, flatGround);
assert.equal(seaGeography.ok, true, 'canonical sea coordinate could not be sampled');
assert.equal(seaGeography.baseSurface, 'sea', 'canonical sea coordinate lost base-surface identity');
const seaHabitat = evaluateConfiguredNpcHabitat(sea.x, sea.z, flatGround);
assert.equal(seaHabitat.ok, false, 'guard habitat accepted canonical sea');
assert.match(seaHabitat.error, /water|biome/i, `unexpected sea rejection: ${seaHabitat.error}`);

const dry = findCanonicalSurface('soil');
function steepGround(x, z) { return 25 + (x - dry.x) * 1.2 + (z - dry.z) * 0.9; }
const steep = sampleConfiguredNpcGeography(dry.x, dry.z, steepGround);
assert.equal(steep.ok, true, 'steep dry fixture could not be sampled');
assert.ok(steep.surface.slopeDegrees > 26, `steep fixture did not exceed 26° (${steep.surface.slopeDegrees}°)`);
const steepHabitat = evaluateConfiguredNpcHabitat(dry.x, dry.z, steepGround);
assert.equal(steepHabitat.ok, false, 'guard habitat accepted excessive slope');
assert.match(steepHabitat.error, /slope/i, `unexpected steep rejection: ${steepHabitat.error}`);

const throwingGround = () => { throw new Error('fixture sampler failure'); };
assert.deepEqual(sampleConfiguredNpcGeography(dry.x, dry.z, throwingGround), { ok: false, error: 'ground-sample-failed' }, 'ground sampler exception did not fail closed');
assert.deepEqual(sampleConfiguredNpcGeography(NaN, dry.z, flatGround), { ok: false, error: 'non-finite-position' }, 'non-finite world position did not fail closed');
const beyondMap = sampleConfiguredNpcGeography(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, flatGround);
assert.equal(beyondMap.ok, false, 'out-of-map world coordinate was accepted');
assert.equal(beyondMap.error, 'reference-map-out-of-range');

const badRoutes = [
	[{ x: NaN, z: 0 }, { x: 0, z: 0 }],
	[{ x: 0, z: 0 }, { x: Infinity, z: 0 }],
	[null, { x: 0, z: 0 }],
];
for (const [start, target] of badRoutes) {
	assert.deepEqual(evaluateConfiguredNpcRoute(start, target, flatGround), { ok: false, error: 'non-finite-route' }, `malformed route did not fail closed: ${JSON.stringify({ start, target })}`);
}

const seat = { id: 'failure-seat', x: dry.x, z: dry.z };
const tooCloseSpawn = { id: 'inside-keep', seatId: seat.id, offsetXMeters: 1, offsetZMeters: 1 };
const tooFarSpawn = { id: 'outside-envelope', seatId: seat.id, offsetXMeters: 80, offsetZMeters: 80 };
const allSteepSpawn = { id: 'all-steep', seatId: seat.id, offsetXMeters: 14, offsetZMeters: 0 };
const closeResolution = resolveConfiguredNpcSpawnPlacement({ spawn: tooCloseSpawn, seat, sampleGroundHeight: flatGround });
assert.equal(closeResolution.ok, true, 'inside-keep authored offset was not repaired to safe settlement ground');
assert.equal(closeResolution.relocationMode, 'settlement-ring', 'inside-keep repair must use settlement-ring fallback');
assert.ok(closeResolution.seatDistanceMeters >= 10 && closeResolution.seatDistanceMeters <= 30, 'inside-keep repair escaped settlement envelope');
const farResolution = resolveConfiguredNpcSpawnPlacement({ spawn: tooFarSpawn, seat, sampleGroundHeight: flatGround });
assert.equal(farResolution.ok, true, 'outside-envelope authored offset was not repaired to safe settlement ground');
assert.equal(farResolution.relocationMode, 'settlement-ring', 'outside-envelope repair must use settlement-ring fallback');
assert.ok(farResolution.seatDistanceMeters >= 10 && farResolution.seatDistanceMeters <= 30, 'outside-envelope repair escaped settlement envelope');
const steepResolution = resolveConfiguredNpcSpawnPlacement({ spawn: allSteepSpawn, seat, sampleGroundHeight: steepGround });
assert.equal(steepResolution.ok, false, 'settlement-ring recovery accepted a fully unsafe steep envelope');
assert.equal(steepResolution.error, 'no-safe-settlement-ground');

assert.deepEqual(resolveConfiguredNpcSpawnPlacement({ spawn: null, seat, sampleGroundHeight: flatGround }), { ok: false, error: 'missing-spawn-or-seat' });
assert.deepEqual(resolveConfiguredNpcSpawnPlacement({ spawn: tooCloseSpawn, seat: null, sampleGroundHeight: flatGround }), { ok: false, error: 'missing-spawn-or-seat' });

console.log('NPC_PLACEMENT_FAILURE_SAFETY_PASS', JSON.stringify({
	sea: { x: sea.x, z: sea.z, error: seaHabitat.error },
	steepSlopeDegrees: Number(steep.surface.slopeDegrees.toFixed(3)),
	closeRecovery: { mode: closeResolution.relocationMode, seatDistanceMeters: closeResolution.seatDistanceMeters },
	farRecovery: { mode: farResolution.relocationMode, seatDistanceMeters: farResolution.seatDistanceMeters },
	steepError: steepResolution.error,
}));
