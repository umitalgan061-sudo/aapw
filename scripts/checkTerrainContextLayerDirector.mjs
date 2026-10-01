import assert from 'node:assert/strict';
import { evaluateTerrainContext, sampleTerrainContextGrid, summarizeTerrainContext, TERRAIN_CONTEXT_LAYER_POLICY } from '../src/3d/world/terrainContextLayerDirector.js';

const finiteDeep = (value) => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return true;
  return Object.values(value).every(finiteDeep);
};
const sum = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const deepFreeze = (value) => Object.isFrozen(value) && (typeof value !== 'object' || Object.values(value).every((entry) => (entry && typeof entry === 'object' ? deepFreeze(entry) : true)));

const alpine = evaluateTerrainContext({ x: 320, z: -180, height: 124, slope: 0.74, moisture: 0.42, temperature: -0.82, waterDistance: 88, canonicalWater: 0, groundConfidence: 1, cameraDistance: 24, seed: 77 });
const alpineAgain = evaluateTerrainContext({ x: 320, z: -180, height: 124, slope: 0.74, moisture: 0.42, temperature: -0.82, waterDistance: 88, canonicalWater: 0, groundConfidence: 1, cameraDistance: 24, seed: 77 });
assert.deepEqual(alpine, alpineAgain);
assert.equal(alpine.version, 'terrain-context-layer-v12');
assert.equal(deepFreeze(alpine), true);
assert.equal(finiteDeep(alpine), true);
assert.ok(alpine.surface.snow > alpine.surface.grass);
assert.ok(alpine.surface.rock > alpine.surface.grass);
assert.ok(alpine.placement.rockAllowed);
assert.equal(alpine.placement.vegetationAllowed, false);
assert.ok(alpine.masks.snowline > 0);

const shore = evaluateTerrainContext({ x: -64, z: 512, height: 1.8, slope: 0.12, moisture: 0.72, temperature: 0.2, waterDistance: 0.8, canonicalWater: 0, groundConfidence: 1, cameraDistance: 10, seed: 77 });
assert.ok(shore.surface.wetEdge > 0.1);
assert.ok(shore.surface.mud > shore.surface.rock);
assert.ok(shore.masks.shorelineBlend > 0.1);

const sea = evaluateTerrainContext({ x: 12, z: 42, height: -4, slope: 0.02, moisture: 0.95, temperature: 0.4, waterDistance: 0, canonicalWater: 1, groundConfidence: 0, cameraDistance: 200, seed: 77 });
assert.equal(sea.placement.sea, true);
assert.equal(sea.placement.vegetationAllowed, false);
assert.equal(sea.placement.rockAllowed, false);
assert.equal(sea.placement.exclusionReason, 'canonical-water');

const far = evaluateTerrainContext({ ...alpine, cameraDistance: 1800 });
assert.ok(far.breakup.normalEnergy < alpine.breakup.normalEnergy);
assert.ok(far.material.normalStrength < alpine.material.normalStrength);

const gridA = sampleTerrainContextGrid({ originX: 0, originZ: 0, step: 18, width: 7, height: 6, context: { height: 18, slope: 0.22, moisture: 0.36, temperature: 0.12, waterDistance: 60, canonicalWater: 0, groundConfidence: 1, seed: 99 } });
const gridB = sampleTerrainContextGrid({ originX: 0, originZ: 0, step: 18, width: 7, height: 6, context: { height: 18, slope: 0.22, moisture: 0.36, temperature: 0.12, waterDistance: 60, canonicalWater: 0, groundConfidence: 1, seed: 99 } });
assert.deepEqual(gridA, gridB);
assert.equal(gridA.length, 42);
assert.ok(gridA.every((cell) => Math.abs(sum(cell.surface) - 1) < 1e-6));
assert.ok(gridA.every((cell) => cell.surface.wetEdge >= 0 && cell.surface.wetEdge <= 1));

const malformed = evaluateTerrainContext({ x: Infinity, z: NaN, height: 'bad', slope: null, moisture: undefined, temperature: 'hot', waterDistance: -1, canonicalWater: 7, groundConfidence: -4, cameraDistance: -20 });
assert.equal(finiteDeep(malformed), true);
assert.equal(malformed.placement.sea, false);
assert.equal(malformed.placement.exclusionReason, 'low-ground-confidence');

const summary = summarizeTerrainContext(alpine);
assert.equal(summary.finite, true);
assert.ok(['grass', 'soil', 'mud', 'sand', 'rock', 'snow', 'wetEdge'].includes(summary.dominantSurface));
assert.equal(TERRAIN_CONTEXT_LAYER_POLICY.canonicalHeightMutation, false);
assert.equal(TERRAIN_CONTEXT_LAYER_POLICY.canonicalHydrologyMutation, false);
assert.equal(TERRAIN_CONTEXT_LAYER_POLICY.gridTerm, false);
assert.equal(TERRAIN_CONTEXT_LAYER_POLICY.pindexTerm, false);

console.log(JSON.stringify({
  ok: true,
  deterministic: true,
  alpine: { snow: alpine.surface.snow, rock: alpine.surface.rock, vegetationAllowed: alpine.placement.vegetationAllowed },
  shoreline: { wetEdge: shore.surface.wetEdge, mud: shore.surface.mud },
  seaExclusion: sea.placement.exclusionReason,
  gridCells: gridA.length,
  farNormalEnergy: far.breakup.normalEnergy,
}));
