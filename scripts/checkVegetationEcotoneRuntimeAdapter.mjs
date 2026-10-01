import assert from 'node:assert/strict';
import { createVegetationEcotoneRuntimeAdapter, applyVegetationEcotoneRuntimeAdapter, serializeVegetationEcotoneRuntimeAdapter } from '../src/3d/world/vegetationEcotoneRuntimeAdapter.js';

const sample = {
  biome: 'alpine', x: 1234.5, z: -765.25, seed: 19,
  height01: 0.82, slope01: 0.31, moisture01: 0.74,
  waterDistance: 36, roadDistance: 24, settlementDistance: 70,
  snow01: 0.18, canopy01: 0.68, clearance01: 0.84,
  loadedAssetCount: 96, rendererBudget01: 0.92,
};

const a = createVegetationEcotoneRuntimeAdapter(sample);
const b = createVegetationEcotoneRuntimeAdapter(sample);
assert.deepEqual(a, b, 'adapter must be deterministic');
assert.equal(Object.isFrozen(a), true);
assert.equal(Object.isFrozen(a.placement), true);
assert.ok(a.masks.forest >= 0 && a.masks.forest <= 1);
assert.ok(a.masks.ecotone >= 0 && a.masks.ecotone <= 1);
assert.equal(a.placement.accepted, true);
assert.equal(a.renderer.instancingRequired, true);
assert.equal(typeof a.antiTilingPhase, 'number');

const water = createVegetationEcotoneRuntimeAdapter({ ...sample, waterDistance: 0.4 });
assert.equal(water.placement.accepted, false);
assert.equal(water.placement.reason, 'water-proximity');

const cliff = createVegetationEcotoneRuntimeAdapter({ ...sample, slope01: 0.98 });
assert.equal(cliff.placement.accepted, false);
assert.equal(cliff.placement.reason, 'steep-slope');

const snow = createVegetationEcotoneRuntimeAdapter({ ...sample, snow01: 1 });
assert.equal(snow.placement.accepted, false);
assert.equal(snow.placement.reason, 'snow-cover');

const malformed = createVegetationEcotoneRuntimeAdapter({ biome: null, x: 'bad', z: Infinity, slope01: 'bad', waterDistance: 'bad' });
assert.equal(Number.isFinite(malformed.density), true);
assert.equal(Number.isFinite(malformed.antiTilingPhase), true);
assert.ok(malformed.density >= 0 && malformed.density <= 1);

const target = {};
const applied = applyVegetationEcotoneRuntimeAdapter(a, target);
assert.equal(applied, target);
assert.equal(applied.vegetationEcotone.lodTier, a.renderer.lodTier);
assert.equal(serializeVegetationEcotoneRuntimeAdapter(a), serializeVegetationEcotoneRuntimeAdapter(b));

console.log('vegetation ecotone runtime adapter contract: PASS');
