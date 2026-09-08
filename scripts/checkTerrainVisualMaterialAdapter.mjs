import assert from 'node:assert/strict';
import {
  deriveTerrainVisualMaterialContext,
  applyTerrainVisualMaterialContext,
  validateTerrainVisualMaterialContext,
  serializeTerrainVisualMaterialContext,
} from '../src/3d/world/terrainVisualMaterialAdapter.js';

const sample = {
  slopeDegrees: 58,
  heightAboveSeaMeters: 640,
  moisture: 0.32,
  waterDistanceMeters: 14,
  snowlineFactor: 0.82,
  biome: 'north-coast',
  cameraDistanceMeters: 120,
  worldX: 417.5,
  worldZ: -233.25,
};
const context = { warmth: 0.18, coolness: 0.88 };
const a = deriveTerrainVisualMaterialContext(sample, context);
const b = deriveTerrainVisualMaterialContext(sample, context);
assert.deepEqual(a, b);
assert.equal(a.policyId, 'terrain-visual-material-adapter-2026-09-08-v16');
assert.equal(a.manifest.multiMaterial, true);
assert.equal(a.weights.canonicalHeightUnchanged, true);
assert.equal(a.weights.canonicalHydrologyUnchanged, true);
assert.ok(a.weights.snow > 0.2);
assert.ok(a.weights.rock > 0.1);
assert.ok(a.weights.normalEnergy > 0);
assert.ok(a.weights.normalEnergy < 1);
assert.ok(a.weights.antiTiling >= 0 && a.weights.antiTiling <= 1);
assert.deepEqual(validateTerrainVisualMaterialContext(a), {
  valid: true,
  finite: true,
  bounded: true,
  normalized: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
});
assert.equal(serializeTerrainVisualMaterialContext(a), serializeTerrainVisualMaterialContext(b));

const material = { color: { r: 0, g: 0, b: 0 }, roughness: 0, metalness: 1, userData: {} };
const applied = applyTerrainVisualMaterialContext(material, sample, context);
assert.equal(applied.applied, true);
assert.equal(material.metalness, 0);
assert.equal(material.flatShading, false);
assert.equal(material.needsUpdate, true);
assert.ok(material.roughness >= 0.58 && material.roughness <= 0.98);
assert.ok(material.color.r >= 0 && material.color.r <= 1);
assert.equal(material.userData.terrainVisualMaterialAdapter, a.policyId);

const far = deriveTerrainVisualMaterialContext({ ...sample, cameraDistanceMeters: 99999 }, context);
assert.ok(far.weights.normalEnergy < a.weights.normalEnergy);

const malformed = deriveTerrainVisualMaterialContext({ slopeDegrees: 'bad', moisture: NaN, worldX: Infinity }, {});
const malformedCheck = validateTerrainVisualMaterialContext(malformed);
assert.equal(malformedCheck.valid, true);
assert.ok(Object.values(malformed.weights).every((value) => typeof value === 'boolean' || Number.isFinite(value) || typeof value === 'string'));

console.log(JSON.stringify({
  policy: a.policyId,
  surfaceClass: a.weights.surfaceClass,
  snow: Number(a.weights.snow.toFixed(6)),
  rock: Number(a.weights.rock.toFixed(6)),
  wetEdge: Number(a.weights.wetEdge.toFixed(6)),
  normalEnergy: Number(a.weights.normalEnergy.toFixed(6)),
  antiTiling: Number(a.weights.antiTiling.toFixed(6)),
  deterministic: serializeTerrainVisualMaterialContext(a) === serializeTerrainVisualMaterialContext(b),
  applied: applied.applied,
}));
