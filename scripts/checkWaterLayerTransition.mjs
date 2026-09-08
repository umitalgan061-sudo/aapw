#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WATER_DEPTH_FIELD_EXTENT_METERS, WATER_DEPTH_FIELD_OWNER_GUARD_METERS, WATER_DEPTH_FIELD_RESOLUTION } from '../src/3d/world/waterDepthField.js';
import {
  WATER_FIELD_EDGE_OPTICAL_POLICY,
  WATER_LAYER_TRANSITION_POLICY,
  waterFieldEdgeOpticalBlend,
  waterLayerTransitionAlpha,
  waterLayerTransitionBlend,
} from '../src/3d/world/water.js';

const policy = WATER_LAYER_TRANSITION_POLICY;
const edgePolicy = WATER_FIELD_EDGE_OPTICAL_POLICY;

assert.equal(policy.opacityConserving, true, 'near/far transition must conserve optical opacity');
assert.equal(policy.hardRectangularCutoff, false, 'hard near/far cutoff must remain retired');
assert.equal(policy.distanceAwareMicroNormalFade, true, 'distant micro-normal fade must stay enabled');
assert.equal(policy.distanceMetric, 'camera-relative-euclidean-organic', 'transition metric must remain non-rectangular and camera-relative');
assert(policy.organicWarpMeters > 0 && policy.organicWarpMeters < policy.featherStartMeters * 0.15,
  'near/far organic warp must remain bounded relative to the local detail radius');
assert(policy.organicWarpScaleMeters > policy.organicWarpMeters * 3,
  'near/far organic warp must vary broadly enough to avoid high-frequency transition noise');
assert(Number.isFinite(policy.featherStartMeters));
assert(Number.isFinite(policy.featherEndMeters));
assert(policy.featherStartMeters > 0, 'feather must begin outside the immediate player water detail zone');
assert(policy.featherEndMeters > policy.featherStartMeters, 'feather interval must have positive width');
assert(policy.featherEndMeters < policy.nearHalfExtentMeters, 'feather must complete before near geometry ends');
assert(policy.nearHalfExtentMeters - policy.featherEndMeters >= 5, 'transition needs a bounded geometry safety margin');

assert.equal(edgePolicy.renderOnly, true, 'field-edge correction must remain render-only');
assert.equal(edgePolicy.canonicalDepthTextureUnchanged, true, 'field-edge correction changed depth authority');
assert.equal(edgePolicy.canonicalCoverageUnchanged, true, 'field-edge correction changed wet/dry authority');
assert.equal(edgePolicy.canonicalShorelineUnchanged, true, 'field-edge correction changed shoreline authority');
assert.equal(edgePolicy.openOceanOnly, true, 'field-edge correction must remain marine-gated');
assert(edgePolicy.fullDeepStartMeters >= 0 && edgePolicy.blendEndMeters > edgePolicy.fullDeepStartMeters,
  'field-edge optical transition interval is invalid');
assert(edgePolicy.organicWarpMeters > 0 && edgePolicy.organicWarpMeters < edgePolicy.blendEndMeters,
  'field-edge warp must stay bounded inside the transition width');
assert(edgePolicy.blendEndMeters >= 1400,
  'full-world field-edge optics need a broad blend band to avoid a readable rectangular tone contour');

const ownerSpan = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS, WORLD_SCALE.WORLD_DEPTH_METERS);
const depthTexelStep = WATER_DEPTH_FIELD_EXTENT_METERS / (WATER_DEPTH_FIELD_RESOLUTION - 1);
assert.equal(WATER_DEPTH_FIELD_EXTENT_METERS, Math.ceil(ownerSpan * WATER_DEPTH_FIELD_RESOLUTION / (WATER_DEPTH_FIELD_RESOLUTION - 1)),
  'water depth field must derive its guarded extent from the canonical owner-map span');
assert(WATER_DEPTH_FIELD_EXTENT_METERS >= ownerSpan, 'canonical owner map escaped the data-backed water field');
assert(WATER_DEPTH_FIELD_OWNER_GUARD_METERS > depthTexelStep * 0.25,
  'owner-map edge needs more than one 2x2 coverage subsample radius of data-backed guard');

const EPS = 1e-10;
const blendAtStart = waterLayerTransitionBlend(policy.featherStartMeters);
const blendAtEnd = waterLayerTransitionBlend(policy.featherEndMeters);
assert(Math.abs(blendAtStart) <= EPS, 'far blend must be zero at feather start');
assert(Math.abs(blendAtEnd - 1) <= EPS, 'far blend must be one at feather end');
assert.equal(waterLayerTransitionBlend(policy.featherStartMeters - 1000), 0, 'blend must clamp below transition');
assert.equal(waterLayerTransitionBlend(policy.featherEndMeters + 1000), 1, 'blend must clamp above transition');

