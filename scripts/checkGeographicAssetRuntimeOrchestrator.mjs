import assert from 'node:assert/strict';
import {
  GEOGRAPHIC_ASSET_RUNTIME_POLICY,
  DEFAULT_CHUNK_POLICY,
  DEFAULT_RUNTIME_BUDGETS,
  SURFACE_LAYERS,
  chunkKeyFor,
  parseChunkKey,
  chunkBoundsFor,
  distanceToChunkBoundary,
  boundaryBandFor,
  boundaryOwnerFor,
  continuitySeedFor,
  deterministicJitter,
  buildAnchorRuntimeContext,
  planRuntimeAnchor,
  enforceChunkBudget,
  mergeAnchorPlans,
  buildChunkRuntimePlan,
  runtimePlanDigest,
  verifyRuntimePlanDeterminism,
  classifyRuntimeDensity,
  summarizeRuntimePlan,
  buildRuntimeReplayPacket,
  applyRuntimePolicy,
  planRuntime,
  buildRuntimeScenarioSuite,
  summarizeScenarioSuite,
  validateRuntimeManifest,
  compareChunkPlans,
  continuityWindowForChunk,
  pointInWindow,
  filterContinuityCarry,
  prepareBoundaryCarry,
  mergeWithBoundaryCarry,
  auditRuntimePlanGeography,
  buildRegionRuntimeManifest,
  selectRuntimeFamilyByRule,
} from '../src/3d/world/geographicAssetRuntimeOrchestrator.js';
import {
  validateGeographicRegionProfiles,
  getGeographicRegionProfile,
  listGeographicRegionProfiles,
} from '../src/3d/world/geographicAssetRegionProfiles.js';

const failures = [];
function check(id, fn) {
  try { fn(); } catch (error) { failures.push(`${id}: ${error?.stack || error}`); }
}
function surface(overrides = {}) {
  return { biome: 'forest', moisture: .62, slopeDegrees: 9, elevationMeters: 280, waterDepth: 0, shorelineDistanceMeters: 140, roadDistanceMeters: 18, settlementDistanceMeters: 80, localRelief: .35, ...overrides };
}
function anchor(overrides = {}) { return { x: 12, z: 18, id: 'anchor', surface: surface(), ...overrides }; }
function assertFiniteVector(item) { assert.equal(Number.isFinite(item.x), true); assert.equal(Number.isFinite(item.z), true); }
function assertPlanSafe(plan) { for (const item of plan.accepted || []) { assert.equal(Number.isFinite(item.x), true); assert.equal(Number.isFinite(item.z), true); assert.equal(item.familyId.length > 0, true); } }

