import assert from 'node:assert/strict';
import {
  LIVING_WORLD_GEOGRAPHY_POLICY,
  LIVING_WORLD_GEOGRAPHY_ASSET_ROLES,
  auditLivingWorldGeographyCatalog,
  canonicalGeographySnapshot,
  materialSurfaceRolesForLivingWorld,
  resolveLivingWorldAssetProfile,
  resolveLivingWorldGeography,
  resolveLivingWorldSceneryFamilies,
  validateLivingWorldSpawn,
} from '../src/3d/gameplay/livingWorldGeographyAdapter.js';
import { WORLD_SCALE } from '../src/3d/config.js';

const toWorld = (x, y) => ({
  x: (x - 0.5) * (WORLD_SCALE.MAP_BOUNDS.maxX - WORLD_SCALE.MAP_BOUNDS.minX) * WORLD_SCALE.METERS_PER_MAP_UNIT,
  z: (y - 0.5) * (WORLD_SCALE.MAP_BOUNDS.maxY - WORLD_SCALE.MAP_BOUNDS.minY) * WORLD_SCALE.METERS_PER_MAP_UNIT,
});
const safe = (point, extra = {}) => resolveLivingWorldGeography({ worldX: point.x, worldZ: point.z, slopeDegrees: 5, waterDepth: 0, settlementDistance: 500, roadDistance: 50, role: 'guard', ...extra });

assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.deterministic, true);
assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.noSecondBiomeFramework, true);
assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.materialAuthority, 'MaterialAssignmentCore.js');
assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.placementAuthority, 'WorldAssetPlacementPipeline.js');
assert.deepEqual(LIVING_WORLD_GEOGRAPHY_ASSET_ROLES.human, ['skin','hair','eyes','clothing','boots','gear']);
assert.deepEqual(LIVING_WORLD_GEOGRAPHY_ASSET_ROLES.horse, ['coat','mane','tail','hoof','saddle','harness']);
assert.deepEqual(LIVING_WORLD_GEOGRAPHY_ASSET_ROLES.wildlife, ['fur','eye','claw','tooth']);
assert.deepEqual(LIVING_WORLD_GEOGRAPHY_ASSET_ROLES.dragon, ['scale','wing','eye','horn','claw']);

const grid = [];
for (let x = 0.10; x <= 0.90; x += 0.16) {
  for (let y = 0.10; y <= 0.90; y += 0.16) {
    const point = toWorld(Number(x.toFixed(4)), Number(y.toFixed(4)));
    grid.push({ point, result: safe(point) });
  }
}
const snapshot = canonicalGeographySnapshot(grid.map(({ point }) => point));
assert.equal(snapshot.length, grid.length);
assert.ok(snapshot.every((entry) => typeof entry.region === 'string' && entry.region.length > 0));
assert.deepEqual(snapshot, canonicalGeographySnapshot(grid.map(({ point }) => point)));

const reachLike = toWorld(0.16, 0.58);
const desertLike = toWorld(0.18, 0.66);
const wolf = safe(reachLike, { speciesId: 'wolf', role: 'wildlife' });
const wolfAgain = safe(reachLike, { speciesId: 'wolf', role: 'wildlife' });
assert.deepEqual(wolf, wolfAgain);
assert.equal(resolveLivingWorldGeography({ ...wolf.position, worldX: reachLike.x, worldZ: reachLike.z, speciesId: 'wolf', role: 'wildlife', slopeDegrees: 5, waterDepth: 0, settlementDistance: 500, roadDistance: 50 }).reason, wolf.reason);
const wolfDry = safe(desertLike, { speciesId: 'wolf', role: 'wildlife' });
assert.equal(wolfDry.ok, false);

const horseSlope = safe(reachLike, { speciesId: 'horse', role: 'wildlife', slopeDegrees: 29 });
assert.equal(horseSlope.ok, false);
const horseWater = safe(reachLike, { speciesId: 'horse', role: 'wildlife', waterDepth: 0.10 });
assert.equal(horseWater.ok, false);

const road = validateLivingWorldSpawn({ position: reachLike, seed: 'road' }, {
  groundHeight: 20,
  slopeDegrees: 5,
  waterDepth: 0,
  roadEdges: [{ points: [{ x: reachLike.x - 4, z: reachLike.z }, { x: reachLike.x + 4, z: reachLike.z }] }],
  settlementSeats: [], role: 'wildlife', speciesId: 'horse',
});
assert.equal(road.ok, false);
assert.equal(road.reason, 'road-buffer');

const settlement = validateLivingWorldSpawn({ position: reachLike, seed: 'settlement' }, {
  groundHeight: 20,
  slopeDegrees: 5,
  waterDepth: 0,
  roadEdges: [],
  settlementSeats: [{ x: reachLike.x + 10, z: reachLike.z }], role: 'wildlife', speciesId: 'horse',
});
assert.equal(settlement.ok, false);
assert.equal(settlement.reason, 'settlement-buffer');

for (const role of ['guard', 'wildlife']) {
  const profile = resolveLivingWorldAssetProfile({ worldX: reachLike.x, worldZ: reachLike.z, role, speciesId: role === 'wildlife' ? 'wolf' : null });
  assert.ok(profile.assetCandidates.length > 0);
  assert.ok(profile.assetCandidates.every((path) => path.startsWith('assets/models/')));
  assert.ok(profile.surfaceRoles.length >= 4);
}
const humanRoles = materialSurfaceRolesForLivingWorld({ role: 'guard', worldX: reachLike.x, worldZ: reachLike.z });
assert.ok(humanRoles.surfaceRoles.includes('skin'));
assert.ok(humanRoles.surfaceRoles.includes('clothing'));
assert.equal(humanRoles.sharedMaterialAuthority, 'MaterialAssignmentCore.js');
assert.equal(humanRoles.sharedPlacementAuthority, 'WorldAssetPlacementPipeline.js');
assert.ok(resolveLivingWorldSceneryFamilies(reachLike.x, reachLike.z).families.length > 0);

const catalog = auditLivingWorldGeographyCatalog();
assert.equal(catalog.ok, true, catalog.errors.join('\n'));
assert.equal(catalog.errors.length, 0);
assert.ok(catalog.regionCount >= 10);

console.log(JSON.stringify({ ok: true, policy: LIVING_WORLD_GEOGRAPHY_POLICY.id, samples: grid.length, catalogRegions: catalog.regionCount }));
console.log('LIVING_WORLD_GEOGRAPHY_CONTRACT_PASS');
