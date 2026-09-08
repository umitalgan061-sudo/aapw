#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import {
  VALYRIA_GEOLOGY_POLICY,
  normalizedOwnerMapAtWorldXZ,
  valyriaMorphologySignals,
} from '../src/3d/world/valyriaGeology.js';
import {
  VALYRIA_VOLCANIC_FEATURE_POLICY,
  checksumValyriaVolcanicFeatures,
  generateValyriaVolcanicFeatures,
} from '../src/3d/world/valyriaVolcanicFeatures.js';

const ROOT = resolve(import.meta.dirname, '..');
const renderSource = readFileSync(resolve(ROOT, 'src/3d/world/naturalGeology.js'), 'utf8');
const policy = VALYRIA_VOLCANIC_FEATURE_POLICY;
const worldWidthMeters = (WORLD_SCALE.MAP_BOUNDS.maxX - WORLD_SCALE.MAP_BOUNDS.minX) * WORLD_SCALE.METERS_PER_MAP_UNIT;
const worldDepthMeters = (WORLD_SCALE.MAP_BOUNDS.maxY - WORLD_SCALE.MAP_BOUNDS.minY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const seaLevelMeters = WORLD_DEFAULTS.WATER_LEVEL_METERS;

assert.equal(policy.renderOnly, true);
assert.equal(policy.deterministic, true);
assert.equal(policy.geographyAuthorityUnchanged, true);
assert.equal(policy.canonicalTerrainOwnsContinuousSurface, true);
assert.equal(policy.blanketGridOverlayForbidden, true);
assert.equal(policy.valyriaPolicyId, VALYRIA_GEOLOGY_POLICY.id);
assert(policy.maximumFeaturesDesktop > policy.maximumFeaturesMobile);
assert(policy.gridMetersDesktop < policy.gridMetersMobile);

const options = {
  sampleHeightMeters,
  seaLevelMeters,
  seed: WORLD_DEFAULTS.WORLD_SEED,
  worldWidthMeters,
  worldDepthMeters,
};
const first = generateValyriaVolcanicFeatures(options);
const second = generateValyriaVolcanicFeatures(options);
const mobile = generateValyriaVolcanicFeatures({ ...options, isMobileClass: true });

assert.equal(first.checksum, second.checksum, 'feature checksum must be deterministic');
assert.equal(first.checksum, checksumValyriaVolcanicFeatures(first.features));
assert.deepEqual(first.features, second.features, 'feature descriptors must be deterministic');
assert.equal(first.blanketSurfaceRemoved, true);
assert.equal(first.canonicalTerrainOwnsContinuousSurface, true);
assert(first.features.length >= 8, `too few volcanic features: ${first.features.length}`);
assert(first.features.length <= policy.maximumFeaturesDesktop);
assert(first.faultCount >= 2, `too few fault scarps: ${first.faultCount}`);
assert(first.lavaCount >= 2, `too few lava ribbons: ${first.lavaCount}`);
assert(mobile.features.length <= policy.maximumFeaturesMobile);
assert(mobile.features.length <= first.features.length);

const byType = {
  fault: first.features.filter((feature) => feature.type === 'fault'),
  lava: first.features.filter((feature) => feature.type === 'lava'),
};

for (const feature of first.features) {
  assert(Number.isFinite(feature.x) && Number.isFinite(feature.y) && Number.isFinite(feature.z));
  assert(feature.y > seaLevelMeters + policy.minimumDryClearanceMeters, `feature entered water/shore: ${feature.id}`);
  assert(feature.scale.x > 0 && feature.scale.y > 0 && feature.scale.z > 0);
  assert(feature.influence >= policy.minimumInfluence - 1e-12);
  const owner = normalizedOwnerMapAtWorldXZ(feature.x, feature.z);
  assert.equal(owner.insideOwnerMap, true);
  const morphology = valyriaMorphologySignals(owner.nx, owner.ny);
  if (feature.type === 'lava') {
    assert(morphology.lavaDrainage >= policy.lavaDrainageThreshold - 1e-12, `lava lost drainage correlation: ${feature.id}`);
    assert(feature.drainage >= policy.lavaDrainageThreshold - 1e-12);
    assert(feature.lavaWeight >= policy.lavaWeightThreshold - 1e-12 || feature.score >= policy.lavaWeightThreshold);
    assert(feature.slopeDegrees <= 34 + 1e-12);
  } else {
    assert(morphology.faultActivity >= policy.faultActivityThreshold - 1e-12, `fault lost activity correlation: ${feature.id}`);
    assert(Math.abs(morphology.faultEscarpment) * feature.influence >= policy.faultEdgeThreshold - 0.20, `fault edge too weak: ${feature.id}`);
    assert(feature.slopeDegrees >= 8 - 1e-12 && feature.slopeDegrees <= 57 + 1e-12);
  }
}

function assertSpacing(features, minimumMeters, label) {
  for (let i = 0; i < features.length; i += 1) {
    for (let j = i + 1; j < features.length; j += 1) {
      const distance = Math.hypot(features[i].x - features[j].x, features[i].z - features[j].z);
      assert(distance >= minimumMeters - 1e-8, `${label} spacing failed: ${features[i].id} ↔ ${features[j].id} = ${distance}`);
    }
  }
}
assertSpacing(byType.fault, policy.minimumFaultSpacingMeters, 'fault');
assertSpacing(byType.lava, policy.minimumLavaSpacingMeters, 'lava');

const P = VALYRIA_GEOLOGY_POLICY;
const expectedFaultYaw = Math.atan2(
  Math.sin(P.faultStrikeRadians) * P.coreRadius.ny * worldDepthMeters,
  Math.cos(P.faultStrikeRadians) * P.coreRadius.nx * worldWidthMeters,
);
const angleDelta = (a, b) => {
  let delta = (a - b) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta);
};
const faultYawDeltas = byType.fault.map((feature) => Math.min(
  angleDelta(feature.yawRadians, expectedFaultYaw),
  angleDelta(feature.yawRadians, expectedFaultYaw + Math.PI),
));
assert(Math.max(...faultYawDeltas) <= 0.12, `fault alignment drifted: ${Math.max(...faultYawDeltas)}`);