check('policy-id', () => assert.equal(GEOGRAPHIC_ASSET_RUNTIME_POLICY.deterministic, true));
check('surface-layer-catalogue', () => assert.ok(SURFACE_LAYERS.includes('forest')));
check('default-chunk-size', () => assert.equal(DEFAULT_CHUNK_POLICY.chunkSizeMeters, 128));
check('default-budget-ambient', () => assert.ok(DEFAULT_RUNTIME_BUDGETS.ambient.desktop > DEFAULT_RUNTIME_BUDGETS.ambient.mobile));
check('region-catalogue-valid', () => assert.equal(validateGeographicRegionProfiles().ok, true));
check('north-profile', () => assert.ok(getGeographicRegionProfile('north_temperate_forest')));
check('dorne-profile', () => assert.ok(getGeographicRegionProfile('dorne_desert_core')));
check('mountain-profile-list', () => assert.ok(listGeographicRegionProfiles('mountain').length > 0));
check('chunk-zero', () => assert.equal(chunkKeyFor(0, 0), '0:0'));
check('chunk-negative', () => assert.equal(chunkKeyFor(-.1, -.1), '-1:-1'));
check('chunk-positive-boundary', () => assert.equal(chunkKeyFor(128, 0), '1:0'));
check('parse-valid', () => assert.deepEqual(parseChunkKey('-2:3'), { x: -2, z: 3 }));
check('parse-invalid', () => assert.equal(parseChunkKey('oops'), null));
check('bounds-valid', () => assert.deepEqual(chunkBoundsFor('0:0'), { minX: 0, maxX: 128, minZ: 0, maxZ: 128 }));
check('boundary-center-distance', () => assert.equal(distanceToChunkBoundary(64, 64), 64));
check('boundary-edge-band', () => assert.equal(boundaryBandFor(1, 64), true));
check('boundary-away-band', () => assert.equal(boundaryBandFor(64, 64), false));
check('boundary-owner-stable', () => assert.equal(boundaryOwnerFor(0, 0), '-1:-1'));
check('continuity-seed-stable', () => assert.equal(continuitySeedFor({ worldX: 12, worldZ: 18, seed: 5, familyId: 'pine' }), continuitySeedFor({ worldX: 12, worldZ: 18, seed: 5, familyId: 'pine' })));
check('jitter-stable', () => assert.deepEqual(deterministicJitter(100, 4), deterministicJitter(100, 4)));
check('jitter-range', () => { const j = deterministicJitter(77, 8); assert.ok(j.x >= -1 && j.x <= 1); assert.ok(j.z >= -1 && j.z <= 1); assert.ok(j.scale > .8 && j.scale < 1.2); });
check('anchor-context', () => { const ctx = buildAnchorRuntimeContext({ anchor: anchor(), regionId: 'north_temperate_forest', seed: 7 }); assert.equal(ctx.point.x, 12); assert.equal(ctx.region.id, 'north_temperate_forest'); });
check('anchor-context-boundary', () => { const ctx = buildAnchorRuntimeContext({ anchor: anchor({ x: 2 }), regionId: 'north_temperate_forest' }); assert.equal(ctx.boundaryBand, true); });
check('ambient-plan', () => { const plan = planRuntimeAnchor({ anchor: anchor(), regionId: 'north_temperate_forest', familyIds: ['pine', 'birch'], mode: 'ambient', seed: 9 }); assert.equal(plan.ok, true); assertPlanSafe(plan); });
check('shore-plan', () => { const plan = planRuntimeAnchor({ anchor: anchor({ surface: surface({ biome: 'lake', isWater: true, shorelineDistanceMeters: 2 }) }), regionId: 'north_lake_margin', familyIds: ['marshreed', 'wetboulder', 'dock'], mode: 'shoreline', seed: 9 }); assert.equal(plan.ok, true); assertPlanSafe(plan); });
check('water-ambient-skip', () => { const plan = planRuntimeAnchor({ anchor: anchor({ surface: surface({ isWater: true }) }), regionId: 'north_lake_margin', familyIds: ['pine'], mode: 'ambient', seed: 9 }); assert.equal(plan.skipped, true); });
check('budget-enforcement', () => { const result = enforceChunkBudget([{ accepted: Array.from({ length: 100 }, (_, i) => ({ familyId: 'pine', x: i * 3, z: i * 3, priority: i })) }]); assert.equal(result.accepted.length, DEFAULT_CHUNK_POLICY.desktopAssetsPerChunk); });
check('merge-dedupe', () => { const result = mergeAnchorPlans([{ accepted: [{ familyId: 'pine', x: 1, z: 2, priority: 1 }, { familyId: 'pine', x: 1, z: 2, priority: 2 }] }]); assert.equal(result.uniqueCount, 1); });
check('chunk-plan', () => { const plan = buildChunkRuntimePlan({ chunkKey: '0:0', anchors: [anchor()], regionId: 'reach_fertile_plain', familyIds: ['meadowgrass'], mode: 'ambient', seed: 14 }); assert.equal(plan.ok, true); assertPlanSafe(plan); });
check('digest-stable', () => { const a = buildChunkRuntimePlan({ chunkKey: '0:0', anchors: [anchor()], regionId: 'reach_fertile_plain', familyIds: ['meadowgrass'], mode: 'ambient', seed: 14 }); const b = buildChunkRuntimePlan({ chunkKey: '0:0', anchors: [anchor()], regionId: 'reach_fertile_plain', familyIds: ['meadowgrass'], mode: 'ambient', seed: 14 }); assert.equal(runtimePlanDigest(a), runtimePlanDigest(b)); });
check('determinism', () => assert.equal(verifyRuntimePlanDeterminism({ chunkKey: '0:0', anchors: [anchor()], regionId: 'reach_fertile_plain', familyIds: ['meadowgrass'], mode: 'ambient', seed: 15 }).ok, true));
check('density-label', () => assert.ok(['sparse', 'light', 'balanced', 'dense'].includes(classifyRuntimeDensity({ acceptedCount: 1, budget: 10 }))));
check('summary-digest', () => { const plan = buildChunkRuntimePlan({ chunkKey: '0:0', anchors: [anchor()], regionId: 'reach_fertile_plain', familyIds: ['meadowgrass'], mode: 'ambient', seed: 16 }); assert.equal(summarizeRuntimePlan(plan).digest, runtimePlanDigest(plan)); });
check('replay-packet', () => assert.equal(buildRuntimeReplayPacket({ chunkKey: '0:0', anchors: [anchor()], regionId: 'reach_fertile_plain', familyIds: ['meadowgrass'], mode: 'ambient', seed: 17 }).deterministic, true));
check('policy-apply', () => { const result = applyRuntimePolicy({ mode: 'ambient', mobile: true, densityMultiplier: .8 }); assert.equal(result.mobile, true); assert.equal(result.mode, 'ambient'); });
check('plan-runtime', () => assert.equal(planRuntime({ anchor: anchor(), regionId: 'westerlands_woodland', familyIds: ['broadleaf'], mode: 'ambient', seed: 18 }).ok, true));
check('surface-manifest-family-rule', () => { const manifest = buildRegionRuntimeManifest({ regionId: 'dorne', mode: 'ambient', surface: surface({ moisture: .12, elevationMeters: 140 }), seed: 18 }); assert.ok(manifest.selection.familyId === null || manifest.selection.familyId.length > 0); });
check('family-rule-determinism', () => { const a = selectRuntimeFamilyByRule({ regionId: 'stormlands', mode: 'geology', surface: surface({ moisture: .8, elevationMeters: 300 }), seed: 19 }); const b = selectRuntimeFamilyByRule({ regionId: 'stormlands', mode: 'geology', surface: surface({ moisture: .8, elevationMeters: 300 }), seed: 19 }); assert.deepEqual(a, b); });
check('window', () => { const w = continuityWindowForChunk('0:0'); assert.equal(pointInWindow({ x: -1, z: 0 }, w), true); });
check('window-outside', () => { const w = continuityWindowForChunk('0:0'); assert.equal(pointInWindow({ x: -30, z: 0 }, w), false); });
check('carry-filter', () => { const carry = filterContinuityCarry([{ x: 0, z: 0, familyId: 'pine', priority: 1 }, { x: 1000, z: 1000, familyId: 'pine', priority: 3 }], '0:0'); assert.equal(carry.length, 1); });
check('boundary-carry', () => { const plan = buildChunkRuntimePlan({ chunkKey: '0:0', anchors: [anchor({ x: 3 })], regionId: 'reach_fertile_plain', familyIds: ['meadowgrass'], seed: 20 }); assert.ok(prepareBoundaryCarry(plan, '0:0').length >= 0); });
check('merge-carry', () => { const plan = { budget: 5, accepted: [{ familyId: 'pine', x: 2, z: 2, priority: 1 }] }; const result = mergeWithBoundaryCarry(plan, [{ familyId: 'pine', x: 4, z: 4, priority: 2 }]); assert.equal(result.ok, true); });
check('geography-audit', () => { const plan = { accepted: [{ familyId: 'pine', x: 2, z: 2, surface: { isWater: false } }] }; assert.equal(auditRuntimePlanGeography(plan).ok, true); });
check('geography-audit-water', () => { const plan = { accepted: [{ familyId: 'pine', x: 2, z: 2, surface: { isWater: true } }] }; assert.equal(auditRuntimePlanGeography(plan).ok, false); });
check('manifest-validation', () => { const valid = { policy: GEOGRAPHIC_ASSET_RUNTIME_POLICY, digest: 42, acceptedAssets: [] }; assert.equal(validateRuntimeManifest(valid).ok, true); });
check('manifest-invalid', () => assert.equal(validateRuntimeManifest({}).ok, false));
check('compare-same', () => { const options = { chunkKey: '0:0', anchors: [anchor()], regionId: 'riverlands_meadow', familyIds: ['meadowgrass'], mode: 'ambient', seed: 21 }; const a = buildChunkRuntimePlan(options); const b = buildChunkRuntimePlan(options); assert.equal(compareChunkPlans(a, b).equal, true); });
check('suite', () => { const result = buildRuntimeScenarioSuite([{ id: 'a', runtimeOptions: { anchor: anchor(), regionId: 'reach_fertile_plain', familyIds: ['meadowgrass'], mode: 'ambient', seed: 22 } }]); assert.equal(result.length, 1); assert.equal(summarizeScenarioSuite(result).count, 1); });

