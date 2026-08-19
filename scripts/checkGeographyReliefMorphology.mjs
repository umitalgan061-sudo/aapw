#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  REFERENCE_RELIEF_CHAINS,
  WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import {
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
  sampleNormalizedReferenceMountainReliefMeters,
  sampleReferenceDryLandWeight,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const EPSILON = 1e-9;
const rounded = (value, digits = 3) => Number(value.toFixed(digits));

const policy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.ridgeNaturalization;
assert(policy, 'ridgeNaturalization policy missing');
assert(policy.primarySharpness >= 1.2 && policy.primarySharpness <= 1.8, 'primary ridge sharpness drifted');
assert(policy.secondaryStrength >= 0.18 && policy.secondaryStrength <= 0.4, 'secondary ridge strength is not bounded');
assert(policy.outerRidgeStrength >= 0.06 && policy.outerRidgeStrength <= 0.2, 'outer ridge strength is not bounded');
assert(policy.valleyStrength >= 0.2 && policy.valleyStrength <= 0.5, 'valley cut is not visible/bounded');
assert(policy.secondaryCenter > 0.2 && policy.secondaryCenter < 0.6, 'secondary ridge is not on the shoulder');
assert(policy.outerRidgeCenter > policy.secondaryCenter, 'outer ridge must sit beyond secondary ridge');
assert(policy.outerRidgeCenter < 0.85, 'outer ridge would hug the chain envelope');

function aspectPoint([x, y]) {
  return { x: x * MAP_ASPECT, y };
}

function segmentFrame(chain, segmentIndex, t) {
  const a = aspectPoint(chain.points[segmentIndex]);
  const b = aspectPoint(chain.points[segmentIndex + 1]);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return null;
  return {
    x: a.x + dx * t,
    y: a.y + dy * t,
    tx: dx / length,
    ty: dy / length,
    nx: -dy / length,
    ny: dx / length,
  };
}

function sampleAspect(x, y) {
  const nx = x / MAP_ASPECT;
  if (nx < 0 || nx > 1 || y < 0 || y > 1) return null;
  return {
    x: nx,
    y,
    dry: sampleReferenceDryLandWeight(nx, y),
    meters: sampleNormalizedReferenceMountainReliefMeters(nx, y),
  };
}

function localMaxima(values, threshold = 0) {
  const peaks = [];
  for (let index = 1; index < values.length - 1; index += 1) {
    if (values[index] > threshold && values[index] > values[index - 1] && values[index] >= values[index + 1]) peaks.push(index);
  }
  return peaks;
}

function profileAcross(frame, outerWidth) {
  const samples = [];
  for (let index = -32; index <= 32; index += 1) {
    const offset = outerWidth * index / 32;
    const sample = sampleAspect(frame.x + frame.nx * offset, frame.y + frame.ny * offset);
    samples.push({ offset, ...sample });
  }
  return samples;
}

function profileAlong(frame, span) {
  const samples = [];
  for (let index = -28; index <= 28; index += 1) {
    const offset = span * index / 28;
    const sample = sampleAspect(frame.x + frame.tx * offset, frame.y + frame.ty * offset);
    samples.push({ offset, ...sample });
  }
  return samples;
}

const evidence = {};
for (const chain of REFERENCE_RELIEF_CHAINS) {
  const runtime = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
  assert(runtime, `${chain.id}: runtime profile missing`);
  let best = null;

  for (let segmentIndex = 0; segmentIndex < chain.points.length - 1; segmentIndex += 1) {
    for (const t of [0.22, 0.36, 0.5, 0.64, 0.78]) {
      const frame = segmentFrame(chain, segmentIndex, t);
      if (!frame) continue;
      const center = sampleAspect(frame.x, frame.y);
      if (!center || center.dry < WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) continue;
      if (!best || center.meters > best.center.meters) best = { frame, center, segmentIndex, t };
    }
  }

  assert(best, `${chain.id}: no dry centerline morphology sample`);
  assert(best.center.meters > 20, `${chain.id}: centerline is not visibly elevated`);

  const width = runtime.outerWidthNormalized * WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.shoulderWidthVariation.minimumScale;
  const lateral = profileAcross(best.frame, width).filter((row) => row.x !== undefined);
  const dryLateral = lateral.filter((row) => row.dry >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull);
  assert(dryLateral.length >= 18, `${chain.id}: insufficient dry lateral morphology samples`);

  const heights = dryLateral.map((row) => row.meters);
  const maxHeight = Math.max(...heights);
  const centerHeight = best.center.meters;
  assert(maxHeight >= centerHeight * 0.82, `${chain.id}: sampled ridge lost its main crest`);

  const sideRows = dryLateral.filter((row) => Math.abs(row.offset) > width * 0.18 && Math.abs(row.offset) < width * 0.82);
  assert(sideRows.some((row) => row.meters > centerHeight * 0.10 + 3), `${chain.id}: shoulders vanished completely`);
  assert(sideRows.some((row) => row.meters < centerHeight * 0.72), `${chain.id}: profile still reads like a broad flat wall`);

  const normalizedHeights = heights.map((value) => value / Math.max(maxHeight, EPSILON));
  const peaks = localMaxima(normalizedHeights, 0.07);
  assert(peaks.length >= 1, `${chain.id}: no resolved lateral ridge maximum`);

  const alongSpan = Math.max(runtime.outerWidthNormalized * 1.8, 0.045);
  const along = profileAlong(best.frame, alongSpan).filter((row) => row.x !== undefined && row.dry >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull);
  assert(along.length >= 16, `${chain.id}: insufficient along-chain samples`);
  const alongHeights = along.map((row) => row.meters);
  const alongMax = Math.max(...alongHeights);
  const alongMin = Math.min(...alongHeights);
  assert(alongMax - alongMin >= Math.min(45, alongMax * 0.12), `${chain.id}: chain remains suspiciously uniform along its length`);

  const outerDistance = runtime.outerWidthNormalized * WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.shoulderWidthVariation.maximumScale * 1.18;
  for (const sign of [-1, 1]) {
    const outside = sampleAspect(best.frame.x + best.frame.nx * outerDistance * sign, best.frame.y + best.frame.ny * outerDistance * sign);
    if (!outside || outside.dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) continue;
    assert(outside.meters <= centerHeight * 0.14 + 18, `${chain.id}: mountain relief materially escaped the canonical envelope`);
  }

  evidence[chain.id] = {
    centerHeightMeters: rounded(centerHeight),
    lateralMaxMeters: rounded(maxHeight),
    lateralResolvedPeaks: peaks.length,
    alongRangeMeters: rounded(alongMax - alongMin),
    lateralDrySamples: dryLateral.length,
    alongDrySamples: along.length,
  };
}

// Global scan: source-owned water must remain absolute zero and extreme relief must stay sparse.
let wetLeaks = 0;
let dryCount = 0;
let over300 = 0;
let over700 = 0;
let peak = 0;
for (let y = 0; y <= 96; y += 1) {
  for (let x = 0; x <= 144; x += 1) {
    const nx = x / 144;
    const ny = y / 96;
    const dry = sampleReferenceDryLandWeight(nx, ny);
    const meters = sampleNormalizedReferenceMountainReliefMeters(nx, ny);
    assert(Number.isFinite(meters) && meters >= 0, `global ${x}:${y}: invalid relief`);
    peak = Math.max(peak, meters);
    if (dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero && meters !== 0) wetLeaks += 1;
    if (dry >= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) {
      dryCount += 1;
      if (meters > 300) over300 += 1;
      if (meters > 700) over700 += 1;
    }
  }
}
assert.equal(wetLeaks, 0, 'relief leaked into source-owned sea/lake cells');
assert(peak > 550, 'new geography lacks a major mountain peak');
assert(dryCount > 1000, 'global scan did not cover enough source-owned dry land');
assert(over300 / dryCount < 0.22, 'too much dry land became >300m mountain relief');
assert(over700 / dryCount < 0.08, 'extreme mountain relief is no longer sparse');

console.log('GEOGRAPHY_RELIEF_MORPHOLOGY_OK', JSON.stringify({
  policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
  peakMeters: rounded(peak),
  drySamples: dryCount,
  over300Ratio: rounded(over300 / dryCount, 5),
  over700Ratio: rounded(over700 / dryCount, 5),
  evidence,
}));
