import assert from 'node:assert/strict';
import {
  createWorldCoverageRuntimeSnapshotV51,
  createWorldCoverageRuntimeSnapshotFromSceneSamplesV51,
  createWorldCoverageRuntimeBeforeAfterV51,
  queryWorldCoverageSampleV51,
  queryWorldCoverageCellV51,
  queryWorldCoverageRegionV51,
  queryWorldCoverageWeatherV51,
  summarizeWorldCoverageForCreateSceneV51,
  WORLD_COVERAGE_RUNTIME_ADAPTER_V51,
  WORLD_COVERAGE_RUNTIME_GATES_V51,
} from '../src/3d/world/worldCoverageRuntimeAdapterV51.js';

const sample = (id,x,z,biome,overrides={}) => ({
  id,
  position:{x,y:overrides.y ?? overrides.elevation ?? 30,z},
  elevation:overrides.elevation ?? 30,
  slope:overrides.slope ?? .22,
  moisture:overrides.moisture ?? .45,
  snow:overrides.snow ?? 0,
  waterDistance:overrides.waterDistance ?? 900,
  roadDistance:overrides.roadDistance ?? 100,
  settlementDistance:overrides.settlementDistance ?? 100,
  distance:overrides.distance ?? 500,
  horizonOcclusion:overrides.horizonOcclusion ?? .05,
  biome,
  cameraBand:overrides.cameraBand ?? 'near-center',
  weather:overrides.weather ?? {cloud:.25,precipitation:.05,wind:.20,temperatureC:16},
});

const observations = [
  sample('center',0,0,'temperate-forest',{elevation:32,y:32,moisture:.62,waterDistance:700}),
  sample('northwest',-1800,-1800,'alpine',{elevation:1250,y:1250,slope:.64,moisture:.70,snow:.91,distance:9800,horizonOcclusion:.30,weather:{cloud:.82,precipitation:.72,wind:.74,temperatureC:-6},cameraBand:'near-northwest'}),
  sample('coast',180,1500,'wetland',{elevation:5,y:5,moisture:.88,waterDistance:12,distance:600,weather:{cloud:.61,precipitation:.30,wind:.55,temperatureC:12},cameraBand:'near-coast'}),
  sample('mountain',1800,1800,'rocky-coast',{elevation:180,y:180,slope:.74,moisture:.40,waterDistance:95,distance:4200,weather:{cloud:.29,precipitation:.04,wind:.84,temperatureC:8},cameraBand:'near-mountain'}),
  sample('far',4200,4200,'boreal-forest',{elevation:620,y:620,slope:.38,moisture:.67,snow:.44,distance:44000,weather:{cloud:.72,precipitation:.22,wind:.48,temperatureC:2},cameraBand:'far'}),
];

const first = createWorldCoverageRuntimeSnapshotV51({seed:5101,observations});
const second = createWorldCoverageRuntimeSnapshotV51({seed:5101,observations});
assert.deepEqual(first,second);
assert.equal(first.version,'v51-runtime-adapter');
assert.equal(first.seed,5101);
assert.equal(first.sourceTruncated,false);
assert.equal(first.coverage.samples.length,5);
assert.equal(first.coverage.cells.length,5);
assert.equal(first.cameraAudit.complete,true);
assert.equal(first.surfaceAudit.requiredSurfaceSetPresent,true);
assert.equal(first.p0Audit.targetGridZero,true);
assert.equal(first.p0Audit.targetRectangularWaterZero,true);
assert.equal(first.p5Audit.blackSkyGuard,true);
assert.equal(first.parityAudit.visualColliderCoordinateParity,true);
assert.equal(first.bandAudit.complete,true);
assert.ok(first.placement.eligible > 0);
assert.equal(Object.isFrozen(first),true);
assert.equal(Object.isFrozen(first.coverage),true);
assert.match(first.digest,/^[0-9a-f]{8}$/);

assert.deepEqual(WORLD_COVERAGE_RUNTIME_ADAPTER_V51.requiredBands,[
  'full-world','far','near-center','near-northwest','near-coast','near-mountain',
]);
assert.equal(WORLD_COVERAGE_RUNTIME_ADAPTER_V51.resolution.width,1536);
assert.equal(WORLD_COVERAGE_RUNTIME_ADAPTER_V51.resolution.height,1024);
assert.equal(WORLD_COVERAGE_RUNTIME_GATES_V51.actualCreateSceneSamplesOnly,true);
assert.equal(WORLD_COVERAGE_RUNTIME_GATES_V51.noGeometryCreation,true);
assert.equal(WORLD_COVERAGE_RUNTIME_GATES_V51.noGeographyMutation,true);
assert.equal(WORLD_COVERAGE_RUNTIME_GATES_V51.noAssetHydration,true);
assert.equal(WORLD_COVERAGE_RUNTIME_GATES_V51.noEditorImport,true);
assert.equal(WORLD_COVERAGE_RUNTIME_GATES_V51.sharedMaterialPlacementAuthorityPreserved,true);

