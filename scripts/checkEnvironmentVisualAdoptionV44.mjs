import assert from 'node:assert/strict';
import { buildEnvironmentVisualAdoption, applyEnvironmentVisualAdoption } from '../src/3d/world/environmentVisualAdoptionV44.js';

const sample = { elevation: 0.91, slope: 0.74, moisture: 0.68, waterDistance: 0.07, biome: 'forest', canonicalHeight: 10, renderedHeight: 10.02, colliderHeight: 10.01, worldX: 12, worldZ: -8, seed: 42, moireRisk: false, rectangularCoverageRisk: false };
const first = buildEnvironmentVisualAdoption(sample);
const second = buildEnvironmentVisualAdoption(sample);
assert.deepEqual(first, second);
assert.equal(first.version, 'v44');
assert.ok(first.surface.snow > 0);
assert.ok(first.surface.foam > 0);
assert.equal(first.water.moireRisk, false);
assert.equal(first.water.rectangularCoverageRisk, false);
assert.equal(first.vegetation.eligible, true);
assert.equal(first.parity.pass, true);
assert.equal(first.risks.visibleSeam, false);
assert.equal(first.risks.blackSky, false);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.surface), true);

const blocked = buildEnvironmentVisualAdoption({ ...sample, underwater: true, rectangularCoverageRisk: true, moireRisk: true, blackSkyRisk: true });
assert.equal(blocked.vegetation.eligible, false);
assert.equal(blocked.water.rectangularCoverageRisk, true);
assert.equal(blocked.water.moireRisk, true);
assert.equal(blocked.risks.blackSky, true);

const target = {};
const applied = applyEnvironmentVisualAdoption(target, sample);
assert.equal(target.version, 'v44');
assert.equal(target.digest, applied.digest);

const malformed = buildEnvironmentVisualAdoption({ elevation: 'bad', slope: NaN, moisture: null, waterDistance: Infinity, fogNear: 'bad', fogFar: undefined });
assert.ok(Number.isFinite(malformed.atmosphere.fogNear));
assert.ok(Number.isFinite(malformed.atmosphere.fogFar));
assert.ok(Object.values(malformed.surface).every((value) => Number.isFinite(value)));

console.log('checkEnvironmentVisualAdoptionV44: PASS (24 assertions)');
