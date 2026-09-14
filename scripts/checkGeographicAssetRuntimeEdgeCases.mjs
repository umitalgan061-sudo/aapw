import assert from 'node:assert/strict';
import { planRuntime, buildChunkRuntimePlan, runtimePlanDigest, boundaryOwnerFor, chunkKeyFor } from '../src/3d/world/geographicAssetRuntimeOrchestrator.js';
import { buildChunkExecution, buildFrameDigest, verifyExecutionDeterminism, validateExecutionFrame } from '../src/3d/world/geographicAssetRuntimeExecutionAdapter.js';
import { auditPlan, qualifyOrganicDistribution, familyEntropy, nearestNeighborStats } from '../src/3d/world/geographicAssetRuntimeAudit.js';

const failures = [];
const check = (id, fn) => { try { fn(); } catch (error) { failures.push(`${id}: ${error?.stack || error}`); } };
const surface = (extra = {}) => ({ biome: 'forest', moisture: .6, elevationMeters: 200, slopeDegrees: 8, waterDepth: 0, shorelineDistanceMeters: 100, roadDistanceMeters: 20, settlementDistanceMeters: 80, ...extra });
const base = (extra = {}) => ({ anchor: { x: 20, z: 20, id: 'edge', surface: surface() }, regionId: 'north_temperate_forest', familyIds: ['pine', 'birch'], mode: 'ambient', seed: 123, ...extra });

