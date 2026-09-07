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
import { KINGDOM_SEATS } from '../src/3d/world/settlements.js';
import { worldXZToNormalizedReference } from '../src/3d/world/worldReferenceAlignment.js';

const pointFor = (x, y) => {
  const p = { x, y };
  return { x: (p.x - 0.5) * (WORLD_SCALE.MAP_BOUNDS.maxX - WORLD_SCALE.MAP_BOUNDS.minX) * WORLD_SCALE.METERS_PER_MAP_UNIT, z: (p.y - 0.5) * (WORLD_SCALE.MAP_BOUNDS.maxY - WORLD_SCALE.MAP_BOUNDS.minY) * WORLD_SCALE.METERS_PER_MAP_UNIT };
};

function checkPolicy() {
  assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.deterministic, true);
  assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.noSecondBiomeFramework, true);
  assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.alignmentAuthority, 'owner-map-canvas-alignment-2026-08-08');
  assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.terrainAuthority, 'world/terrain.js');
  assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.materialAuthority, 'MaterialAssignmentCore.js');
  assert.equal(LIVING_WORLD_GEOGRAPHY_POLICY.placementAuthority, 'WorldAssetPlacementPipeline.js');
  assert.deepEqual(LIVING_WORLD_GEOGRAPHY_ASSET_ROLES.human, ['skin','hair','eyes','clothing','boots','gear']);
  assert.deepEqual(LIVING_WORLD_GEOGRAPHY_ASSET_ROLES.horse, ['coat','mane','tail','hoof','saddle','harness']);
  assert.deepEqual(LIVING_WORLD_GEOGRAPHY_ASSET_ROLES.wildlife, ['fur','eye','claw','tooth']);
  assert.deepEqual(LIVING_WORLD_GEOGRAPHY_ASSET_ROLES.dragon, ['scale','wing','eye','horn','claw']);
}

function checkCanonicalRegionResolution() {
  const cases = [
    [[0.145, 0.115], 'snow'],
    [[0.175, 0.285], 'north'],
    [[0.185, 0.445], 'marsh'],
    [[0.245, 0.445], 'mountain'],
    [[0.135, 0.505], 'westerlands'],
    [[0.155, 0.585], 'reach'],
    [[0.180, 0.665], 'desert'],
    [[0.545, 0.535], 'steppe'],
    [[0.660, 0.680], 'arid'],
    [[0.330, 0.455], 'coast'],
    [[0.555, 0.900], 'jungle'],
    [[0.925, 0.945], 'jungle'],
  ];
  const snapshot = [];
  for (const [[nx, ny], expected] of cases) {
    const point = pointFor(nx, ny);
    const first = resolveLivingWorldGeography({ worldX: point.x, worldZ: point.z, role: 'guard', slopeDegrees: 5, waterDepth: 0, settlementDistance: 500, roadDistance: 50, seed: 'geo' });
    const second = resolveLivingWorldGeography({ worldX: point.x, worldZ: point.z, role: 'guard', slopeDegrees: 5, waterDepth: 0, settlementDistance: 500, roadDistance: 50, seed: 'geo' });
    assert.equal(first.region, expected, `${nx},${ny} resolved ${first.region}, expected ${expected}`);
    assert.deepEqual(first, second);
    assert.ok(first.normalizedReference.x >= 0 && first.normalizedReference.x <= 1);
    assert.ok(first.normalizedReference.y >= 0 && first.normalizedReference.y <= 1);
    snapshot.push({ point, region: first.region, zone: first.zone.id });
  }
  const repeat = canonicalGeographySnapshot(snapshot.map((item) => item.point));
  assert.deepEqual(repeat.map((item) => item.region), snapshot.map((item) => item.region));
}

function checkSpeciesHabitat() {
  const reach = pointFor(0.155, 0.585);
  const desert = pointFor(0.180, 0.665);
  const valyria = pointFor(0.83, 0.86);
  const wolfReach = resolveLivingWorldGeography({ worldX: reach.x, worldZ: reach.z, speciesId: 'wolf', role: 'wildlife', slopeDegrees: 10, waterDepth: 0, settlementDistance: 300, roadDistance: 50 });
  assert.equal(wolfReach.ok, true);
  const wolfDesert = resolveLivingWorldGeography({ worldX: desert.x, worldZ: desert.z, speciesId: 'wolf', role: 'wildlife', slopeDegrees: 10, waterDepth: 0, settlementDistance: 300, roadDistance: 50 });
  assert.equal(wolfDesert.ok, false);
  assert.equal(wolfDesert.reason, 'species-region');
  const horseReach = resolveLivingWorldGeography({ worldX: reach.x, worldZ: reach.z, speciesId: 'horse', role: 'wildlife', slopeDegrees: 27, waterDepth: 0, settlementDistance: 300, roadDistance: 50 });
  assert.equal(horseReach.ok, true);
  const horseSteep = resolveLivingWorldGeography({ worldX: reach.x, worldZ: reach.z, speciesId: 'horse', role: 'wildlife', slopeDegrees: 28.1, waterDepth: 0, settlementDistance: 300, roadDistance: 50 });
  assert.equal(horseSteep.ok, false);
  const dragonValyria = resolveLivingWorldGeography({ worldX: valyria.x, worldZ: valyria.z, speciesId: 'dragon', role: 'wildlife', slopeDegrees: 39, waterDepth: 0, settlementDistance: 300, roadDistance: 50 });
  assert.equal(dragonValyria.ok, true);
  const waterFailure = resolveLivingWorldGeography({ worldX: reach.x, worldZ: reach.z, speciesId: 'horse', role: 'wildlife', slopeDegrees: 10, waterDepth: 0.051, settlementDistance: 300, roadDistance: 50 });
  assert.equal(waterFailure.ok, false);
}

