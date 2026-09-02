#!/usr/bin/env node
import assert from 'node:assert/strict';
import { NPC_CONFIG } from '../src/3d/gameplay/npcConfig.js';
import {
	resolveConfiguredNpcPatrol,
	resolveConfiguredNpcSpawnPlacement,
	sampleConfiguredNpcGeography,
} from '../src/3d/gameplay/npcWorldPlacement.js';
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
const groundHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
const seats = new Map(KINGDOM_SEATS.map((seat) => {
	const world = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
	return [seat.id, { ...seat, x: world.x, z: world.z }];
}));

const records = [];
const occupied = new Map();
for (const spawn of NPC_CONFIG.SPAWNS) {
	const seat = seats.get(spawn.seatId);
	assert.ok(seat, `configured guard ${spawn.id} references missing seat ${spawn.seatId}`);
	const desiredX = seat.x + spawn.offsetXMeters;
	const desiredZ = seat.z + spawn.offsetZMeters;
	const desired = sampleConfiguredNpcGeography(desiredX, desiredZ, groundHeight);
	const placement = resolveConfiguredNpcSpawnPlacement({ spawn, seat, sampleGroundHeight: groundHeight });
	assert.equal(placement.ok, true, `configured guard ${spawn.id} has no safe geographic placement: ${placement.error}`);
	const patrol = resolveConfiguredNpcPatrol(spawn, seat, placement, groundHeight);
	const key = `${placement.x.toFixed(3)}:${placement.z.toFixed(3)}`;
	const collocated = occupied.get(key) ?? [];
	collocated.push(spawn.id);
	occupied.set(key, collocated);
	const displacementFromDesired = Math.hypot(placement.x - desiredX, placement.z - desiredZ);
	const groundError = Math.abs(groundHeight(placement.x, placement.z) - placement.groundY);
	records.push({
		id: spawn.id,
		seatId: spawn.seatId,
		modelUrl: spawn.modelUrl,
		desiredBaseSurface: desired.baseSurface ?? null,
		desiredBiome: desired.surface?.biome ?? null,
		baseSurface: placement.geography.baseSurface,
		biome: placement.geography.surface.biome,
		zoneId: placement.geography.zoneId,
		slopeDegrees: placement.geography.surface.slopeDegrees,
		seatDistanceMeters: placement.seatDistanceMeters,
		relocated: placement.relocated,
		relocationMeters: placement.relocationMeters,
		displacementFromDesired,
		groundError,
		patrolAuthored: Boolean(spawn.patrol),
		patrolEnabled: Boolean(patrol.waypoints),
		patrolDisabledByGeography: Boolean(patrol.route?.disabled),
		patrolDistanceMeters: patrol.route?.distanceMeters ?? 0,
		patrolRouteSamples: patrol.route?.routeSampleCount ?? 0,
		patrolError: patrol.route?.error ?? null,
	});
}

assert.equal(records.length, NPC_CONFIG.SPAWNS.length, 'distribution audit lost configured guards');
assert.ok(records.length >= 10, `guard population is unexpectedly sparse (${records.length})`);
assert.ok(new Set(records.map((record) => record.seatId)).size >= 6, 'configured guards no longer cover enough settlements');
assert.equal(new Set(records.map((record) => record.modelUrl)).size, 6, 'configured guard visual variety regressed below six FBX models');

for (const record of records) {
	assert.ok(!['sea', 'lake'].includes(record.baseSurface), `${record.id} ended on ${record.baseSurface}`);
	assert.ok(record.slopeDegrees <= 26, `${record.id} ended on ${record.slopeDegrees}° slope`);
	assert.ok(record.seatDistanceMeters >= 10 && record.seatDistanceMeters <= 30, `${record.id} left 10-30m settlement envelope`);
	assert.ok(record.relocationMeters <= 8, `${record.id} exceeded 8m local relocation budget`);
	assert.ok(record.displacementFromDesired <= 8 + 1e-9, `${record.id} moved farther than relocation telemetry reports`);
	assert.ok(record.groundError < 1e-6, `${record.id} ground alignment error ${record.groundError}m`);
	if (record.patrolEnabled) {
		assert.ok(record.patrolDistanceMeters > 0, `${record.id} enabled patrol has zero route length`);
		assert.ok(record.patrolRouteSamples >= 1 && record.patrolRouteSamples <= 12, `${record.id} patrol sample budget escaped bounds`);
	}
	if (record.patrolDisabledByGeography) {
		assert.ok(record.patrolAuthored, `${record.id} reports geography-disabled patrol without an authored patrol`);
		assert.ok(record.patrolError, `${record.id} geography-disabled patrol has no reason`);
	}
}

const collisions = [...occupied.entries()].filter(([, ids]) => ids.length > 1);
assert.deepEqual(collisions, [], `configured guards collapse onto identical positions: ${JSON.stringify(collisions)}`);
const authoredPatrols = records.filter((record) => record.patrolAuthored);
assert.ok(authoredPatrols.length >= 4, `expected multiple authored patrols, got ${authoredPatrols.length}`);
assert.ok(records.some((record) => record.patrolEnabled), 'canonical geography disabled every guard patrol');

const bySeat = new Map();
for (const record of records) {
	const bucket = bySeat.get(record.seatId) ?? [];
	bucket.push(record);
	bySeat.set(record.seatId, bucket);
}
for (const [seatId, bucket] of bySeat) {
	if (bucket.length < 2) continue;
	for (let a = 0; a < bucket.length; a += 1) {
		for (let b = a + 1; b < bucket.length; b += 1) {
			const distance = Math.hypot(
				(bucket[a].seatDistanceMeters - bucket[b].seatDistanceMeters),
				(bucket[a].relocationMeters - bucket[b].relocationMeters),
			);
			assert.ok(Number.isFinite(distance), `${seatId} pair produced non-finite distribution metric`);
		}
	}
}

const summary = {
	configuredGuards: records.length,
	settlementsCovered: new Set(records.map((record) => record.seatId)).size,
	uniqueModels: new Set(records.map((record) => record.modelUrl)).size,
	uniqueBiomes: [...new Set(records.map((record) => record.biome))].sort(),
	relocations: records.filter((record) => record.relocated).length,
	maxRelocationMeters: Math.max(...records.map((record) => record.relocationMeters)),
	maxSlopeDegrees: Math.max(...records.map((record) => record.slopeDegrees)),
	authoredPatrols: authoredPatrols.length,
	enabledPatrols: records.filter((record) => record.patrolEnabled).length,
	geographyDisabledPatrols: records.filter((record) => record.patrolDisabledByGeography).length,
};
console.log('NPC_GEOGRAPHIC_DISTRIBUTION_MATRIX_PASS', JSON.stringify({ summary, records }));