for (const x of [-512, -129, -128, -127.9, -64, -1, 0, .1, 1, 63.9, 64, 127.9, 128, 256, 511.5]) {
  check(`chunk-x:${x}`, () => assert.equal(typeof chunkKeyFor(x, 12), 'string'));
}
for (const z of [-512, -129, -128, -127.9, -64, -1, 0, .1, 1, 63.9, 64, 127.9, 128, 256, 511.5]) {
  check(`chunk-z:${z}`, () => assert.equal(typeof chunkKeyFor(12, z), 'string'));
}
for (const value of [1, 2, 3, 7, 13, 29, 61, 127, 257, 509]) {
  check(`seed:${value}`, () => { const a = planRuntime(base({ seed: value })); const b = planRuntime(base({ seed: value })); assert.equal(runtimePlanDigest(a), runtimePlanDigest(b)); });
}
for (const moisture of [0, .05, .12, .25, .4, .5, .65, .8, .95, 1]) {
  check(`moisture:${moisture}`, () => { const result = planRuntime(base({ anchor: { x: 24, z: 24, id: `m-${moisture}`, surface: surface({ moisture }) } })); assert.equal(result.ok, true); });
}
for (const elevationMeters of [-10, 0, 50, 120, 250, 500, 900, 1400, 2200]) {
  check(`elevation:${elevationMeters}`, () => { const result = planRuntime(base({ anchor: { x: 24, z: 24, id: `e-${elevationMeters}`, surface: surface({ elevationMeters }) } })); assert.equal(result.ok, true); });
}
for (const slopeDegrees of [0, 2, 8, 15, 22, 30, 38, 48, 60, 72]) {
  check(`slope:${slopeDegrees}`, () => { const result = planRuntime(base({ anchor: { x: 24, z: 24, id: `s-${slopeDegrees}`, surface: surface({ slopeDegrees }) } })); assert.equal(result.ok, true); });
}
for (const mode of ['ambient', 'roadside', 'settlementEdge', 'geology', 'shoreline']) {
  check(`mode:${mode}`, () => { const result = planRuntime(base({ mode, familyIds: ['pine', 'wetboulder', 'waystone', 'timberfence', 'dock'] })); assert.equal(result.ok, true); });
}
for (const mobile of [false, true]) {
  check(`mobile:${mobile}`, () => { const result = planRuntime(base({ mobile })); assert.equal(result.ok, true); assert.ok(result.acceptedCount >= 0); });
}
for (const point of [{ x: 0, z: 64 }, { x: 1, z: 64 }, { x: 7.9, z: 64 }, { x: 120, z: 64 }, { x: 127.9, z: 64 }, { x: 128, z: 64 }, { x: 128.1, z: 64 }]) {
  check(`boundary-point:${point.x}`, () => { assert.ok(typeof boundaryOwnerFor(point.x, point.z) === 'string'); });
}
for (const regionId of ['north_temperate_forest', 'north_windwood', 'riverlands_meadow', 'vale_high_valley', 'westerlands_woodland', 'reach_fertile_plain', 'crownlands_lowland', 'stormlands_wet_forest', 'dorne_desert_core', 'iron_islands_wind_coast', 'mountain_granite_ridge', 'volcanic_basalt_field', 'ruined_lowland', 'settlement_market_edge']) {
  check(`region:${regionId}`, () => { const result = planRuntime(base({ regionId, seed: regionId.length * 101 })); assert.equal(result.ok, true); });
}
for (let i = 0; i < 50; i += 1) {
  check(`execution:${i}`, () => {
    const result = buildChunkExecution({ chunkKey: '0:0', anchors: [{ x: 16 + (i % 8) * 10, z: 16 + Math.floor(i / 8) * 10, id: `x-${i}`, surface: surface({ moisture: (i % 10) / 10 }) }], regionId: 'reach_fertile_plain', familyIds: ['meadowgrass', 'timberfence'], mode: i % 2 ? 'ambient' : 'settlementEdge', seed: i + 1000, mobile: i % 3 === 0, camera: { x: 64, z: 64, far: 520 } });
    assert.equal(result.ok, true); assert.equal(validateExecutionFrame(result.execution).ok, true); assert.equal(buildFrameDigest(result.execution), buildFrameDigest(result.execution));
  });
}
for (let i = 0; i < 30; i += 1) {
  check(`execution-determinism:${i}`, () => {
    const options = { chunkKey: '0:0', anchors: [{ x: 20, z: 20, id: `d-${i}`, surface: surface({ elevationMeters: i * 20 }) }], regionId: 'north_temperate_forest', familyIds: ['pine', 'birch'], mode: 'ambient', seed: 2200 + i, mobile: i % 2 === 0, camera: { x: i, z: i, far: 400 + i } };
    assert.equal(verifyExecutionDeterminism(options).ok, true);
  });
}
for (let i = 0; i < 20; i += 1) {
  check(`audit:${i}`, () => {
    const plan = buildChunkRuntimePlan({ chunkKey: '0:0', anchors: [{ x: 24, z: 24, id: `a-${i}`, surface: surface({ moisture: .4 + (i % 4) * .15 }) }], regionId: 'riverlands_meadow', familyIds: ['meadowgrass', 'waystone'], mode: 'ambient', seed: 3100 + i });
    const audit = auditPlan(plan, '0:0');
    assert.equal(typeof audit.organic.score, 'number');
    assert.ok(audit.sampleCount >= 0);
  });
}
for (const positions of [
  [{ x: 0, z: 0 }, { x: 5, z: 5 }, { x: 10, z: 0 }, { x: 5, z: -5 }, { x: -4, z: 0 }, { x: 0, z: 4 }],
  [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }, { x: 4, z: 0 }, { x: 5, z: 0 }],
  [{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 5, z: 5 }, { x: 2, z: 7 }],
]) {
  check(`organic-shape:${JSON.stringify(positions)}`, () => { assert.equal(typeof qualifyOrganicDistribution(positions.map((item, i) => ({ ...item, familyId: i % 2 ? 'pine' : 'birch' }))).score, 'number'); });
}
for (const count of [0, 1, 2, 3, 4, 5, 6, 8, 12, 20]) {
  check(`nn-count:${count}`, () => { const items = Array.from({ length: count }, (_, i) => ({ x: i * 4, z: (i % 2) * 2, familyId: 'pine' })); assert.equal(nearestNeighborStats(items).sampleCount, count); });
}
for (const familySet of [['pine'], ['birch'], ['pine', 'birch'], ['granite', 'basalt'], ['meadowgrass', 'marshreed', 'wetboulder'], ['marketstall', 'timberfence', 'waystone']]) {
  check(`families:${familySet.join('-')}`, () => { const result = planRuntime(base({ familyIds: familySet })); assert.equal(result.ok, true); });
}
for (let i = 0; i < 15; i += 1) {
  check(`empty-anchor-${i}`, () => { const result = buildChunkRuntimePlan({ chunkKey: '0:0', anchors: [], regionId: 'north_temperate_forest', familyIds: ['pine'], mode: 'ambient', seed: i }); assert.equal(result.ok, true); assert.equal(result.accepted.length, 0); });
}
for (const surfaceExtra of [
  { isWater: true, waterBody: 'lake' },
  { isWater: true, waterBody: 'river' },
  { waterDepth: 1.2, biome: 'marsh' },
  { shorelineDistanceMeters: 0 },
  { shorelineDistanceMeters: 1.2 },
  { roadDistanceMeters: 0 },
  { roadDistanceMeters: 0.5 },
  { settlementDistanceMeters: 0 },
  { cryosphere: { snowPersistence: 1, vegetationSuppression: 1 } },
  { season: { winter: 1, summer: 0 } },
]) {
  check(`surface-edge:${JSON.stringify(surfaceExtra)}`, () => { const mode = surfaceExtra.isWater ? 'shoreline' : 'ambient'; const result = planRuntime(base({ mode, anchor: { x: 20, z: 20, id: 'surface-edge', surface: surface(surfaceExtra) }, familyIds: ['marshreed', 'wetboulder', 'dock', 'pine', 'snowpine'] })); assert.equal(result.ok, true); });
}

if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; } else { console.log(JSON.stringify({ ok: true, failureCount: 0, testGroups: 13 })); }