let previousBlend = -1;
let maximumBlendStep = 0;
const blendSamples = 512;
for (let index = 0; index <= blendSamples; index += 1) {
  const distance = policy.featherStartMeters
    + (policy.featherEndMeters - policy.featherStartMeters) * index / blendSamples;
  const blend = waterLayerTransitionBlend(distance);
  assert(Number.isFinite(blend), `non-finite blend at sample ${index}`);
  assert(blend >= -EPS && blend <= 1 + EPS, `blend escaped [0,1] at sample ${index}`);
  assert(blend + EPS >= previousBlend, `blend must be monotonic at sample ${index}`);
  if (index > 0) maximumBlendStep = Math.max(maximumBlendStep, blend - previousBlend);
  previousBlend = blend;
}
assert(maximumBlendStep < 0.004, `transition sampling shows a visible-size step: ${maximumBlendStep}`);

function compositeAlpha(nearAlpha, farAlpha) {
  return nearAlpha + farAlpha * (1 - nearAlpha);
}

const opacitySamples = [0.02, 0.08, 0.14, 0.27, 0.45, 0.68, 0.90, 0.99];
let worstOpacityError = 0;
let worstContinuityJump = 0;
for (const baseAlpha of opacitySamples) {
  let previousComposite = null;
  for (let index = 0; index <= blendSamples; index += 1) {
    const distance = policy.featherStartMeters
      + (policy.featherEndMeters - policy.featherStartMeters) * index / blendSamples;
    const nearAlpha = waterLayerTransitionAlpha(baseAlpha, distance, false);
    const farAlpha = waterLayerTransitionAlpha(baseAlpha, distance, true);
    assert(nearAlpha >= -EPS && nearAlpha <= 1 + EPS, `near alpha escaped range for ${baseAlpha}`);
    assert(farAlpha >= -EPS && farAlpha <= 1 + EPS, `far alpha escaped range for ${baseAlpha}`);
    const composite = compositeAlpha(nearAlpha, farAlpha);
    const opacityError = Math.abs(composite - baseAlpha);
    worstOpacityError = Math.max(worstOpacityError, opacityError);
    assert(opacityError < 2e-12, `opacity drift ${opacityError} for alpha=${baseAlpha}, sample=${index}`);
    if (previousComposite !== null) worstContinuityJump = Math.max(worstContinuityJump, Math.abs(composite - previousComposite));
    previousComposite = composite;
  }
  assert(Math.abs(waterLayerTransitionAlpha(baseAlpha, policy.featherStartMeters, false) - baseAlpha) < EPS, 'near layer must own feather start');
  assert(Math.abs(waterLayerTransitionAlpha(baseAlpha, policy.featherStartMeters, true)) < EPS, 'far layer must be absent at feather start');
  assert(Math.abs(waterLayerTransitionAlpha(baseAlpha, policy.featherEndMeters, false)) < EPS, 'near layer must be absent at feather end');
  assert(Math.abs(waterLayerTransitionAlpha(baseAlpha, policy.featherEndMeters, true) - baseAlpha) < EPS, 'far layer must own feather end');
}
assert(worstContinuityJump < 2e-12, `composited opacity is not continuous: ${worstContinuityJump}`);

for (const invalidAlpha of [-100, -1, -0.01]) {
  assert.equal(waterLayerTransitionAlpha(invalidAlpha, policy.featherStartMeters, false), 0, 'negative opacity must clamp to zero');
}
for (const invalidAlpha of [1.01, 2, 100]) {
  assert.equal(waterLayerTransitionAlpha(invalidAlpha, policy.featherStartMeters, false), 1, 'opacity above one must clamp to one');
}