function checkExclusions() {
  const point = pointFor(0.155, 0.585);
  const road = validateLivingWorldSpawn({ position: point, seed: 'exclusion' }, { groundHeight: 20, slopeDegrees: 5, waterDepth: 0, settlementSeats: [], roadEdges: [{ points: [{ x: point.x - 5, z: point.z }, { x: point.x + 5, z: point.z }] }], role: 'wildlife', speciesId: 'horse' });
  assert.equal(road.ok, false);
  assert.equal(road.reason, 'road-buffer');
  const seat = validateLivingWorldSpawn({ position: point, seed: 'exclusion' }, { groundHeight: 20, slopeDegrees: 5, waterDepth: 0, settlementSeats: [{ x: point.x + 10, z: point.z }], roadEdges: [], role: 'wildlife', speciesId: 'horse' });
  assert.equal(seat.ok, false);
  assert.equal(seat.reason, 'settlement-buffer');
  const slope = validateLivingWorldSpawn({ position: point, seed: 'exclusion' }, { groundHeight: 20, slopeDegrees: 29, waterDepth: 0, settlementSeats: [], roadEdges: [], role: 'wildlife', speciesId: 'horse' });
  assert.equal(slope.ok, false);
  assert.equal(slope.reason, 'slope');
}

function checkAssetProfilesAndSurfaceRoles() {
  const snow = pointFor(0.145, 0.115);
  const desert = pointFor(0.180, 0.665);
  const jungle = pointFor(0.555, 0.900);
  const valyria = pointFor(0.83, 0.86);
  const human = materialSurfaceRolesForLivingWorld({ role: 'guard', worldX: snow.x, worldZ: snow.z });
  assert.ok(human.assetCandidates.length >= 2);
  assert.ok(human.surfaceRoles.includes('skin') && human.surfaceRoles.includes('clothing'));
  const winter = resolveLivingWorldAssetProfile({ role: 'guard', worldX: snow.x, worldZ: snow.z });
  const dry = resolveLivingWorldAssetProfile({ role: 'guard', worldX: desert.x, worldZ: desert.z });
  const tropical = resolveLivingWorldAssetProfile({ role: 'guard', worldX: jungle.x, worldZ: jungle.z });
  const volcanic = resolveLivingWorldAssetProfile({ role: 'wildlife', speciesId: 'dragon', worldX: valyria.x, worldZ: valyria.z });
  assert.equal(winter.region, 'snow');
  assert.equal(dry.region, 'desert');
  assert.equal(tropical.region, 'jungle');
  assert.equal(volcanic.region, 'valyria');
  assert.ok(volcanic.surfaceRoles.includes('scale') && volcanic.surfaceRoles.includes('wing'));
  assert.ok(dry.assetCandidates.every((path) => path.startsWith('assets/models/')));
  assert.ok(tropical.assetCandidates.every((path) => path.startsWith('assets/models/')));
  assert.ok(resolveLivingWorldSceneryFamilies(valyria.x, valyria.z).families.includes('volcanic-spire'));
}

function checkSettlementAndAlignment() {
  assert.equal(KINGDOM_SEATS.length, 14);
  for (const seat of KINGDOM_SEATS) {
    const world = pointFor(seat.mapX / 9000, seat.mapY / 7000);
    const normalized = worldXZToNormalizedReference(world.x, world.z, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    assert.ok(Math.abs(normalized.x - seat.mapX / 9000) < 1e-12);
    assert.ok(Math.abs(normalized.y - seat.mapY / 7000) < 1e-12);
  }
}

function checkCatalog() {
  const audit = auditLivingWorldGeographyCatalog();
  assert.equal(audit.ok, true, audit.errors.join('\n'));
  assert.equal(audit.errors.length, 0);
  assert.equal(audit.regionCount, 12);
}

function checkDeterminismAcrossGrid() {
  const first = [];
  const second = [];
  for (let x = 0.08; x <= 0.92; x += 0.14) {
    for (let y = 0.10; y <= 0.90; y += 0.16) {
      const point = pointFor(Number(x.toFixed(4)), Number(y.toFixed(4)));
      const args = { worldX: point.x, worldZ: point.z, speciesId: 'horse', role: 'wildlife', slopeDegrees: 8, waterDepth: 0, settlementDistance: 300, roadDistance: 50, seed: 'grid' };
      first.push(resolveLivingWorldGeography(args));
      second.push(resolveLivingWorldGeography(args));
    }
  }
  assert.deepEqual(first, second);
}

checkPolicy();
checkCanonicalRegionResolution();
checkSpeciesHabitat();
checkExclusions();
checkAssetProfilesAndSurfaceRoles();
checkSettlementAndAlignment();
checkCatalog();
checkDeterminismAcrossGrid();
console.log(JSON.stringify({ ok: true, policy: LIVING_WORLD_GEOGRAPHY_POLICY.id, regions: 12, kingdomSeats: KINGDOM_SEATS.length, gridDeterministic: true }));
console.log('LIVING_WORLD_GEOGRAPHY_ADAPTER_PASS');
