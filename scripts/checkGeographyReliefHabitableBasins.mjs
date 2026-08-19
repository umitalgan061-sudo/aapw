#!/usr/bin/env node
import assert from 'node:assert/strict';

import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
  REFERENCE_BIOME_ZONES,
  WORLD_REFERENCE_MAP,
  sampleReferenceInfluence,
} from '../src/3d/world/worldReferenceMap.js';
import {
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
  sampleNormalizedReferenceMountainReliefMeters,
  sampleReferenceDryLandWeight,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const rounded = (value, digits = 3) => Number(value.toFixed(digits));
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

const seats = [
  [3885, 5370], [1525, 1750], [1185, 4040], [1095, 4040], [1145, 3990], [1750, 3580], [2100, 3270],
  [1610, 4560], [920, 2900], [1850, 2790], [1650, 1060], [1050, 3360], [6190, 5140], [1400, 300],
].map(([mapX, mapY]) => ({
  x: mapX / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits,
  y: mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits,
}));

const policy = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.habitableSeatProtection;
assert(policy, 'habitableSeatProtection policy missing');
assert(policy.innerRadiusNormalized > 0, 'seat protection inner radius must be positive');
assert(policy.outerRadiusNormalized > policy.innerRadiusNormalized, 'seat protection outer radius must exceed inner');
assert(policy.minimumMultiplier >= 0.1 && policy.minimumMultiplier <= 0.40, 'seat protection minimum multiplier is not a bounded basin');

function sampleRing(center, radius, count = 48) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const angle = index / count * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radius / MAP_ASPECT;
    const y = center.y + Math.sin(angle) * radius;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    const dry = sampleReferenceDryLandWeight(x, y);
    if (dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) continue;
    rows.push(sampleNormalizedReferenceMountainReliefMeters(x, y));
  }
  return rows;
}

const seatEvidence = [];
for (const [index, seat] of seats.entries()) {
  const dry = sampleReferenceDryLandWeight(seat.x, seat.y);
  const centerHeight = sampleNormalizedReferenceMountainReliefMeters(seat.x, seat.y);
  assert(Number.isFinite(centerHeight) && centerHeight >= 0, `seat ${index}: invalid center relief`);
  if (dry <= WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateZero) {
    assert.equal(centerHeight, 0, `seat ${index}: source-owned water gained relief`);
    continue;
  }

  const inner = sampleRing(seat, policy.innerRadiusNormalized * 0.72);
  const outer = sampleRing(seat, policy.outerRadiusNormalized * 1.18);
  assert(inner.length >= 8, `seat ${index}: insufficient source-dry inner basin samples`);
  assert(outer.length >= 8, `seat ${index}: insufficient source-dry outer-context samples`);

  const inner80 = percentile(inner, 0.8);
  const outer80 = percentile(outer, 0.8);
  const outerMax = Math.max(...outer);
  assert(inner80 <= Math.max(180, outer80 * 0.92 + 18), `seat ${index}: protected basin is not materially calmer than its context`);
  assert(centerHeight <= Math.max(160, outerMax * 0.72 + 20), `seat ${index}: seat center retained a mountain-wall spike`);

  seatEvidence.push({
    index,
    centerHeightMeters: rounded(centerHeight),
    inner80Meters: rounded(inner80),
    outer80Meters: rounded(outer80),
    outerMaxMeters: rounded(outerMax),
  });
}

const highlandIds = new Set(Object.keys(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.highlands));
assert.deepEqual([...highlandIds].sort(), ['lands-always-winter', 'north', 'westerlands'], 'unexpected highland geography coverage');

const zonesById = new Map(REFERENCE_BIOME_ZONES.map((zone) => [zone.id, zone]));
const highlandEvidence = {};
for (const id of highlandIds) {
  const zone = zonesById.get(id);
  assert(zone, `${id}: canonical biome zone missing`);
  const samples = [];
  for (let y = -5; y <= 5; y += 1) {
    for (let x = -5; x <= 5; x += 1) {
      const nx = zone.center[0] + zone.radius[0] * x / 12;
      const ny = zone.center[1] + zone.radius[1] * y / 12;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
      if (sampleReferenceInfluence(nx, ny, zone) < 0.25) continue;
      const dry = sampleReferenceDryLandWeight(nx, ny);
      if (dry < WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) continue;
      samples.push(sampleNormalizedReferenceMountainReliefMeters(nx, ny));
    }
  }
  assert(samples.length >= 8, `${id}: insufficient dry highland samples`);
  const p75 = percentile(samples, 0.75);
  assert(p75 >= 18, `${id}: map-supported highland is visually flat`);
  highlandEvidence[id] = { samples: samples.length, p75Meters: rounded(p75), maxMeters: rounded(Math.max(...samples)) };
}

// Broad map-supported plains must remain settlement-capable rather than receiving blanket mountain relief.
const plainZoneIds = ['reach', 'dothraki-sea', 'yi-ti', 'jogos-nhai'];
const plainEvidence = {};
for (const id of plainZoneIds) {
  const zone = zonesById.get(id);
  assert(zone, `${id}: canonical plain zone missing`);
  const samples = [];
  for (let y = -4; y <= 4; y += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const nx = zone.center[0] + zone.radius[0] * x / 10;
      const ny = zone.center[1] + zone.radius[1] * y / 10;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
      if (sampleReferenceInfluence(nx, ny, zone) < 0.35) continue;
      const dry = sampleReferenceDryLandWeight(nx, ny);
      if (dry < WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) continue;
      samples.push(sampleNormalizedReferenceMountainReliefMeters(nx, ny));
    }
  }
  assert(samples.length >= 6, `${id}: insufficient dry plain samples`);
  const p80 = percentile(samples, 0.8);
  assert(p80 <= 120, `${id}: broad plain was promoted into a mountain field (${p80.toFixed(2)}m p80)`);
  plainEvidence[id] = { samples: samples.length, p80Meters: rounded(p80), maxMeters: rounded(Math.max(...samples)) };
}

console.log('GEOGRAPHY_HABITABLE_BASINS_OK', JSON.stringify({
  policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
  seatsChecked: seatEvidence.length,
  highlands: highlandEvidence,
  plains: plainEvidence,
  seatEvidence,
}));