assert.equal(waterFieldEdgeOpticalBlend(0, 1), 1, 'open ocean must match deep fallback at the field edge');
assert.equal(waterFieldEdgeOpticalBlend(edgePolicy.blendEndMeters + 1, 1), 0, 'field-edge optics must vanish inland of the blend band');
assert.equal(waterFieldEdgeOpticalBlend(0, 0), 0, 'enclosed/non-marine water must not receive field-edge deepening');
let previousEdgeBlend = 1 + EPS;
let maximumEdgeStep = 0;
for (let index = 0; index <= blendSamples; index += 1) {
  const distance = edgePolicy.blendEndMeters * index / blendSamples;
  const value = waterFieldEdgeOpticalBlend(distance, 1);
  assert(value <= previousEdgeBlend + EPS, `field-edge blend must decay monotonically at sample ${index}`);
  if (index > 0) maximumEdgeStep = Math.max(maximumEdgeStep, previousEdgeBlend - value);
  previousEdgeBlend = value;
}
assert(maximumEdgeStep < 0.004, `field-edge optical blend has a visible-size scalar step: ${maximumEdgeStep}`);
assert(waterFieldEdgeOpticalBlend(0, edgePolicy.marineGateStart) < 1e-9, 'marine gate must be closed at its start threshold');
assert(waterFieldEdgeOpticalBlend(0, edgePolicy.marineGateFull) > 0.999999, 'marine gate must be fully open at its full threshold');

const source = fs.readFileSync(new URL('../src/3d/world/water.js', import.meta.url), 'utf8');
assert(!source.includes('nearLayerDistance < 1999.5'), 'legacy hard rectangular far-water cutoff returned');
assert(!source.includes('float nearLayerDistance = max(abs(vWorldPosition.x - uCameraPosition.x), abs(vWorldPosition.z - uCameraPosition.z));'),
  'camera-near layer returned to an axis-aligned rectangular transition metric');
assert(source.includes('float localEdgeDistance = length(position.xz);'),
  'near swell geometry must fade radially rather than exposing a square displacement boundary');
assert(source.includes('float nearLayerDistance = length(cameraLocalXZ) + transitionFabric *'),
  'near/far opacity transition lost organic radial distance');
assert(source.includes('waterSurfaceNoise(vWorldPosition.xz /') && source.includes('organicWarpScaleMeters'),
  'near/far transition lost deterministic broad world-space breakup');
assert(!source.includes('(1.0 - offshoreOptical) * (1.0 - uFarLayerMask)'), 'far layer must not use a different lake optical classification');
assert(source.includes('float enclosedLakeMask = 1.0 - offshoreOptical;'), 'near/far lake optics must share the same canonical offshore classification');
assert(source.includes('surfaceAlpha *= 1.0 - layerBlend;'), 'near layer must feather rather than terminate at a rectangle');
assert(source.includes('(surfaceAlpha * layerBlend) / max(1.0 - nearAlpha, 0.001)'), 'far layer must use opacity-conserving complementary feathering');
assert(source.includes('float microSlopeFade = 1.0 - smoothstep(520.0, 2800.0, cameraDistance);'), 'distant micro-normal suppression drifted');
assert(source.includes('float marineBedOcclusion = smoothstep(0.26, 0.70, fragmentDepth) * smoothstep(0.50, 0.88, offshoreOptical);')
  && source.includes('alpha = mix(alpha, 1.0, marineBedOcclusion);'), 'offshore seabed occlusion must suppress terrain-footprint bleed without hiding shallow coasts');
assert(source.includes('fragmentDepth = mix(fragmentDepth, 1.0, edgeOpticalBlend * marineGate);'), 'field-edge open-ocean optical convergence is not wired into the shader');
assert(source.includes('oceanFabric *') && source.includes('organicWarpMeters'), 'field-edge transition lost deterministic organic breakup');
assert.equal((source.match(/float waterCoverage\s*=/g) ?? []).length, 1, 'field-edge correction must not create a second wet/dry coverage authority');
assert(source.includes('if (surfaceAlpha <= 0.001) discard;'), 'fully faded transition fragments must not write transparent seam pixels');

const edgeProbe = 0.5;
assert(waterLayerTransitionBlend(policy.featherEndMeters - edgeProbe) > 0.99998, 'smooth feather should approach one continuously at the far edge');
assert(waterLayerTransitionBlend(policy.featherStartMeters + edgeProbe) < 0.00002, 'smooth feather should leave zero continuously at the near edge');

console.log('[checkWaterLayerTransition] PASS', {
  policyId: policy.id,
  fieldEdgePolicyId: edgePolicy.id,
  waterDepthFieldExtentMeters: WATER_DEPTH_FIELD_EXTENT_METERS,
  waterDepthFieldOwnerGuardMeters: WATER_DEPTH_FIELD_OWNER_GUARD_METERS,
  featherMeters: policy.featherEndMeters - policy.featherStartMeters,
  fieldEdgeBlendMeters: edgePolicy.blendEndMeters - edgePolicy.fullDeepStartMeters,
  blendSamples,
  opacitySamples: opacitySamples.length,
  worstOpacityError,
  worstContinuityJump,
  maximumBlendStep,
  maximumEdgeStep,
});
