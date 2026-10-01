#!/usr/bin/env node
import assert from 'node:assert/strict';
import { auditVisualContinuity, buildVisualContinuityManifest, TERRAIN_ENVIRONMENT_VISUAL_CONTINUITY_AUDIT_POLICY } from '../src/3d/world/terrainEnvironmentVisualContinuityAudit.js';

const samples = [
  { worldX: 0, worldZ: 0, heightMeters: 10, waterDepth: 0, waterConfidence: 0, shorelineDistanceMeters: 12, surfaceContrast: 0.42, macroBreakup: 0.31, microBreakup: 0.28, normalEnergy: 0.65, backgroundLuma: 0.28, tileRisk: 0.14, category: 'land' },
  { worldX: 12, worldZ: 0, heightMeters: 10.01, waterDepth: 0, waterConfidence: 0, shorelineDistanceMeters: 14, surfaceContrast: 0.44, macroBreakup: 0.33, microBreakup: 0.29, normalEnergy: 0.64, backgroundLuma: 0.28, tileRisk: 0.11, category: 'land' },
  { worldX: 24, worldZ: 0, heightMeters: 10.02, waterDepth: 0, waterConfidence: 0, shorelineDistanceMeters: 18, surfaceContrast: 0.45, macroBreakup: 0.34, microBreakup: 0.30, normalEnergy: 0.63, backgroundLuma: 0.27, tileRisk: 0.10, category: 'land' },
];
const clean = auditVisualContinuity({ samples });
assert.equal(clean.policyId, TERRAIN_ENVIRONMENT_VISUAL_CONTINUITY_AUDIT_POLICY.id);
assert.equal(clean.acceptance.ok, true);
assert.equal(clean.counts.seamCount, 0);
assert.equal(clean.counts.gridCount, 0);
assert.equal(clean.counts.rectangularWaterCount, 0);
assert.equal(clean.counts.moireCount, 0);
assert.equal(clean.counts.blackSkyCount, 0);
assert.ok(Number.isFinite(clean.maxAdjacentDelta));
assert.deepEqual(clean, auditVisualContinuity({ samples }));

const failure = auditVisualContinuity({
  samples: [
    ...samples,
    { worldX: 36, worldZ: 0, heightMeters: 40, waterDepth: 5, waterConfidence: 1, shorelineDistanceMeters: 500, surfaceContrast: 1, macroBreakup: 1, microBreakup: 1, normalEnergy: 1, backgroundLuma: 0, tileRisk: 1, category: 'water' },
  ],
});
assert.equal(failure.acceptance.ok, false);
assert.ok(failure.errors.includes('visible-seam-risk'));
assert.ok(failure.errors.includes('rectangular-water-risk'));
assert.ok(failure.errors.includes('water-moire-risk'));
assert.ok(failure.errors.includes('black-sky-risk'));

const manifest = buildVisualContinuityManifest({ samples, camera: { width: 1536, height: 1024, projection: 'orthographic', fovDegrees: 90 }, seed: 'visual-audit-v15' });
assert.equal(manifest.camera.width, 1536);
assert.equal(manifest.camera.height, 1024);
assert.equal(manifest.camera.projection, 'orthographic');
assert.equal(manifest.seed, 'visual-audit-v15');
assert.equal(manifest.audit.acceptance.ok, true);
assert.equal(JSON.stringify(manifest), JSON.stringify(buildVisualContinuityManifest({ samples, camera: { width: 1536, height: 1024, projection: 'orthographic', fovDegrees: 90 }, seed: 'visual-audit-v15' })));

console.log(JSON.stringify({ ok: true, policyId: manifest.policyId, sampleCount: manifest.audit.sampleCount, maxAdjacentDelta: manifest.audit.maxAdjacentDelta, errorCount: manifest.audit.acceptance.errorCount }));
