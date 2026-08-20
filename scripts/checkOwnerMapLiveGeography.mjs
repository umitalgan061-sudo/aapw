import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { WORLD_SCALE } from '../src/3d/config.js';
import {
	OWNER_MAP_FEATURE_GUIDE_POLICY,
	REFERENCE_FOREST_GUIDES,
	REFERENCE_ROAD_GUIDES,
	sampleReferenceForestInfluenceWorld,
	sampleReferenceRoadPreferenceWorld,
} from '../src/3d/world/worldReferenceFeatureGuides.js';
import { REFERENCE_RELIEF_CHAINS, WORLD_REFERENCE_MAP } from '../src/3d/world/worldReferenceMap.js';
import { WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY } from '../src/3d/world/worldReferenceMountainRelief.js';

const expectedSha = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const mapBytes = fs.readFileSync('map.png/map.png');
const actualSha = crypto.createHash('sha256').update(mapBytes).digest('hex');
assert.equal(actualSha, expectedSha, 'owner map bytes changed without retracing geography guides');
assert.equal(WORLD_REFERENCE_MAP.sha256, expectedSha);
assert.equal(OWNER_MAP_FEATURE_GUIDE_POLICY.sourceSha256, expectedSha);
assert.equal(OWNER_MAP_FEATURE_GUIDE_POLICY.sourceAsset, 'map.png/map.png');

const toWorld = ([x, y]) => ({
	x: (x - 0.5) * WORLD_SCALE.WORLD_WIDTH_METERS,
	z: (y - 0.5) * WORLD_SCALE.WORLD_DEPTH_METERS,
});

assert.ok(REFERENCE_FOREST_GUIDES.length >= 10, 'owner-map forest coverage unexpectedly sparse');
for (const zone of REFERENCE_FOREST_GUIDES) {
	const center = toWorld(zone.center);
	assert.ok(sampleReferenceForestInfluenceWorld(center.x, center.z) >= zone.strength * 0.99, `${zone.id} center lost forest influence`);
}
const openDothraki = toWorld([0.545, 0.555]);
assert.ok(sampleReferenceForestInfluenceWorld(openDothraki.x, openDothraki.z) < 0.1, 'Dothraki Sea must not become blanket forest');

assert.ok(REFERENCE_ROAD_GUIDES.length >= 9, 'owner-map road network unexpectedly sparse');
for (const guide of REFERENCE_ROAD_GUIDES) {
	const probe = toWorld(guide.points[Math.floor(guide.points.length / 2)]);
	assert.ok(sampleReferenceRoadPreferenceWorld(probe.x, probe.z) > 0.95, `${guide.id} centerline lost road preference`);
}
const summerSea = toWorld([0.50, 0.83]);
assert.ok(sampleReferenceRoadPreferenceWorld(summerSea.x, summerSea.z) < 0.05, 'open Summer Sea must not receive road preference');

const chainIds = new Set(REFERENCE_RELIEF_CHAINS.map((chain) => chain.id));
for (const id of ['vale-chain', 'red-mountains', 'bone-mountains', 'eastern-chain', 'frostfangs', 'painted-mountains', 'jogos-spine']) {
	assert.ok(chainIds.has(id), `missing owner-map relief chain ${id}`);
	assert.ok(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[id], `missing live relief profile ${id}`);
}

const roadSource = fs.readFileSync('src/3d/world/roads.js', 'utf8');
const pathfinderSource = fs.readFileSync('src/3d/world/roadPathfinder.js', 'utf8');
const vegetationSource = fs.readFileSync('src/3d/world/vegetation.js', 'utf8');
const serviceWorkerSource = fs.readFileSync('service-worker.js', 'utf8');
assert.match(roadSource, /referenceRoadPreference: sampleReferenceRoadPreferenceWorld/);
assert.match(pathfinderSource, /referenceRoadOffGuidePenalty/);
assert.match(vegetationSource, /sampleReferenceForestInfluenceWorld/);
assert.match(serviceWorkerSource, /worldReferenceFeatureGuides\.js/, 'owner-map feature guides must remain available to offline 3D boot');

console.log(JSON.stringify({
	ok: true,
	mapSha256: actualSha,
	forestGuides: REFERENCE_FOREST_GUIDES.length,
	roadGuides: REFERENCE_ROAD_GUIDES.length,
	reliefChains: [...chainIds],
	backgroundForestAcceptance: OWNER_MAP_FEATURE_GUIDE_POLICY.forestBackgroundAcceptance,
	roadOffGuideCostPenalty: OWNER_MAP_FEATURE_GUIDE_POLICY.roadOffGuideCostPenalty,
}, null, 2));
