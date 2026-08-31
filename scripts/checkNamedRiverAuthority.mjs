#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE, SETTLEMENT_CONFIG } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import { computeSettlementFlattenPads } from '../src/3d/world/settlements.js';
import {
	NAMED_RIVER_RUNTIME_POLICY,
	buildTerrainConformingRiverSurface,
	createNamedRiverRuntime,
	disposeNamedRiverRuntime,
	traceNamedRiverNetwork,
} from '../src/3d/world/namedRiverRuntime.js';
import { REFERENCE_RIVERS, REFERENCE_RIVERS_POLICY } from '../src/3d/world/worldReferenceRivers.js';
import { NAMED_RIVER_VALLEY_POLICY, buildNamedRiverValleyField } from '../src/3d/world/terrainNamedRiverValleys.js';

const sea = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const flattenPads = computeSettlementFlattenPads({
	sampleHeightMeters: raw,
	seaLevelMeters: sea,
	minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
	mapBounds: WORLD_SCALE.MAP_BOUNDS,
	metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
});
const phase1 = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);

assert.equal(REFERENCE_RIVERS.length, 10, 'owner-map named river count drifted');
assert.equal(REFERENCE_RIVERS_POLICY.deterministic, true);
assert.equal(NAMED_RIVER_RUNTIME_POLICY.tracerAuthority, 'world/rivers.js.generateRiverPath');
assert.equal(NAMED_RIVER_VALLEY_POLICY.onlyCutsDown, true);
assert.equal(NAMED_RIVER_VALLEY_POLICY.canonicalDryLandPreserved, true);

const build = () => traceNamedRiverNetwork({
	seed: WORLD_DEFAULTS.WORLD_SEED,
	sampleHeightMeters: phase1,
	seaLevelMeters: sea,
});

const network = build();
const repeated = build();
assert.equal(network.rivers.length, 10);
assert.equal(network.usefulRivers.length, 10, `not every canonical river traced usefully: ${network.rejectedRivers.map((river) => river.id).join(', ')}`);
assert.equal(repeated.usefulRivers.length, network.usefulRivers.length);

const digest = (value) => value.rivers.map((river) => [
	river.id,
	river.points.length,
	river.diagnostics.tracerEndReason,
	river.diagnostics.lengthMeters.toFixed(3),
	river.points.at(-1)?.x.toFixed(3),
	river.points.at(-1)?.z.toFixed(3),
].join(':')).join('|');
assert.equal(digest(repeated), digest(network), 'same seed produced different named-river courses');

let totalLengthMeters = 0;
let longestRiverMeters = 0;
let mouthExtensionCount = 0;
const ids = new Set();
for (const river of network.rivers) {
	assert(!ids.has(river.id), `duplicate runtime river id ${river.id}`);
	ids.add(river.id);
	assert.equal(river.diagnostics.sourceDry, true, `${river.id} source is not canonical dry land`);
	assert.equal(river.diagnostics.mouthWet, true, `${river.id} mouth did not reach canonical water`);
	assert(river.diagnostics.pointCount >= NAMED_RIVER_RUNTIME_POLICY.minimumUsefulPointCount, `${river.id} collapsed to a stub`);
	assert(river.diagnostics.lengthMeters >= NAMED_RIVER_RUNTIME_POLICY.minimumUsefulLengthMeters, `${river.id} too short`);
	assert(river.diagnostics.mouthExtensionMeters <= 2000 + 1e-9, `${river.id} mouth extension exceeded bounded terminal policy`);
	if (river.diagnostics.mouthExtensionMeters > 0) mouthExtensionCount += 1;
	totalLengthMeters += river.diagnostics.lengthMeters;
	longestRiverMeters = Math.max(longestRiverMeters, river.diagnostics.lengthMeters);
}
assert(totalLengthMeters > 10_000, `named network is implausibly short: ${totalLengthMeters.toFixed(1)}m`);

