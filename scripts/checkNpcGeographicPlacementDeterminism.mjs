#!/usr/bin/env node
import assert from 'node:assert/strict';
import { NPC_CONFIG } from '../src/3d/gameplay/npcConfig.js';
import { evaluateConfiguredNpcRoute, resolveConfiguredNpcPatrol, resolveConfiguredNpcSpawnPlacement, sampleConfiguredNpcGeography } from '../src/3d/gameplay/npcWorldPlacement.js';
import { SETTLEMENT_CONFIG, WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } from '../src/3d/world/settlements.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';

const rawHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const flattenPads = computeSettlementFlattenPads({
	sampleHeightMeters: rawHeight,
	seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
	minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
	mapBounds: WORLD_SCALE.MAP_BOUNDS,
	metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
});
const gameplayHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
const seatsById = new Map(KINGDOM_SEATS.map((seat) => {
	const world = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
	return [seat.id, { ...seat, x: world.x, z: world.z }];
}));

function stablePlacementRecord(spawn, sampleGroundHeight = gameplayHeight) {
	const seat = seatsById.get(spawn.seatId);
	assert.ok(seat, `missing configured seat ${spawn.seatId}`);
	const placement = resolveConfiguredNpcSpawnPlacement({ spawn, seat, sampleGroundHeight });
	const patrol = placement.ok ? resolveConfiguredNpcPatrol(spawn, seat, placement, sampleGroundHeight) : null;
	return {
		id: spawn.id,
		ok: placement.ok,
		error: placement.error ?? null,
		x: placement.x ?? null,
		z: placement.z ?? null,
		groundY: placement.groundY ?? null,
		baseSurface: placement.geography?.baseSurface ?? null,
		biome: placement.geography?.surface?.biome ?? null,
		slopeDegrees: placement.geography?.surface?.slopeDegrees ?? null,
		relocated: placement.relocated ?? null,
		relocationMode: placement.relocationMode ?? null,
		relocationMeters: placement.relocationMeters ?? null,
		displacementFromDesiredMeters: placement.displacementFromDesiredMeters ?? null,
		seatDistanceMeters: placement.seatDistanceMeters ?? null,
		patrolEnabled: Boolean(patrol?.waypoints),
		patrolDisabledByGeography: Boolean(patrol?.route?.disabled),
		routeSampleCount: patrol?.route?.routeSampleCount ?? 0,
		patrolError: patrol?.route?.error ?? null,
	};
}

const firstPass = NPC_CONFIG.SPAWNS.map((spawn) => stablePlacementRecord(spawn));
const secondPass = NPC_CONFIG.SPAWNS.map((spawn) => stablePlacementRecord(spawn));
assert.deepEqual(secondPass, firstPass, 'same exact world/config produced non-deterministic NPC placement');
const reversedPass = [...NPC_CONFIG.SPAWNS].reverse().map((spawn) => stablePlacementRecord(spawn));
const byId = new Map(firstPass.map((entry) => [entry.id, entry]));
for (const entry of reversedPass) assert.deepEqual(entry, byId.get(entry.id), `placement for ${entry.id} depended on spawn iteration order`);

for (const entry of firstPass) {
	assert.equal(entry.ok, true, `configured guard ${entry.id} rejected by canonical geography: ${entry.error}`);
	assert.ok(!['sea', 'lake'].includes(entry.baseSurface), `${entry.id} resolved onto ${entry.baseSurface}`);
	assert.ok(Number.isFinite(entry.slopeDegrees) && entry.slopeDegrees <= 26, `${entry.id} slope ${entry.slopeDegrees} exceeds policy`);
	assert.ok(['local', 'settlement-ring'].includes(entry.relocationMode), `${entry.id} has invalid relocation mode ${entry.relocationMode}`);
	if (entry.relocationMode === 'local') {
		assert.ok(entry.relocationMeters <= 8, `${entry.id} moved farther than bounded local relocation budget`);
		assert.ok(entry.displacementFromDesiredMeters <= 8 + 1e-9, `${entry.id} local authored repair escaped 8m`);
	} else {
		assert.equal(entry.relocationMeters, 0, `${entry.id} settlement-ring recovery polluted local budget telemetry`);
		assert.ok(entry.displacementFromDesiredMeters > 0, `${entry.id} settlement-ring recovery failed to move`);
	}
	assert.ok(entry.seatDistanceMeters >= 10 && entry.seatDistanceMeters <= 30, `${entry.id} left settlement guard envelope`);
}

