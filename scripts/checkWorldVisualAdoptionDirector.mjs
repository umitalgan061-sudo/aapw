import assert from 'node:assert/strict';
import {
  buildWorldVisualAdoptionPlan,
  buildWorldVisualAdoptionManifest,
  applyWorldVisualAdoptionHints,
  deriveSurfaceWeights,
  deriveWaterHints,
  deriveVegetationHints,
  deriveAtmosphereHints,
  stableWorldVisualAdoptionString,
} from '../src/3d/world/worldVisualAdoptionDirector.js';

const base = {
  id: 'center-near', phase: 'near', position: { x: 120, y: 640, z: -80 },
  height: 640, slope: 0.42, moisture: 0.6, temperature: -0.3,
  waterDistance: 18, roadDistance: 55, settlementDistance: 160,
  groundConfidence: 0.98, snowCover: 0.12, canopy: 0.75,
  skyLuminance: 0.2, exposure: 1.0, normal: { x: 0.1, y: 0.96, z: 0.18 },
  hasCanonicalHeight: true, hasCanonicalWater: false, hasCanonicalBiome: true,
  hasHydratedAsset: true, tileBoundaryDistance: 44, tileSize: 500,
  textureRepeatRisk: 0.1, moireRisk: 0.05, blackSkyRisk: 0.0,
  frameTimeMs: 15.8, drawCalls: 80, textureMemoryMb: 640,
};

function assertFiniteTree(value, path = 'root') {
  if (typeof value === 'number') assert(Number.isFinite(value), `${path} must be finite`);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFiniteTree(v, `${path}[${i}]`));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => assertFiniteTree(v, `${path}.${k}`));
}

const first = buildWorldVisualAdoptionPlan(base, { sceneAttachOwner: 'createScene' });
const second = buildWorldVisualAdoptionPlan({ ...base }, { sceneAttachOwner: 'createScene' });
assert.deepEqual(first, second, 'plan must be deterministic');
assert(Object.isFrozen(first) && Object.isFrozen(first.surfaces), 'plan must be frozen');
assertFiniteTree(first);
assert.equal(first.canonical.geographyMutation, false);
assert.equal(first.adoption.requireMaterialAssignmentCore, true);
assert.equal(first.adoption.requireWorldAssetPlacementPipeline, true);
assert.equal(first.adoption.editorRuntimeImportForbidden, true);

const weights = deriveSurfaceWeights(base);
const weightSum = Object.values(weights.weights).reduce((sum, value) => sum + value, 0);
assert(Math.abs(weightSum - 1) < 1e-9, 'surface weights must normalize');
assert(weights.weights.rock >= 0 && weights.weights.scree >= 0);

const shore = deriveWaterHints({ ...base, id: 'shore', waterClass: 'sea', hasCanonicalWater: true, waterDistance: 2 });
assert(shore.shallowWeight > 0 && shore.wetEdgeWeight > 0, 'shore response expected');
assert.equal(shore.category, 'sea');
assert.equal(shore.preserveCanonicalHydrology, true);
assert.equal(shore.suppressRectangularCoverage, false, 'far from tile edge should not over-trigger');

const dry = deriveWaterHints({ ...base, id: 'dry', waterClass: 'none', hasCanonicalWater: false, waterDistance: 1000 });
assert.equal(dry.category, 'none');
assert.equal(dry.deepWeight, 0);
assert.equal(dry.shallowWeight, 0);

const excluded = deriveVegetationHints({ ...base, id: 'sea-tree', hasCanonicalWater: true, waterClass: 'sea' });
assert.equal(excluded.allowed, false);
assert(excluded.exclusionReasons.includes('water'));
assert.equal(excluded.density, 0);

const cliff = deriveVegetationHints({ ...base, id: 'cliff', slope: 0.95, waterClass: 'none' });
assert.equal(cliff.allowed, false);
assert(cliff.exclusionReasons.includes('steep-slope'));

const black = deriveAtmosphereHints({ ...base, id: 'black', skyLuminance: 0.01, blackSkyRisk: 1, exposure: 0.5 });
assert.equal(black.cameraRelativeSky, true);
assert.equal(black.blackSkyGuard, true);
assert(black.backgroundLuminanceFloor >= 0.12);
assert(black.exposure >= 0.65 && black.exposure <= 1.85);
assert(black.fogFar > black.fogNear);

const guarded = buildWorldVisualAdoptionPlan({ ...base, id: 'guarded', moireRisk: 0.9, tileBoundaryDistance: 2, frameTimeMs: 40 });
assert.equal(guarded.quality, 'guarded');
assert.equal(guarded.water.suppressMoiré, true);
assert.equal(guarded.structuralRisk.seam, 'high');
assert.equal(guarded.structuralRisk.moire, 'high');

const malformed = buildWorldVisualAdoptionPlan({ id: 'malformed', position: { x: NaN, y: Infinity, z: -Infinity }, slope: NaN, moisture: NaN, temperature: NaN });
assertFiniteTree(malformed);
assert.equal(malformed.canonical.geographyMutation, false);

const manifest = buildWorldVisualAdoptionManifest([base, { ...base, id: 'far', phase: 'far', waterClass: 'lake' }, { ...base, id: 'full', phase: 'full' }]);
assert.equal(manifest.summary.count, 3);
assert.equal(manifest.summary.phases.near, 1);
assert.equal(manifest.summary.phases.far, 1);
assert.equal(manifest.summary.phases.full, 1);
assert.equal(manifest.summary.water.lake, 1);
assert(Object.isFrozen(manifest) && Object.isFrozen(manifest.plans));

const target = { material: { userData: {} }, water: {}, scene: {} };
assert.equal(applyWorldVisualAdoptionHints(target, base), true);
assert.equal(target.material.metalness, 0);
assert.equal(target.scene.userData.cameraRelativeSky, true);
assert.equal(target.water.userData.worldVisualAdoption.category, 'none');

const serializedA = stableWorldVisualAdoptionString(first);
const serializedB = stableWorldVisualAdoptionString(buildWorldVisualAdoptionPlan(base, { sceneAttachOwner: 'createScene' }));
assert.equal(serializedA, serializedB, 'serialization must be stable');

console.log('world-visual-adoption-director: PASS');