const lavaYawBuckets = new Set(byType.lava.map((feature) => Math.round((((feature.yawRadians % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 12))));
assert(lavaYawBuckets.size >= Math.min(4, byType.lava.length), `lava ribbons collapsed to too few directions: ${lavaYawBuckets.size}`);

// The old renderer built a second rectangular terrain sheet. Canonical terrain now owns continuous
// volcanic colour/height, so these source signatures must remain absent from the render module.
for (const forbidden of [
  'const vertices = [], colors = [], indices = []',
  'activeCells += 1',
  'new THREE.Float32BufferAttribute(vertices, 3)',
  'polygonOffsetFactor: -1',
]) {
  assert(!renderSource.includes(forbidden), `blanket volcanic overlay regressed: ${forbidden}`);
}
for (const required of [
  'createValyriaVolcanicFeatures',
  'valyria-fault-scarps',
  'valyria-lava-crust-ribbons',
  'legacyBlanketSurfaceRemoved: true',
  'canonicalTerrainOwnsContinuousValyriaSurface: true',
]) {
  assert(renderSource.includes(required), `sparse volcanic render contract lost: ${required}`);
}

const metrics = {
  policyId: policy.id,
  valyriaPolicyId: policy.valyriaPolicyId,
  featureCount: first.features.length,
  faultCount: first.faultCount,
  lavaCount: first.lavaCount,
  mobileFeatureCount: mobile.features.length,
  checksum: first.checksum,
  grid: first.candidateGrid,
  maxFaultYawDeltaRadians: Number(Math.max(...faultYawDeltas).toFixed(6)),
  lavaYawBucketCount: lavaYawBuckets.size,
  meanLavaDrainage: Number((byType.lava.reduce((sum, feature) => sum + feature.drainage, 0) / byType.lava.length).toFixed(6)),
  meanFaultActivity: Number((byType.fault.reduce((sum, feature) => sum + feature.faultActivity, 0) / byType.fault.length).toFixed(6)),
};
console.log('[checkValyriaVolcanicFeatureNaturalness] PASS');
console.log(JSON.stringify(metrics, null, 2));