// Surface construction: dense, downstream-monotone, and never below the centreline bed.
let denseSurfacePoints = 0;
for (const river of network.usefulRivers) {
	const surface = buildTerrainConformingRiverSurface(river.points, phase1);
	assert(surface.length > river.points.length, `${river.id} was not densified`);
	for (let index = 0; index < surface.length; index += 1) {
		const point = surface[index];
		const bed = phase1(point.x, point.z);
		assert(point.y >= bed + NAMED_RIVER_RUNTIME_POLICY.waterFreeboardMeters - 1e-8, `${river.id} surface buried at ${index}`);
		if (index > 0) assert(point.y <= surface[index - 1].y + 1e-8, `${river.id} surface climbs downstream`);
	}
	denseSurfacePoints += surface.length;
}

// Valley field is the same accepted courses; it may only lower ground and may not breach dry land.
const valleys = buildNamedRiverValleyField(network, sea);
assert.equal(valleys.riverCount, 10);
assert(valleys.segmentCount > 100, `too few valley segments: ${valleys.segmentCount}`);
let cutSamples = 0;
let maxObservedCut = 0;
for (const river of network.usefulRivers) {
	for (let index = 1; index < river.points.length - 1; index += Math.max(1, Math.floor(river.points.length / 12))) {
		const point = river.points[index];
		const natural = phase1(point.x, point.z);
		const carved = valleys.sampleValleyHeight(point.x, point.z, natural);
		assert(carved <= natural + 1e-9, `${river.id} valley raised terrain`);
		if (natural > sea) assert(carved >= sea + NAMED_RIVER_VALLEY_POLICY.minLandFreeboardMeters - 1e-9, `${river.id} valley breached canonical dry-land freeboard`);
		const cut = natural - carved;
		if (cut > 0.01) cutSamples += 1;
		maxObservedCut = Math.max(maxObservedCut, cut);
	}
}
assert(cutSamples >= 20, `valley field barely affects accepted courses: ${cutSamples} cut samples`);
assert(maxObservedCut > 2, `valley field too weak to read: ${maxObservedCut.toFixed(2)}m`);
assert(maxObservedCut < 80, `valley field exceeded bounded natural carve envelope: ${maxObservedCut.toFixed(2)}m`);

// Existing river material is reused; bank grounding is measured from final terrain, not centre Y.
const runtime = createNamedRiverRuntime({ network, sampleHeightMeters: phase1 });
try {
	assert.equal(runtime.meshes.length, 10, 'not every accepted named river produced a mesh');
	assert(runtime.totalTriangles > 0 && runtime.totalTriangles <= NAMED_RIVER_RUNTIME_POLICY.maxTotalTriangles);
	for (const metric of runtime.diagnostics) {
		assert(metric.surfacePointCount > 20, `${metric.id} surface too sparse`);
		assert(metric.bankGrounding.maxLiftMeters < 60, `${metric.id} bank grounding indicates pathological cross-slope`);
		const mesh = runtime.meshes.find((candidate) => candidate.userData.namedRiver?.id === metric.id);
		const position = mesh.geometry.getAttribute('position');
		for (let vertex = 0; vertex < position.count; vertex += Math.max(1, Math.floor(position.count / 80))) {
			const ground = phase1(position.getX(vertex), position.getZ(vertex));
			assert(position.getY(vertex) >= ground + NAMED_RIVER_RUNTIME_POLICY.bankFreeboardMeters - 1e-5, `${metric.id} bank vertex buried`);
		}
	}
} finally {
	disposeNamedRiverRuntime(runtime);
}

console.log('[checkNamedRiverAuthority] PASS');
console.log(JSON.stringify({
	referencePolicyId: REFERENCE_RIVERS_POLICY.id,
	runtimePolicyId: NAMED_RIVER_RUNTIME_POLICY.id,
	valleyPolicyId: NAMED_RIVER_VALLEY_POLICY.id,
	riverCount: network.rivers.length,
	totalLengthKm: Number((totalLengthMeters / 1000).toFixed(3)),
	longestRiverKm: Number((longestRiverMeters / 1000).toFixed(3)),
	mouthExtensionCount,
	denseSurfacePoints,
	valleySegmentCount: valleys.segmentCount,
	cutSamples,
	maxObservedCutMeters: Number(maxObservedCut.toFixed(3)),
	runtimeTriangles: runtime.totalTriangles,
}, null, 2));
