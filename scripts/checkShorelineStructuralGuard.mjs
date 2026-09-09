import assert from 'node:assert/strict';
import { classifyShorelineStructuralRisk, summarizeShorelineStructuralRisk } from '../src/3d/world/shorelineStructuralGuard.js';

const clean = classifyShorelineStructuralRisk({ x: 12, y: 19, seed: 7, waterConfidence: 0, shorelineDistance: 40, depth: 0, sampleSpacing: 8, neighbourDelta: 0 });
assert.equal(clean.seamRisk, 0);
assert.equal(clean.rectangularWaterRisk, 0);
assert.equal(clean.visibilityTarget.visibleSeam, 0);
assert.deepEqual(clean, classifyShorelineStructuralRisk({ x: 12, y: 19, seed: 7, waterConfidence: 0, shorelineDistance: 40, depth: 0, sampleSpacing: 8, neighbourDelta: 0 }));

const guarded = classifyShorelineStructuralRisk({ x: 64, y: 64, seed: 7, waterConfidence: 1, shorelineDistance: 0.4, depth: 3, sampleSpacing: 8, neighbourDelta: 10 });
assert.ok(guarded.rectangularWaterRisk > 0);
assert.ok(guarded.seamRisk > 0);
assert.equal(guarded.renderHints.preserveCanonicalHydrology, true);

const summary = summarizeShorelineStructuralRisk([clean, guarded]);
assert.equal(summary.sampleCount, 2);
assert.equal(summary.acceptance, 'guarded');
assert.ok(Object.isFrozen(summary));
assert.ok(Object.isFrozen(summary));

const malformed = classifyShorelineStructuralRisk({ x: 'bad', y: null, depth: NaN, waterConfidence: Infinity });
for (const value of Object.values(malformed)) {
  if (typeof value === 'number') assert.equal(Number.isFinite(value), true);
}
console.log('shoreline structural guard contract: ok');
