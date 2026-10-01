import assert from 'node:assert/strict';
import { ATMOSPHERE_RUNTIME_POLICY, applyAtmosphereRuntimeGuidance, resolveAtmosphereRuntimeGuidance } from '../src/3d/atmosphereRuntimeGuard.js';

const base = { nightFactor: 0.72, exposure: 0.35, fogDensity: 0.002, fogNear: 90, fogFar: 7200, horizonLuma: 0.28, zenithLuma: 0.19 };
const a = resolveAtmosphereRuntimeGuidance(base);
const b = resolveAtmosphereRuntimeGuidance(base);
assert.deepEqual(a, b, 'atmosphere guidance must be deterministic');
assert.equal(a.accepted, true);
assert.equal(a.fallbackActive, false);
assert.equal(a.policyId, ATMOSPHERE_RUNTIME_POLICY.id);
assert.ok(a.fogFar > a.fogNear);
assert.ok(a.horizonLuma >= 0.04 && a.zenithLuma >= 0.025);

const black = resolveAtmosphereRuntimeGuidance({ horizonLuma: 0.01, zenithLuma: 0.01, nightFactor: 1 });
assert.equal(black.accepted, false);
assert.equal(black.fallbackActive, true);

const target = {};
assert.deepEqual(applyAtmosphereRuntimeGuidance(target, a), { applied: true, policyId: ATMOSPHERE_RUNTIME_POLICY.id });
assert.equal(target.userData.atmosphereRuntimeGuard.cameraRelative, true);
assert.equal(applyAtmosphereRuntimeGuidance(null, a).applied, false);
assert.equal(applyAtmosphereRuntimeGuidance({}, black).applied, false);

console.log('ATMOSPHERE_RUNTIME_GUARD_OK');
