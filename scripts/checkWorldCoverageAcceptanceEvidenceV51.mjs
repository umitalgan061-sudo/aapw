import assert from 'node:assert/strict';
import {
  createWorldCoverageAcceptanceEvidenceV51,
  createWorldCoverageAcceptanceBeforeAfterV51,
  evaluateWorldCoverageAcceptanceV51,
  WORLD_COVERAGE_ACCEPTANCE_EVIDENCE_V51,
  WORLD_COVERAGE_ACCEPTANCE_GATES_V51,
} from '../src/3d/world/worldCoverageAcceptanceEvidenceV51.js';

const makeSample = (id,x,z,biome,opts={}) => ({
  id,
  position:{x,y:opts.y ?? opts.elevation ?? 20,z},
  elevation:opts.elevation ?? 20,
  slope:opts.slope ?? .2,
  moisture:opts.moisture ?? .45,
  snow:opts.snow ?? 0,
  waterDistance:opts.waterDistance ?? 900,
  roadDistance:opts.roadDistance ?? 100,
  settlementDistance:opts.settlementDistance ?? 100,
  distance:opts.distance ?? 600,
  horizonOcclusion:opts.horizonOcclusion ?? .05,
  cameraBand:opts.cameraBand ?? 'near-center',
  biome,
  weather:opts.weather ?? {cloud:.2,precipitation:.05,wind:.2,temperatureC:15},
});

const samples = [
  makeSample('center',0,0,'temperate-forest',{elevation:25,moisture:.66,waterDistance:800}),
  makeSample('northwest',-1600,-1600,'alpine',{elevation:1300,slope:.61,moisture:.72,snow:.93,distance:8000,horizonOcclusion:.25,cameraBand:'near-northwest',weather:{cloud:.82,precipitation:.73,wind:.78,temperatureC:-8}}),
  makeSample('coast',1200,-120,'coastal',{elevation:4,moisture:.84,waterDistance:10,distance:500,cameraBand:'near-coast',weather:{cloud:.58,precipitation:.26,wind:.57,temperatureC:12}}),
  makeSample('mountain',1800,1800,'karst',{elevation:1050,slope:.75,moisture:.38,snow:.28,distance:3800,cameraBand:'near-mountain',weather:{cloud:.31,precipitation:.08,wind:.83,temperatureC:5}}),
  makeSample('far',4800,4200,'boreal-forest',{elevation:650,slope:.33,moisture:.68,snow:.45,distance:50000,cameraBand:'far',weather:{cloud:.71,precipitation:.21,wind:.49,temperatureC:1}}),
];

const input = {seed:774,observations:samples,framePressure:.28};
const evidence = createWorldCoverageAcceptanceEvidenceV51(input);
const repeat = createWorldCoverageAcceptanceEvidenceV51(input);

assert.deepEqual(evidence,repeat);
assert.equal(evidence.version,'v51-acceptance-evidence');
assert.equal(evidence.seed,774);
assert.match(evidence.digest,/^[0-9a-f]{8}$/);
assert.match(evidence.evidenceDigest,/^[0-9a-f]{8}$/);
assert.deepEqual(evidence.resolution,{width:1536,height:1024});
assert.equal(evidence.audits.cameras.complete,true);
assert.equal(evidence.audits.cameraGeometry.finite,true);
assert.equal(evidence.audits.surfaces.complete,true);
assert.ok(evidence.audits.surfaces.missing.length===0);
assert.equal(evidence.audits.continuity.seamTarget,true);
assert.equal(evidence.audits.p0.gridZero,true);
assert.equal(evidence.audits.p0.seamZero,true);
assert.equal(evidence.audits.p0.rectangularWaterZero,true);
assert.equal(evidence.audits.p0.moireZero,true);
assert.equal(evidence.audits.p1.coordinateParity,true);
assert.equal(evidence.audits.p1.geometryMutationDetected,false);
assert.equal(evidence.audits.p2.requiredSurfaceSetPresent,true);
assert.equal(evidence.audits.p2.nearDetailAvailable,true);
assert.equal(evidence.audits.p2.antiTilingSignal,true);
assert.equal(evidence.audits.p4.waterMoireTarget,true);
assert.equal(evidence.audits.p4.rectangularWaterTarget,true);
assert.equal(evidence.audits.p5.blackSkyGuard,true);
assert.equal(evidence.audits.p5.fogAndWeatherBounded,true);
assert.equal(evidence.audits.determinism.deterministic,true);
assert.equal(evidence.acceptanceReady,true);
assert.equal(evidence.score.ratio,1);
assert.equal(evidence.runtimeSummary.acceptanceReady,true);

const blocking = Object.entries(evidence.checklist).filter(([,value]) => !value);
assert.equal(blocking.length,0);
for(const failureKey of Object.keys(evidence.targetFailures)) {
  assert.equal(evidence.targetFailures[failureKey],0);
}

for(const band of evidence.requiredCameraBands) {
  assert.ok(evidence.runtimeSummary.cameras.required.includes(band));
}
for(const surface of evidence.requiredSurfaces) {
  assert.equal(evidence.audits.surfaces.present[surface],true);
}

