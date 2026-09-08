import assert from 'node:assert/strict';
import {
  createGroundedSurfaceProfile,
  summarizeGroundedSurfaceProfile,
} from '../src/3d/world/groundedSurfaceProfile.js';

const alpineInput = {
  seed: 91,
  x: 330,
  z: -220,
  terrain: { height: 214, slope: 0.76, moisture: 0.44, groundConfidence: 0.98 },
  hydrology: { waterDistance: 61, waterConfidence: 0.02 },
  biome: { snowline: 160, treeline: 112, temperature: 0.08 },
  cameraDistance: 24,
};
const a = createGroundedSurfaceProfile(alpineInput);
const b = createGroundedSurfaceProfile(alpineInput);
assert.deepEqual(a, b, 'profile must be deterministic');
assert.equal(a.canonicalMutation, false);
assert.ok(a.surface.weights.snow > a.surface.weights.grass, 'alpine snow should dominate grass');
assert.ok(a.relief.screeBias > 0.2, 'steep alpine terrain should expose scree');
assert.ok(a.surface.normalEnergy > 0.6, 'near detail should remain readable');

const shoreline = createGroundedSurfaceProfile({
  seed: 7,
  x: 12,
  z: 19,
  terrain: { height: 7, slope: 0.22, moisture: 0.9, groundConfidence: 0.88 },
  hydrology: { waterDistance: 1.2, waterConfidence: 0.95 },
  biome: { snowline: 180, treeline: 125, temperature: 0.55 },
  cameraDistance: 320,
});
assert.equal(shoreline.placement.vegetationAllowed, false);
assert.equal(shoreline.placement.exclusionReason, 'canonical-water');
assert.ok(shoreline.surface.weights.wetEdge > 0, 'shoreline must receive wet-edge signal');
assert.ok(shoreline.surface.normalEnergy < a.surface.normalEnergy, 'far detail must fade');

const steep = createGroundedSurfaceProfile({
  terrain: { height: 100, slope: 0.95, moisture: 0.3, groundConfidence: 0.9 },
  hydrology: { waterDistance: 900, waterConfidence: 0 },
  biome: { snowline: 300, treeline: 150, temperature: 0.4 },
});
assert.equal(steep.placement.exclusionReason, 'steep-slope');

const malformed = createGroundedSurfaceProfile({
  terrain: { height: Number.NaN, slope: Infinity, moisture: undefined, groundConfidence: Number.NaN },
  hydrology: { waterDistance: Number.NaN, waterConfidence: Number.NaN },
  biome: { snowline: Number.NaN, temperature: Number.NaN },
});
const summary = summarizeGroundedSurfaceProfile(malformed);
assert.equal(summary.finite, true);
assert.equal(summary.canonicalMutation, false);
for (const value of Object.values(summary)) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
}

console.log(JSON.stringify({
  ok: true,
  alpine: summarizeGroundedSurfaceProfile(a),
  shoreline: summarizeGroundedSurfaceProfile(shoreline),
  steep: summarizeGroundedSurfaceProfile(steep),
}, null, 2));
