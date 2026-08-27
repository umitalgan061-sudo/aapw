#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  VALYRIA_GEOLOGY_POLICY,
  applyValyriaSurfaceColor,
  isValyriaBarrenAtWorldXZ,
  normalizedOwnerMapAtWorldXZ,
  valyriaCanonicalDryGate01,
  valyriaGeologyClassAtWorldXZ,
  valyriaInfluence01,
  valyriaInfluenceAtWorldXZ,
  valyriaSurfaceWeights,
  valyriaUpliftMeters,
} from '../src/3d/world/valyriaGeology.js';

const P = VALYRIA_GEOLOGY_POLICY;
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.canonicalCoastlinePreserved, true);
assert.equal(P.canonicalWaterClassificationPreserved, true);
assert.equal(P.deterministic, true);
assert(P.id.includes('v3-canonical-dry-authority'));
assert(P.upliftMeters > 150 && P.upliftMeters < 300);
assert(P.canonicalDryWaterWeightFullAtOrBelow < P.canonicalDryWaterWeightZeroAtOrAbove);
assert(valyriaInfluence01(P.coreCenter.nx, P.coreCenter.ny) > 0.999);
assert(valyriaInfluence01(P.neckCenter.nx, P.neckCenter.ny) > 0.999);
assert.equal(valyriaInfluence01(0.15, 0.20), 0);
assert.equal(valyriaInfluence01(0.80, 0.80), 0);

for (const height of [-30, -1, 0]) assert.equal(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, height), 0, 'wet uplift must be exact zero');
const shoreOne = valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 1);
const shoreTen = valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 10);
const inland = valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 80);
assert(shoreOne < shoreTen && shoreTen < inland, 'shore ramp failed');

// Source-water gating is independent from numeric height: a wet Pindex must remain exact zero even if
// some other relief term left the sample above sea level.
assert(valyriaCanonicalDryGate01(0, 100) > 0.999);
assert.equal(valyriaCanonicalDryGate01(P.canonicalDryWaterWeightZeroAtOrAbove, 100), 0);
assert.equal(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 100, 1), 0);
assert.equal(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 100, P.canonicalDryWaterWeightZeroAtOrAbove), 0);
const mixedWater = (P.canonicalDryWaterWeightFullAtOrBelow + P.canonicalDryWaterWeightZeroAtOrAbove) * 0.5;
const mixedGate = valyriaCanonicalDryGate01(mixedWater, 100);
assert(mixedGate > 0 && mixedGate < 1);
assert(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 100, mixedWater) < valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 100, 0));

const uplifts = [];
for (let iy = 0; iy <= 40; iy += 1) {
  const ny = 0.63 + iy / 40 * 0.18;
  for (let ix = 0; ix <= 40; ix += 1) {
    const nx = 0.37 + ix / 40 * 0.16;
    if (valyriaInfluence01(nx, ny) <= 0) continue;
    uplifts.push(valyriaUpliftMeters(nx, ny, 90));
  }
}
assert(uplifts.length > 180);
const maxUplift = Math.max(...uplifts);
assert(maxUplift > 110 && maxUplift < P.upliftMeters + P.faultAmplitudeMeters + 1e-9);

// Equal-radius samples must differ strongly. This rejects the artificial volcano-cone failure mode.
const ring = [];
for (let i = 0; i < 32; i += 1) {
  const angle = i / 32 * Math.PI * 2;
  ring.push(valyriaUpliftMeters(
    P.coreCenter.nx + Math.cos(angle) * P.coreRadius.nx * 0.58,
    P.coreCenter.ny + Math.sin(angle) * P.coreRadius.ny * 0.58,
    100,
  ));
}
const ringRange = Math.max(...ring) - Math.min(...ring);
assert(ringRange > 18, `Valyria is too radially symmetric: ${ringRange}`);

const base = { r: 0.23, g: 0.42, b: 0.19 };
const basalt = { ...base };
applyValyriaSurfaceColor(basalt, { nx: P.coreCenter.nx, ny: P.coreCenter.ny, heightAboveSeaMeters: 150, concavityMeters: 0, slopeDegrees: 24 });
assert(basalt.g < base.g * 0.55, `Valyria remained meadow-green: ${JSON.stringify(basalt)}`);

const pool = valyriaSurfaceWeights({ nx: P.coreCenter.nx, ny: P.coreCenter.ny, heightAboveSeaMeters: 130, concavityMeters: 2.2, slopeDegrees: 8 });
assert(pool.lava > 0.75);
const ridge = valyriaSurfaceWeights({ nx: P.coreCenter.nx, ny: P.coreCenter.ny, heightAboveSeaMeters: 260, concavityMeters: -0.4, slopeDegrees: 38 });
assert(ridge.lava < 0.05 && ridge.ash > 0.5);

const worldX = (P.coreCenter.nx * 9000 - 4500) * 1.477342100713197;
const worldZ = (P.coreCenter.ny * 7000 - 3500) * 1.477342100713197;
const normalized = normalizedOwnerMapAtWorldXZ(worldX, worldZ);
assert(Math.abs(normalized.nx - P.coreCenter.nx) < 1e-10);
assert(Math.abs(normalized.ny - P.coreCenter.ny) < 1e-10);
assert(valyriaInfluenceAtWorldXZ(worldX, worldZ) > 0.999);
assert.equal(isValyriaBarrenAtWorldXZ(worldX, worldZ), true);
assert.equal(valyriaGeologyClassAtWorldXZ(worldX, worldZ, { heightAboveSeaMeters: 140, slopeDegrees: 35 }), 'fractured-volcanic-scarp');
assert.equal(valyriaGeologyClassAtWorldXZ(worldX, worldZ, { heightAboveSeaMeters: -2, slopeDegrees: 0 }), 'smoking-sea');

console.log('[checkValyriaGeology] PASS');
console.log(JSON.stringify({
  policyId: P.id,
  sampledPoints: uplifts.length,
  maxUpliftMeters: Number(maxUplift.toFixed(3)),
  equalRadiusRingRangeMeters: Number(ringRange.toFixed(3)),
  shoreRamp: [shoreOne, shoreTen, inland],
  mixedWaterGate: mixedGate,
  basaltColor: basalt,
}, null, 2));