const sampleIds = first.coverage.samples.map(s => s.id);
assert.deepEqual(sampleIds,['center','northwest','coast','mountain','far']);
assert.equal(queryWorldCoverageSampleV51(first,'center').id,'center');
assert.equal(queryWorldCoverageSampleV51(first,'missing'),null);
assert.ok(queryWorldCoverageCellV51(first,0,0));
assert.ok(queryWorldCoverageRegionV51(first,'temperate-forest'));
assert.equal(queryWorldCoverageRegionV51(first,'missing'),null);
assert.ok(queryWorldCoverageWeatherV51(first,'cell:0:0') || queryWorldCoverageWeatherV51(first,first.coverage.weatherCells[0].cellId));

const createSceneSummary = summarizeWorldCoverageForCreateSceneV51(first);
assert.equal(createSceneSummary.valid,true);
assert.equal(createSceneSummary.acceptanceReady,true);
assert.equal(createSceneSummary.sampleCount,5);
assert.equal(createSceneSummary.cellCount,5);
assert.equal(createSceneSummary.cameras.complete,true);
assert.equal(createSceneSummary.surfaces.requiredSurfaceSetPresent,true);
assert.equal(createSceneSummary.p0.visibleGrid,0);
assert.equal(createSceneSummary.p0.visibleRectangularWater,0);
assert.equal(createSceneSummary.p5.blackSkyGuard,true);
assert.equal(createSceneSummary.parity.visualColliderCoordinateParity,true);

const malformed = createWorldCoverageRuntimeSnapshotV51({
  seed:Infinity,
  framePressure:Infinity,
  observations:[sample('malformed',0,0,'meadow',{elevation:NaN,waterDistance:NaN,roadDistance:-4,settlementDistance:Infinity,slope:Infinity,snow:NaN})],
});
assert.equal(malformed.seed,5101);
assert.ok(Number.isFinite(malformed.framePressure));
assert.ok(Number.isFinite(malformed.coverage.samples[0].elevation));
assert.ok(Number.isFinite(malformed.coverage.samples[0].slope));
assert.ok(Number.isFinite(malformed.coverage.samples[0].snow));
assert.ok(Number.isFinite(malformed.coverage.samples[0].waterDistance));

const many = Array.from({length:520},(_,index)=>sample(`many-${index}`,index*20,index*17,'meadow'));
const capped = createWorldCoverageRuntimeSnapshotV51({seed:23,observations:many});
assert.equal(capped.coverage.samples.length,512);
assert.equal(capped.sourceTruncated,true);

const before = createWorldCoverageRuntimeSnapshotV51({seed:33,observations});
const after = createWorldCoverageRuntimeSnapshotV51({seed:33,observations:observations.map(row => ({...row,moisture:Math.min(.99,row.moisture+.12)}))});
const comparison = createWorldCoverageRuntimeBeforeAfterV51({seed:33,observations},{seed:33,observations:observations.map(row => ({...row,moisture:Math.min(.99,row.moisture+.12)}))});
assert.equal(comparison.version,'v51-runtime-adapter');
assert.equal(comparison.before.digest,before.digest);
assert.equal(comparison.after.digest,after.digest);
assert.equal(comparison.delta.acceptanceRegressed,false);
assert.equal(comparison.delta.blackSkyRegressed,false);

const sceneSnapshot = createWorldCoverageRuntimeSnapshotFromSceneSamplesV51(observations,{seed:5101,framePressure:.32});
assert.equal(sceneSnapshot.sourceMode,'scene-samples');
assert.equal(sceneSnapshot.coverage.samples.length,5);
assert.equal(sceneSnapshot.acceptance.acceptanceReady,true);

const blockedWater = createWorldCoverageRuntimeSnapshotV51({
  seed:17,
  observations:[sample('water-block',0,0,'coastal',{waterDistance:0.5})],
});
assert.equal(blockedWater.placement['blocked-water'],1);
assert.equal(blockedWater.placement.eligible,0);