assert.equal(WORLD_COVERAGE_ACCEPTANCE_EVIDENCE_V51.version,'v51-acceptance-evidence');
assert.equal(WORLD_COVERAGE_ACCEPTANCE_EVIDENCE_V51.resolution.width,1536);
assert.equal(WORLD_COVERAGE_ACCEPTANCE_EVIDENCE_V51.resolution.height,1024);
assert.equal(WORLD_COVERAGE_ACCEPTANCE_GATES_V51.noGeometryCreation,true);
assert.equal(WORLD_COVERAGE_ACCEPTANCE_GATES_V51.noGeographyMutation,true);
assert.equal(WORLD_COVERAGE_ACCEPTANCE_GATES_V51.noAssetHydration,true);
assert.equal(WORLD_COVERAGE_ACCEPTANCE_GATES_V51.noEditorImport,true);
assert.equal(WORLD_COVERAGE_ACCEPTANCE_GATES_V51.exactOrthographicEvidence,true);
assert.equal(WORLD_COVERAGE_ACCEPTANCE_GATES_V51.deterministicSeedRequired,true);
assert.equal(WORLD_COVERAGE_ACCEPTANCE_GATES_V51.regressionComparisonRequired,true);
for(const key of ['visibleGrid','visibleTileSeam','visibleRectangularWater','visibleWaterMoire','floatingAssets','interpenetratingAssets','blackSky']) {
  assert.equal(WORLD_COVERAGE_ACCEPTANCE_GATES_V51.visibleFailureTargets[key],0);
}

const changedSamples = samples.map(row => ({...row,moisture:Math.min(.98,row.moisture+.15)}));
const comparison = createWorldCoverageAcceptanceBeforeAfterV51(
  {seed:774,observations:samples,framePressure:.28},
  {seed:774,observations:changedSamples,framePressure:.28},
);
assert.equal(comparison.version,'v51-acceptance-evidence');
assert.equal(comparison.runtimeComparison.before.seed,774);
assert.equal(comparison.runtimeComparison.after.seed,774);
assert.equal(comparison.regressions.acceptance,false);
assert.equal(comparison.regressions.p0Grid,false);
assert.equal(comparison.regressions.p0RectangularWater,false);
assert.equal(comparison.regressions.p5Sky,false);
assert.equal(comparison.noVisualRegression,true);

const evaluated = evaluateWorldCoverageAcceptanceV51(input);
assert.equal(evaluated.version,'v51-acceptance-evidence');
assert.equal(evaluated.acceptanceReady,true);
assert.equal(evaluated.score.ratio,1);
assert.deepEqual(evaluated.blockingChecks,[]);
for(const value of Object.values(evaluated.failures)) assert.equal(value,0);

const pressureHigh = createWorldCoverageAcceptanceEvidenceV51({...input,framePressure:.95});
assert.equal(pressureHigh.acceptanceReady,true);
assert.ok(pressureHigh.audits.p5.drawCallBudget <= evidence.audits.p5.drawCallBudget);
assert.ok(pressureHigh.audits.p5.triangleBudget <= evidence.audits.p5.triangleBudget);
assert.ok(pressureHigh.audits.p5.textureMemoryBudgetMB <= evidence.audits.p5.textureMemoryBudgetMB);
assert.ok(pressureHigh.audits.p5.particleBudget <= evidence.audits.p5.particleBudget);

const empty = createWorldCoverageAcceptanceEvidenceV51({seed:1,observations:[]});
assert.equal(empty.audits.cameras.complete,true);
assert.equal(empty.audits.cameraGeometry.finite,true);
assert.equal(empty.audits.surfaces.complete,false);
assert.equal(empty.audits.p0.gridZero,true);
assert.equal(empty.audits.p0.rectangularWaterZero,true);
assert.equal(empty.audits.p5.blackSkyGuard,true);
assert.equal(empty.acceptanceReady,false);
assert.ok(empty.score.ratio < 1);

const blocked = createWorldCoverageAcceptanceEvidenceV51({seed:2,observations:[makeSample('bad',0,0,'coastal',{waterDistance:.5,slope:.92,snow:.99,roadDistance:1,settlementDistance:1,horizonOcclusion:1})]});
assert.equal(blocked.audits.p3.invalidPlacementCount,1);
assert.equal(blocked.audits.p3.groundedEligibilityRatio,0);
assert.equal(blocked.acceptanceReady,false);

const overLimit = createWorldCoverageAcceptanceEvidenceV51({seed:9,observations:Array.from({length:520},(_,i)=>makeSample(`o-${i}`,i*20,i*20,'meadow'))});
assert.equal(overLimit.runtimeSummary.sampleCount,512);
assert.equal(overLimit.acceptanceReady,false);
assert.ok(overLimit.runtimeSummary);

const geometryBad = createWorldCoverageAcceptanceEvidenceV51({
  seed:4,
  observations:[makeSample('geom',0,0,'meadow',{elevation:50,y:50})],
});
const serialized = JSON.parse(JSON.stringify(geometryBad));
assert.deepEqual(Object.keys(serialized).sort(),Object.keys(geometryBad).sort());
assert.equal(Object.isFrozen(geometryBad),true);
assert.equal(Object.isFrozen(geometryBad.audits),true);
assert.equal(Object.isFrozen(geometryBad.checklist),true);

console.log('checkWorldCoverageAcceptanceEvidenceV51: PASS');