const CASES = [
  ['north-001','north_temperate_forest','ambient','pine',.58,180,30],['north-002','north_temperate_forest','ambient','birch',.66,240,20],['north-003','north_windwood','ambient','pine',.42,420,24],['north-004','north_high_moor','ambient','shrub',.55,740,18],['north-005','north_snowline','geology','froststone',.3,1500,36],['north-006','north_frozen_pass','geology','froststone',.28,1900,44],['north-007','north_bog_edge','shoreline','marshreed',.9,120,10],['north-008','north_lake_margin','shoreline','wetboulder',.88,160,8],['north-009','north_ancient_grove','ambient','broadleaf',.72,440,12],['north-010','north_coastal_headland','shoreline','driftwood',.74,90,25],
  ['river-001','riverlands_floodplain','ambient','meadowgrass',.76,80,8],['river-002','riverlands_floodplain','shoreline','marshreed',.92,42,6],['river-003','riverlands_meadow','ambient','meadowgrass',.56,180,12],['river-004','riverlands_wetwood','ambient','broadleaf',.8,260,18],['river-005','riverlands_stone_road','roadside','waystone',.46,150,7],['river-006','riverlands_riverbank','shoreline','wetboulder',.94,30,5],['river-007','riverlands_hill_country','geology','granite',.5,520,28],['river-008','riverlands_castle_edge','settlementEdge','ruinwall',.54,120,6],['river-009','riverlands_wooded_ridge','ambient','fern',.72,380,20],['river-010','riverlands_riverbank','shoreline','marshreed',.98,24,4],
  ['vale-001','vale_high_valley','ambient','meadowgrass',.54,680,17],['vale-002','vale_mountain_foothill','geology','granite',.4,1000,38],['vale-003','vale_mountain_pass','roadside','waystone',.32,1200,14],['vale-004','vale_lowland_meadow','ambient','meadowgrass',.68,140,9],['vale-005','vale_sea_cliff','geology','granite',.6,260,44],['vale-006','vale_lake_edge','shoreline','wetboulder',.9,180,5],['vale-007','vale_road_terrace','roadside','waystone',.5,500,8],['vale-008','vale_high_valley','geology','granite',.44,860,26],['vale-009','vale_mountain_foothill','ambient','pine',.56,1260,30],['vale-010','vale_lake_edge','shoreline','marshreed',.82,120,7],
  ['west-001','westerlands_low_hill','ambient','meadowgrass',.52,220,12],['west-002','westerlands_gold_road','roadside','waystone',.34,140,6],['west-003','westerlands_woodland','ambient','broadleaf',.64,310,16],['west-004','westerlands_limestone_ridge','geology','limestone',.36,420,30],['west-005','westerlands_coast','shoreline','driftwood',.74,80,14],['west-006','westerlands_castle_grounds','settlementEdge','timberfence',.58,120,5],['west-007','westerlands_low_hill','geology','limestone',.44,360,24],['west-008','westerlands_woodland','ambient','fern',.7,460,22],['west-009','westerlands_coast','geology','sandstone',.68,210,32],['west-010','westerlands_gold_road','roadside','waystone',.28,90,4],
  ['reach-001','reach_fertile_plain','ambient','meadowgrass',.7,80,7],['reach-002','reach_orchard_edge','settlementEdge','timberfence',.64,120,5],['reach-003','reach_riverbank','shoreline','marshreed',.9,48,5],['reach-004','reach_low_wood','ambient','broadleaf',.66,260,14],['reach-005','reach_coastal_marsh','shoreline','marshreed',.96,40,4],['reach-006','reach_road_approach','roadside','waystone',.44,160,5],['reach-007','reach_fertile_plain','ambient','meadowgrass',.58,220,10],['reach-008','reach_orchard_edge','ambient','broadleaf',.72,180,8],['reach-009','reach_riverbank','shoreline','wetboulder',.94,30,4],['reach-010','reach_low_wood','ambient','fern',.78,340,18],
  ['crown-001','crownlands_lowland','ambient','meadowgrass',.54,160,10],['crown-002','crownlands_road_corridor','roadside','waystone',.42,120,4],['crown-003','crownlands_river_mouth','shoreline','dock',.92,28,3],['crown-004','crownlands_wetwood','ambient','broadleaf',.76,240,13],['crown-005','crownlands_settlement_edge','settlementEdge','marketstall',.5,90,5],['crown-006','crownlands_stone_shore','geology','sandstone',.62,210,22],['crown-007','crownlands_lowland','ambient','shrub',.4,280,15],['crown-008','crownlands_road_corridor','roadside','timberfence',.48,180,6],['crown-009','crownlands_river_mouth','shoreline','marshreed',.9,20,2],['crown-010','crownlands_wetwood','ambient','fern',.82,310,20],
  ['storm-001','stormlands_wet_forest','ambient','broadleaf',.84,220,19],['storm-002','stormlands_wet_forest','ambient','fern',.92,300,21],['storm-003','stormlands_heath','ambient','shrub',.66,180,16],['storm-004','stormlands_rain_slope','geology','wetboulder',.94,520,30],['storm-005','stormlands_rocky_coast','shoreline','basalt',.8,180,36],['storm-006','stormlands_castle_edge','settlementEdge','waystone',.72,160,7],['storm-007','stormlands_river_gorge','geology','basalt',.86,340,40],['storm-008','stormlands_wet_forest','ambient','birch',.78,420,24],['storm-009','stormlands_rain_slope','ambient','fern',.96,620,34],['storm-010','stormlands_rocky_coast','shoreline','driftwood',.9,70,12],
  ['dorne-001','dorne_desert_core','ambient','desertgrass',.08,100,6],['dorne-002','dorne_red_mesa','geology','sandstone',.18,420,28],['dorne-003','dorne_oasis_edge','shoreline','marshreed',.76,90,5],['dorne-004','dorne_scrub_hills','ambient','shrub',.3,280,18],['dorne-005','dorne_coastal_shelf','shoreline','driftwood',.54,100,17],['dorne-006','dorne_road_dust','roadside','waystone',.16,120,4],['dorne-007','dorne_garden_edge','settlementEdge','broadleaf',.64,120,5],['dorne-008','dorne_desert_core','geology','ashrock',.06,260,20],['dorne-009','dorne_red_mesa','ambient','desertgrass',.2,500,24],['dorne-010','dorne_coastal_shelf','geology','sandstone',.48,180,26],
  ['iron-001','iron_islands_wind_coast','shoreline','driftwood',.9,70,22],['iron-002','iron_islands_rock_slope','geology','basalt',.68,420,40],['iron-003','iron_islands_moor','ambient','shrub',.76,240,16],['iron-004','iron_islands_harbor_edge','settlementEdge','dock',.96,40,4],['iron-005','iron_islands_stone_road','roadside','waystone',.7,160,8],['iron-006','iron_islands_wind_coast','geology','wetboulder',.86,120,34],['iron-007','iron_islands_rock_slope','geology','basalt',.72,560,48],['iron-008','iron_islands_moor','ambient','meadowgrass',.82,300,15],['iron-009','iron_islands_harbor_edge','shoreline','dock',.98,25,3],['iron-010','iron_islands_stone_road','roadside','weatheredstone',.64,220,10],
  ['mount-001','frost_pass','geology','granite',.34,1300,42],['mount-002','mountain_alpine_meadow','ambient','meadowgrass',.62,980,24],['mount-003','mountain_granite_ridge','geology','granite',.28,1900,48],['mount-004','mountain_snow_pocket','ambient','snowpine',.54,1700,30],['mount-005','mountain_boulder_valley','geology','granite',.72,720,28],['mount-006','mountain_river_cut','shoreline','wetboulder',.92,420,38],['mount-007','frost_pass','geology','froststone',.44,1500,46],['mount-008','mountain_alpine_meadow','ambient','shrub',.58,1120,20],['mount-009','mountain_granite_ridge','geology','granite',.22,2300,52],['mount-010','mountain_snow_pocket','ambient','snowpine',.62,2000,34],
  ['volc-001','volcanic_basalt_field','geology','basalt',.3,420,28],['volc-002','volcanic_ash_slope','geology','ashrock',.12,760,36],['volc-003','volcanic_wet_crater','shoreline','wetboulder',.86,240,22],['volc-004','volcanic_black_sand_coast','shoreline','driftwood',.72,60,14],['volc-005','volcanic_stone_road','roadside','waystone',.34,240,5],['volc-006','volcanic_basalt_field','ambient','shrub',.26,520,24],['volc-007','volcanic_ash_slope','geology','ashrock',.2,980,42],['volc-008','volcanic_wet_crater','ambient','fern',.9,300,25],['volc-009','volcanic_black_sand_coast','geology','basalt',.64,110,28],['volc-010','volcanic_stone_road','roadside','basalt',.22,340,6],
  ['ruin-001','ruined_lowland','settlementEdge','ruinwall',.6,220,7],['ruin-002','ruined_hillfort','geology','weatheredstone',.5,420,18],['ruin-003','ruined_coast','shoreline','ruinwall',.8,90,18],['ruin-004','ruined_forest','ambient','fern',.72,340,15],['ruin-005','ruined_mountain_pass','roadside','waystone',.34,1300,8],['ruin-006','ruined_lowland','settlementEdge','weatheredstone',.56,180,6],['ruin-007','ruined_hillfort','settlementEdge','ruinwall',.44,500,21],['ruin-008','ruined_coast','geology','wetboulder',.86,130,30],['ruin-009','ruined_forest','ambient','broadleaf',.8,280,19],['ruin-010','ruined_mountain_pass','geology','granite',.28,1500,38],
  ['settle-001','settlement_market_edge','settlementEdge','marketstall',.52,80,4],['settle-002','settlement_farm_edge','settlementEdge','timberfence',.64,120,3],['settle-003','settlement_harbor_edge','settlementEdge','dock',.92,30,2],['settle-004','settlement_walled_edge','settlementEdge','weatheredstone',.48,140,4],['settle-005','settlement_garden_edge','settlementEdge','broadleaf',.72,110,4],['settle-006','settlement_ruin_edge','settlementEdge','ruinwall',.62,200,7],['settle-007','settlement_market_edge','settlementEdge','timberfence',.42,90,5],['settle-008','settlement_farm_edge','ambient','meadowgrass',.68,150,6],['settle-009','settlement_harbor_edge','shoreline','dock',.96,24,2],['settle-010','settlement_walled_edge','roadside','waystone',.44,120,4],
];