const blockedCliff = createWorldCoverageRuntimeSnapshotV51({
  seed:17,
  observations:[sample('cliff-block',0,0,'rocky-coast',{slope:.91})],
});
assert.equal(blockedCliff.placement['blocked-cliff'],1);
assert.equal(blockedCliff.placement.eligible,0);

const blockedSnow = createWorldCoverageRuntimeSnapshotV51({
  seed:17,
  observations:[sample('snow-block',0,0,'snowfield',{snow:.99})],
});
assert.equal(blockedSnow.placement['blocked-permanent-snow'],1);
assert.equal(blockedSnow.placement.eligible,0);

const blockedRoad = createWorldCoverageRuntimeSnapshotV51({
  seed:17,
  observations:[sample('road-block',0,0,'meadow',{roadDistance:2})],
});
assert.equal(blockedRoad.placement['blocked-road'],1);
assert.equal(blockedRoad.placement.eligible,0);

const blockedSettlement = createWorldCoverageRuntimeSnapshotV51({
  seed:17,
  observations:[sample('settlement-block',0,0,'urban-edge',{settlementDistance:3})],
});
assert.equal(blockedSettlement.placement['blocked-settlement'],1);
assert.equal(blockedSettlement.placement.eligible,0);

const blockedOccluded = createWorldCoverageRuntimeSnapshotV51({
  seed:17,
  observations:[sample('occluded-block',0,0,'forest',{horizonOcclusion:1})],
});
assert.equal(blockedOccluded.placement['blocked-occluded'],1);
assert.equal(blockedOccluded.placement.eligible,0);

const invalidSnapshotSummary = summarizeWorldCoverageForCreateSceneV51(null);
assert.equal(invalidSnapshotSummary.valid,false);
assert.equal(invalidSnapshotSummary.reason,'invalid-snapshot');

const target={};
const applyModule = await import('../src/3d/world/worldCoverageRuntimeAdapterV51.js');
const applied = applyModule.applyWorldCoverageRuntimeSnapshotV51(target,first);
assert.equal(applied,true);
assert.strictEqual(target.worldCoverageRuntimeSnapshotV51,first);
assert.strictEqual(target.worldCoverageRuntimeSnapshotV51.coverage,first.coverage);

const badTarget={};
assert.equal(applyModule.applyWorldCoverageRuntimeSnapshotV51(badTarget,{version:'bad'}),false);
assert.equal(Object.hasOwn(badTarget,'worldCoverageRuntimeSnapshotV51'),false);

const weatherClasses = new Set(first.coverage.weatherCells.map(cell => cell.class));
assert.ok(weatherClasses.size >= 2);
assert.ok(first.coverage.weatherCells.every(cell => cell.particleBudget >= 0 && cell.particleBudget <= 320));
assert.ok(first.coverage.weatherCells.every(cell => cell.intensity >= 0 && cell.intensity <= 1));
assert.ok(first.coverage.weatherCells.every(cell => cell.snowChance >= 0 && cell.snowChance <= 1));
assert.ok(first.coverage.weatherCells.every(cell => cell.rainChance >= 0 && cell.rainChance <= 1));

for (const profile of first.coverage.cameraProfiles) {
  assert.equal(profile.width,1536);
  assert.equal(profile.height,1024);
  assert.ok(profile.orthographicSize>0);
  assert.ok(Number.isFinite(profile.seed));
  assert.ok(Number.isFinite(profile.position.x));
  assert.ok(Number.isFinite(profile.position.y));
  assert.ok(Number.isFinite(profile.position.z));
  assert.ok(Number.isFinite(profile.target.x));
  assert.ok(Number.isFinite(profile.target.y));
  assert.ok(Number.isFinite(profile.target.z));
}

for (const cell of first.coverage.cells) {
  const total = Object.values(cell.surfaces).reduce((sum,value)=>sum+value,0);
  assert.ok(Math.abs(total-1) < 0.001 || total === 0);
  assert.ok(cell.confidence >= 0 && cell.confidence <= 1);
  assert.ok(cell.edgePhase >= 0 && cell.edgePhase <= 1);
}

for (const placement of first.coverage.placementContract || []) {
  assert.ok(placement.id);
  assert.ok(placement.assetReadiness);
  assert.ok(['ready','water','cliff','permanent-snow','road','settlement','low-confidence'].includes(placement.assetReadiness.reason));
}

console.log('checkWorldCoverageRuntimeAdapterV51: PASS');
