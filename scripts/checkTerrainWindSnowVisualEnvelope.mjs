#!/usr/bin/env node
import assert from 'node:assert/strict';
import { terrainWindExposureFromNeighbours } from '../src/3d/world/terrainWindSnowExposure.js';
import { resolveTerrainWindSnowSurfaceFabric } from '../src/3d/world/terrainWindSnowSurfaceFabric.js';

const fixtures = [
  { id: 'plain', heights: [100,100,100,100], step: 20 },
  { id: 'broad-ridge', heights: [92,108,100,100], step: 20 },
  { id: 'broken-ridge', heights: [82,118,96,104], step: 20 },
  { id: 'valley', heights: [104,96,90,110], step: 20 },
  { id: 'lee-bowl', heights: [106,94,94,106], step: 20 },
  { id: 'steep-windward', heights: [70,130,100,100], step: 20 },
  { id: 'steep-lee', heights: [130,70,100,100], step: 20 },
];

const snapshots = fixtures.map((fixture) => {
  const exposure = terrainWindExposureFromNeighbours(...fixture.heights, fixture.step);
  const fabric = resolveTerrainWindSnowSurfaceFabric({
    slopeDegrees: exposure.slopeDegrees,
    aspectDot: exposure.aspectDot,
    foldGradient: exposure.foldGradient,
    foldStrength: exposure.orographicFoldStrength,
    leeRetention: exposure.leeRetention,
  });
  return {
    id: fixture.id,
    slope: exposure.slopeDegrees,
    aspect: exposure.aspectDot,
    fold: exposure.foldGradient,
    windward: exposure.windward,
    lee: exposure.lee,
    ridgeCrust: fabric.ridgeCrust,
    leePowder: fabric.leePowder,
    continuity: fabric.continuity,
    windwardGain: fabric.windwardGain,
    leeGain: fabric.leeGain,
  };
});

for (const snapshot of snapshots) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== 'id') assert(Number.isFinite(value), `${snapshot.id}.${key} is non-finite`);
  }
  assert(snapshot.slope >= 0);
  assert(snapshot.aspect >= -1 && snapshot.aspect <= 1);
  assert(snapshot.windward >= 0 && snapshot.windward <= 1);
  assert(snapshot.lee >= 0 && snapshot.lee <= 1);
  assert(snapshot.continuity >= 0 && snapshot.continuity <= 1);
  assert(snapshot.windwardGain >= 0.86 && snapshot.windwardGain <= 1.14);
  assert(snapshot.leeGain >= 0.86 && snapshot.leeGain <= 1.14);
}

const plain = snapshots.find((s) => s.id === 'plain');
const windward = snapshots.find((s) => s.id === 'broad-ridge');
const broken = snapshots.find((s) => s.id === 'broken-ridge');
const bowl = snapshots.find((s) => s.id === 'lee-bowl');
const steepLee = snapshots.find((s) => s.id === 'steep-lee');
assert.equal(plain.windward, 0);
assert.equal(plain.lee, 0);
assert(windward.windward > windward.lee);
assert(broken.fold > windward.fold);
assert(broken.continuity >= windward.continuity - 0.2);
assert(bowl.lee > bowl.windward);
assert(steepLee.lee <= bowl.lee, 'near-cliff lee accumulation must not exceed moderate sheltered relief');
assert(windward.ridgeCrust > bowl.ridgeCrust);
assert(bowl.leePowder > windward.leePowder);

// The same local surface family translated in world-space must keep identical directional output.
const translatedA = terrainWindExposureFromNeighbours(84,116,96,104,16);
const translatedB = terrainWindExposureFromNeighbours(584,616,596,604,16);
assert(Math.abs(translatedA.slopeDegrees - translatedB.slopeDegrees) < 1e-9);
assert(Math.abs(translatedA.aspectDot - translatedB.aspectDot) < 1e-9);
assert(Math.abs(translatedA.windward - translatedB.windward) < 1e-9);
assert(Math.abs(translatedA.lee - translatedB.lee) < 1e-9);
assert.equal(
  resolveTerrainWindSnowSurfaceFabric(translatedA).ridgeCrust.toFixed(8),
  resolveTerrainWindSnowSurfaceFabric(translatedB).ridgeCrust.toFixed(8),
);

console.log('[checkTerrainWindSnowVisualEnvelope] PASS', JSON.stringify({ snapshots, seamTranslationParity: true }));