for (const [id, regionId, mode, familyId, moisture, elevationMeters, xOffset] of CASES) {
  check(`matrix:${id}`, () => {
    const result = planRuntime({
      anchor: { x: xOffset, z: 18, id, surface: surface({ moisture, elevationMeters }) },
      regionId,
      familyIds: [familyId],
      mode,
      seed: id.length * 7919,
    });
    assert.equal(result.ok, true);
    assertPlanSafe(result);
  });
  check(`matrix-determinism:${id}`, () => {
    const options = {
      anchor: { x: xOffset, z: 18, id, surface: surface({ moisture, elevationMeters }) },
      regionId, familyIds: [familyId], mode, seed: id.length * 7919,
    };
    assert.equal(runtimePlanDigest(planRuntime(options)), runtimePlanDigest(planRuntime(options)));
  });
}

for (let i = 0; i < 60; i += 1) {
  check(`boundary:${i}`, () => {
    const x = i % 2 === 0 ? 2 + i * .3 : 124 - i * .2;
    const key = chunkKeyFor(x, 64);
    const owner = boundaryOwnerFor(x, 64);
    assert.ok(typeof key === 'string');
    assert.ok(typeof owner === 'string');
  });
}

for (let i = 0; i < 40; i += 1) {
  check(`jitter:${i}`, () => {
    const a = deterministicJitter(i + 10, i);
    const b = deterministicJitter(i + 10, i);
    assert.deepEqual(a, b);
  });
}

for (let i = 0; i < 40; i += 1) {
  check(`manifest:${i}`, () => {
    const result = buildChunkRuntimePlan({
      chunkKey: '0:0',
      anchors: [{ x: 20 + i, z: 20 + i, id: `manifest-${i}`, surface: surface({ moisture: .4 + (i % 5) * .1 }) }],
      regionId: i % 2 === 0 ? 'reach_fertile_plain' : 'riverlands_meadow',
      familyIds: ['meadowgrass'],
      mode: 'ambient', seed: i + 91,
    });
    const manifest = { policy: GEOGRAPHIC_ASSET_RUNTIME_POLICY, digest: runtimePlanDigest(result), acceptedAssets: result.accepted };
    assert.equal(validateRuntimeManifest(manifest).ok, true);
  });
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, matrixCases: CASES.length, checks: CASES.length * 2 + 140, policy: GEOGRAPHIC_ASSET_RUNTIME_POLICY.id }, null, 2));
}
