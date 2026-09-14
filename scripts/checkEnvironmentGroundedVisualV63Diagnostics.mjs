import assert from 'node:assert/strict';
import {
  createRuntimeActionPlanV63,
  createMaterialActionPlanV63,
  createVegetationActionPlanV63,
  createWaterActionPlanV63,
  createPerformanceActionPlanV63,
  createGroundingActionPlanV63,
  createEnvironmentDoctorReportV63,
} from '../src/3d/world/environmentGroundedVisualRuntimeV63Diagnostics.js';

const base = {
  sampleId: 'diagnostic', seed: 'diagnostic-seed',
  terrain: { x: 10, y: 50, z: 20, height: 50, canonicalHeight: 50, colliderHeight: 50, slope: 10, moisture: 0.5, elevation01: 0.45, snowWeight: 0.05, roughness: 0.76, normal: { x: 0.1, y: 0.98, z: 0.08 }, biome: 'temperate', surface: 'grass', canonicalSource: 'canonical-owner-map', terrainBackend: 'Terrain3D' },
  water: { waterClass: 'land', waterDistance: 100, depth: 0, cyanRisk: 0, moireRisk: 0, seamRisk: 0, rectangular: false, tileLike: false, repeatedStripe: false, wetEdgeWeight: 0, foamWeight: 0 },
  material: { role: 'grass', multiSurface: true, placeholder: false, missing: false, roughness: 0.8, normalScale: 0.8, ao: 0.55, macroContrast: 0.7, microDetail: 0.7, textureRepeat: 1 },
  vegetation: [], camera: { profile: 'terrain-near', width: 1536, height: 1024, orthographicDegrees: 90, distance: 420, seed: 'diagnostic-camera' }, renderedY: 50, colliderY: 50, postProcessed: false, editorRuntimeImported: false, primitiveGeometry: false,
};

const clean = createRuntimeActionPlanV63(base);
assert.equal(clean.mergeEligible, true);
assert.equal(clean.priority.topPriority, null);
console.log('PASS clean action plan');

const bad = { ...base, terrain: { ...base.terrain, slope: 82, roughness: 0.1, snowWeight: 0.95, elevation01: 0.94, biome: 'alpine', surface: 'rock' }, water: { ...base.water, waterClass: 'sea', waterDistance: 0.3, depth: 3, rectangular: true, repeatedStripe: true, cyanRisk: 1, moireRisk: 1, seamRisk: 1 }, material: { ...base.material, role: 'rock', multiSurface: false, placeholder: true, missing: true }, renderedY: 52, colliderY: 49 };
const badPlan = createRuntimeActionPlanV63(bad);
assert.equal(badPlan.mergeEligible, false);
assert.ok(badPlan.priority.ordered.length >= 4);
assert.equal(badPlan.priority.topPriority.startsWith('P0:'), true);
console.log('PASS blocked action priority');

const material = createMaterialActionPlanV63({ terrain: bad.terrain, material: bad.material, camera: bad.camera });
assert.equal(material.primaryLayer, 'rock');
assert.ok(material.rockExposure > 0);
assert.equal(material.antiTiling, true);
assert.equal(material.triplanar, true);
console.log('PASS material action plan');

const forest = createVegetationActionPlanV63({ biome: 'forest', slope: 10, moisture: 0.8, elevation01: 0.45, waterDistance: 60, roadDistance: 100, settlementDistance: 100 });
const desert = createVegetationActionPlanV63({ biome: 'desert', slope: 10, moisture: 0.1, elevation01: 0.45, waterDistance: 200, roadDistance: 100, settlementDistance: 100 });
assert.ok(forest.density > desert.density);
assert.ok(forest.categories.includes('tree'));
assert.equal(desert.categories.includes('ground-detail'), true);
console.log('PASS vegetation action contrast');

const water = createWaterActionPlanV63({ waterClass: 'lake', depth: 4, distance: 3, wetEdge: 0.9, foam: 0.4, cyanRisk: 0.2, moireRisk: 0 });
assert.equal(water.recognized, true);
assert.ok(water.blend.shallow > 0);
assert.ok(water.shorelineBands.length === 4);

const unknown = createWaterActionPlanV63({ waterClass: 'canal', depth: 4, distance: 2 });
assert.equal(unknown.recognized, false);
assert.equal(unknown.requiresCoverageRebuild, true);
console.log('PASS water action classification');

const perf = createPerformanceActionPlanV63({ cameraDistance: 120, vegetationInstances: 1200, textureMemoryMb: 700, mobile: true, visibleChunks: 12, residentChunks: 14 });
assert.equal(perf.overBudget, true);
assert.ok(perf.actions.length > 0);
assert.equal(perf.budgets.vegetationInstances, 640);
console.log('PASS performance action plan');

const groundingGood = createGroundingActionPlanV63({ canonicalHeight: 100, renderedHeight: 100.1, colliderHeight: 100.05, canonicalX: 0, canonicalZ: 0, renderedX: 0.05, renderedZ: 0.04, colliderX: 0.02, colliderZ: 0.01, groundConfidence: 0.9, grounded: true });
assert.equal(groundingGood.acceptSceneAttach, true);
const groundingBad = createGroundingActionPlanV63({ canonicalHeight: 100, renderedHeight: 101, colliderHeight: 99, canonicalX: 0, canonicalZ: 0, renderedX: 2, renderedZ: 1, colliderX: 1, colliderZ: 2, groundConfidence: 0.5, grounded: true });
assert.equal(groundingBad.acceptSceneAttach, false);
console.log('PASS grounding action plan');

const cleanDoctor = createEnvironmentDoctorReportV63(base);
assert.equal(cleanDoctor.mergeEligible, true);
assert.equal(cleanDoctor.fingerprint.length > 0, true);
const badDoctor = createEnvironmentDoctorReportV63(bad);
assert.equal(badDoctor.mergeEligible, false);
assert.ok(badDoctor.actionPlan.actions.length >= 4);
assert.ok(badDoctor.fingerprint.length > 0);
console.log('PASS environment doctor reports');

console.log('V63 diagnostics regression complete');
