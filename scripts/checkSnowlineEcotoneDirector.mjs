import assert from 'node:assert/strict';
import { createSnowlineEcotoneSignal, summarizeSnowlineEcotone } from '../src/3d/world/snowlineEcotoneDirector.js';

const alpine = createSnowlineEcotoneSignal({
  seed: 44,
  x: 120,
  z: -80,
  terrain: { height: 178, slope: 0.72, aspect: 0.4, moisture: 0.48, groundConfidence: 0.96 },
  climate: { snowline: 140, treeline: 102, temperature: 0.08, snowPersistence: 0.92, windExposure: 0.62 },
  hydrology: { waterDistance: 48 },
  cameraDistance: 35,
});

const alpineAgain = createSnowlineEcotoneSignal({
  seed: 44,
  x: 120,
  z: -80,
  terrain: { height: 178, slope: 0.72, aspect: 0.4, moisture: 0.48, groundConfidence: 0.96 },
  climate: { snowline: 140, treeline: 102, temperature: 0.08, snowPersistence: 0.92, windExposure: 0.62 },
  hydrology: { waterDistance: 48 },
  cameraDistance: 35,
});
assert.deepEqual(alpine, alpineAgain, 'signal must be deterministic');
assert.ok(alpine.material.weights.snow > alpine.material.weights.grass, 'alpine snow should dominate grass');
assert.ok(alpine.relief.talusBias > 0.25, 'steep alpine terrain should expose talus');
assert.equal(alpine.canonicalMutation, false);

const shoreline = createSnowlineEcotoneSignal({
  seed: 12,
  x: 2,
  z: 5,
  terrain: { height: 138, slope: 0.18, aspect: 1.1, moisture: 0.88, groundConfidence: 0.91 },
  climate: { snowline: 180, treeline: 122, temperature: 0.52, snowPersistence: 0.1, windExposure: 0.2 },
  hydrology: { waterDistance: 1.5 },
  cameraDistance: 120,
});
assert.equal(shoreline.placement.vegetationAllowed, false, 'water proximity must exclude vegetation');
assert.equal(shoreline.placement.exclusionReason, 'water-proximity');
assert.ok(shoreline.material.weights.grass > shoreline.material.weights.snow);
assert.ok(shoreline.material.normalEnergy < alpine.material.normalEnergy);

const malformed = createSnowlineEcotoneSignal({
  terrain: { height: Number.NaN, slope: Infinity, moisture: undefined },
  climate: { temperature: Number.NaN },
  hydrology: { waterDistance: Number.NaN },
});
const summary = summarizeSnowlineEcotone(malformed);
assert.equal(summary.finite, true);
assert.equal(summary.canonicalMutation, false);
assert.equal(summary.grounded, true);
for (const value of Object.values(summary)) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
}

console.log(JSON.stringify({ ok: true, alpine: summarizeSnowlineEcotone(alpine), shoreline: summarizeSnowlineEcotone(shoreline) }, null, 2));