const pilot = NPC_CONFIG.SPAWNS.find((spawn) => spawn.id === 'stannis-guard-1') ?? NPC_CONFIG.SPAWNS[0];
const pilotSeat = seatsById.get(pilot.seatId);
const desiredX = pilotSeat.x + pilot.offsetXMeters;
const desiredZ = pilotSeat.z + pilot.offsetZMeters;
const baselineAtPilot = gameplayHeight(desiredX, desiredZ);
function localRidgeHeight(x, z) {
	const base = gameplayHeight(x, z);
	const dx = x - desiredX;
	const dz = z - desiredZ;
	if (Math.abs(dx) > 2.1 || Math.abs(dz) > 2.1) return base;
	return base + (dx + 2.1) * 4.5;
}

const unsafeDesired = sampleConfiguredNpcGeography(desiredX, desiredZ, localRidgeHeight);
assert.equal(unsafeDesired.ok, true, 'synthetic local ridge left canonical map unexpectedly');
assert.ok(unsafeDesired.surface.slopeDegrees > 26, `synthetic ridge failed to exceed slope policy (${unsafeDesired.surface.slopeDegrees}°)`);
const relocatedA = resolveConfiguredNpcSpawnPlacement({ spawn: pilot, seat: pilotSeat, sampleGroundHeight: localRidgeHeight });
const relocatedB = resolveConfiguredNpcSpawnPlacement({ spawn: pilot, seat: pilotSeat, sampleGroundHeight: localRidgeHeight });
assert.equal(relocatedA.ok, true, `bounded relocation could not escape local unsafe ridge: ${relocatedA.error}`);
assert.deepEqual(relocatedB, relocatedA, 'bounded relocation changed across identical evaluations');
assert.equal(relocatedA.relocated, true, 'unsafe desired guard point did not trigger relocation');
assert.equal(relocatedA.relocationMode, 'local', 'small synthetic ridge should be repaired by authored local search');
assert.ok(relocatedA.relocationMeters >= 2 && relocatedA.relocationMeters <= 8, `relocation ${relocatedA.relocationMeters}m escaped bounded search`);
assert.ok(Math.abs(relocatedA.groundY - baselineAtPilot) < 20, 'relocated guard produced implausible terrain height jump');

const routeStart = { x: relocatedA.x, z: relocatedA.z };
const safeTarget = { x: routeStart.x, z: routeStart.z - 12 };
const safeRouteA = evaluateConfiguredNpcRoute(routeStart, safeTarget, gameplayHeight);
const safeRouteB = evaluateConfiguredNpcRoute(routeStart, safeTarget, gameplayHeight);
assert.deepEqual(safeRouteB, safeRouteA, 'route geography sampling is non-deterministic');
assert.ok(safeRouteA.routeSampleCount >= 1 && safeRouteA.routeSampleCount <= 12, 'route sampler escaped bounded sample budget');

const outOfRange = sampleConfiguredNpcGeography(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, () => 10);
assert.equal(outOfRange.ok, false, 'reference-map out-of-range position was accepted');
assert.equal(outOfRange.error, 'reference-map-out-of-range');
const nonFinite = sampleConfiguredNpcGeography(NaN, 0, gameplayHeight);
assert.deepEqual(nonFinite, { ok: false, error: 'non-finite-position' }, 'non-finite guard coordinate was not rejected deterministically');

const summary = {
	configuredSpawns: firstPass.length,
	patrolsEnabled: firstPass.filter((entry) => entry.patrolEnabled).length,
	patrolsDisabledByGeography: firstPass.filter((entry) => entry.patrolDisabledByGeography).length,
	localRelocations: firstPass.filter((entry) => entry.relocationMode === 'local' && entry.relocated).length,
	settlementRingRecoveries: firstPass.filter((entry) => entry.relocationMode === 'settlement-ring').length,
	syntheticRelocationMeters: relocatedA.relocationMeters,
	syntheticRelocationSlopeDegrees: relocatedA.geography.surface.slopeDegrees,
	safeRouteSamples: safeRouteA.routeSampleCount,
	uniqueBiomes: [...new Set(firstPass.map((entry) => entry.biome))].sort(),
};
console.log('NPC_GEOGRAPHIC_PLACEMENT_DETERMINISM_PASS', JSON.stringify(summary));
