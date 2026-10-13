import assert from 'node:assert/strict';
import { sampleShorelineMaterialBlend, validateShorelineMaterialBlend } from '../src/3d/world/shorelineMaterialBlend.js';

const base = { x: 412.5, z: -188.25, depth: 0.2, shoreDistance: 1.5, waterConfidence: 0.92, slope: 0.16, moisture: 0.82, seed: 20260908, cameraDistance: 12 };
const a = sampleShorelineMaterialBlend(base);
const b = sampleShorelineMaterialBlend(base);
assert.deepEqual(a, b, 'shoreline blend must be deterministic');
assert.equal(validateShorelineMaterialBlend(a), true, 'blend must remain finite and valid');
assert.ok(a.weights.foam > 0, 'near shallow shoreline must expose foam response');
assert.ok(a.weights.wetEdge > 0, 'near shoreline must expose wet edge response');
assert.ok(a.weights.shallow > a.weights.deep, 'shallow water must dominate at low depth');
assert.equal(a.diagnostics.tileRisk, 0, 'tile risk contract must stay zero');

const far = sampleShorelineMaterialBlend({ ...base, cameraDistance: 2200 });
assert.ok(far.pbr.normalEnergy < a.pbr.normalEnergy, 'far distance must fade micro-normal energy');

const deep = sampleShorelineMaterialBlend({ ...base, depth: 12, shoreDistance: 90, waterConfidence: 1 });
assert.ok(deep.weights.deep > deep.weights.shallow, 'deep water must dominate at depth');
assert.equal(validateShorelineMaterialBlend(sampleShorelineMaterialBlend({ depth: 'bad', x: NaN, z: Infinity })), true, 'malformed input must fail closed to finite output');

console.log('shoreline-material-blend: PASS');
