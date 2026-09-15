import assert from 'node:assert/strict';
import { buildEnvironmentMaterialApplicationV57, applyEnvironmentMaterialApplicationV57 } from '../src/3d/world/environmentMaterialApplicationV57.js';

const materials = [
  { name: 'cliff-rock', roughness: 0.1, normalScale: { set(x, y) { this.x = x; this.y = y; } }, aoMapIntensity: 0.1, userData: { materialRole: 'rock' } },
  { name: 'forest-leaves', roughness: 0.9, normalScale: { set(x, y) { this.x = x; this.y = y; } }, aoMapIntensity: 0.1, userData: { materialRole: 'leaves' } },
];
const input = { materials, slope: 0.78, snow: 0.12, wetEdge: 0.2, cameraDistance: 24, worldX: 120, worldZ: -44 };
const planA = buildEnvironmentMaterialApplicationV57(input);
const planB = buildEnvironmentMaterialApplicationV57({ ...input, materials: [...materials].reverse() });
assert.equal(planA.id, 'environment-material-application-v57');
assert.equal(planA.count, 2);
assert.equal(planA.plans[0].role, 'rock');
assert.ok(planA.plans[0].roughness > planA.plans[1].roughness - 0.1);
assert.ok(planA.plans.every((plan) => Number.isFinite(plan.antiTilingPhase)));
assert.ok(Object.isFrozen(planA) && Object.isFrozen(planA.plans[0]));
assert.equal(planB.plans.length, 2);
const applied = applyEnvironmentMaterialApplicationV57(input);
assert.equal(applied.applied, 2);
assert.equal(materials[0].userData.environmentVisualAdoptionV57.role, 'rock');
assert.equal(materials[1].userData.environmentVisualAdoptionV57.role, 'leaves');
const malformed = buildEnvironmentMaterialApplicationV57({ materials: [null, {}], slope: 'bad', snow: NaN, wetEdge: Infinity, cameraDistance: -10 });
assert.equal(malformed.count, 2);
assert.ok(malformed.plans.every((plan) => Number.isFinite(plan.roughness)));
console.log('Environment Material Application V57: PASS');
