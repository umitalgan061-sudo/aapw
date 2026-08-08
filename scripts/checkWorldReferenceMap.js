import {
	WORLD_REFERENCE_MAP,
	REFERENCE_BIOME_ZONES,
	REFERENCE_WATER_ZONES,
	REFERENCE_RELIEF_CHAINS,
	normalizedMapToWorldXZ,
	sampleReferenceInfluence,
} from '../src/3d/world/worldReferenceMap.js';

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

assert(WORLD_REFERENCE_MAP.pixelWidth === 1536, 'reference width drifted');
assert(WORLD_REFERENCE_MAP.pixelHeight === 1024, 'reference height drifted');

const allZones = [...REFERENCE_BIOME_ZONES, ...REFERENCE_WATER_ZONES];
const ids = new Set();
for (const zone of allZones) {
	assert(!ids.has(zone.id), `duplicate zone id: ${zone.id}`);
	ids.add(zone.id);
	assert(zone.center.length === 2 && zone.radius.length === 2, `${zone.id}: malformed ellipse`);
	assert(zone.center.every((value) => value >= 0 && value <= 1), `${zone.id}: center out of bounds`);
	assert(zone.radius.every((value) => value > 0 && value <= 1), `${zone.id}: radius out of bounds`);
	assert(sampleReferenceInfluence(zone.center[0], zone.center[1], zone) === 1, `${zone.id}: center influence must be 1`);
}

for (const chain of REFERENCE_RELIEF_CHAINS) {
	assert(chain.points.length >= 2, `${chain.id}: relief chain needs >=2 points`);
	assert(chain.points.flat().every((value) => value >= 0 && value <= 1), `${chain.id}: point out of bounds`);
}

const sample = normalizedMapToWorldXZ(0.5, 0.5, { minX: 0, maxX: 1000, minY: 0, maxY: 800 }, 2);
assert(sample.x === 0 && sample.z === 0, 'normalized center must project to world origin');

console.log(`World reference map contract OK: ${REFERENCE_BIOME_ZONES.length} biome zones, ${REFERENCE_WATER_ZONES.length} water zones, ${REFERENCE_RELIEF_CHAINS.length} relief chains.`);
