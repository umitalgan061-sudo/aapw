import assert from 'node:assert/strict';
import {
  V64_VISUAL_AUDIT_POLICY,
  auditV64Sample,
  compareV64SampleAudits,
  createV64DeterministicCameraSet,
} from '../src/3d/world/environmentDressingVisualAuditV64.js';

const clean = {
  terrain: { canonicalHeight: 100 },
  water: { seamRisk: 0, moireRisk: 0, cyanRisk: 0, rectangular: false, repeatedStripe: false },
  material: { placeholder: false },
  vegetation: [{ grounded: true, groundConfidence: 0.94 }],
  camera: { width: 1536, height: 1024, orthographicDegrees: 90 },
  renderedY: 100.04,
  colliderY: 100.02,
  backgroundLuminance: 0.15,
};

const pass = auditV64Sample(clean);
assert.equal(pass.pass, true);
assert.equal(pass.errors.length, 0);
assert.equal(pass.cameraValid, true);
assert.equal(pass.vegetationGrounding, true);

const broken = auditV64Sample({
  ...clean,
  water: { ...clean.water, rectangular: true, repeatedStripe: true, seamRisk: 0.9, cyanRisk: 0.8 },
  material: { placeholder: true },
  vegetation: [{ grounded: false, groundConfidence: 0.4 }],
  backgroundLuminance: 0.01,
  renderedY: 100.8,
});
assert.equal(broken.pass, false);
assert.ok(broken.errors.includes('rectangularWater'));
assert.ok(broken.errors.includes('placeholder') === false);
assert.ok(broken.errors.includes('blackSky'));
assert.ok(broken.parityMeters > pass.parityMeters);

const improved = compareV64SampleAudits(broken, clean);
assert.equal(improved.improved, true);
assert.ok(improved.riskDelta > 0);
assert.ok(improved.parityDelta > 0);

const cameras = createV64DeterministicCameraSet('camera');
assert.equal(cameras.length, 4);
assert.deepEqual(cameras, createV64DeterministicCameraSet('camera'));
assert.ok(cameras.every((camera) => camera.width === V64_VISUAL_AUDIT_POLICY.camera.width));
console.log(JSON.stringify({ ok: true, contract: V64_VISUAL_AUDIT_POLICY.id }, null, 2));
