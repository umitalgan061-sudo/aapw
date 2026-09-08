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
  valyriaMorphologySignals,
  valyriaSurfaceWeights,
  valyriaUpliftMeters,
} from '../src/3d/world/valyriaGeology.js';

const P = VALYRIA_GEOLOGY_POLICY;
assert.equal(P.geographyAuthorityUnchanged, true);
assert.equal(P.canonicalCoastlinePreserved, true);
assert.equal(P.canonicalWaterClassificationPreserved, true);
assert.equal(P.deterministic, true);
assert(P.id.includes('v4-natural-volcanic-morphology'));
assert(P.upliftMeters > 150 && P.upliftMeters < 300);
assert(P.canonicalDryWaterWeightFullAtOrBelow < P.canonicalDryWaterWeightZeroAtOrAbove);
assert(P.faultScarpAcrossFrequency > P.faultScarpAlongFrequency * 2, 'faults lost anisotropy');
assert(P.lavaDrainageIncisionMeters > 0 && P.erosionGullyCutMeters > 0);
assert(valyriaInfluence01(P.coreCenter.nx, P.coreCenter.ny) > 0.999);
assert(valyriaInfluence01(P.neckCenter.nx, P.neckCenter.ny) > 0.999);
assert.equal(valyriaInfluence01(0.15, 0.20), 0);
assert.equal(valyriaInfluence01(0.80, 0.80), 0);

for (const height of [-30, -1, 0]) {
  assert.equal(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, height), 0, 'wet uplift must be exact zero');
}
const shoreOne = valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 1);
const shoreTen = valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 10);
const inland = valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 80);
assert(shoreOne < shoreTen && shoreTen < inland, 'shore ramp failed');

assert(valyriaCanonicalDryGate01(0, 100) > 0.999);
assert.equal(valyriaCanonicalDryGate01(P.canonicalDryWaterWeightZeroAtOrAbove, 100), 0);
assert.equal(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 100, 1), 0);
assert.equal(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 100, P.canonicalDryWaterWeightZeroAtOrAbove), 0);
const mixedWater = (P.canonicalDryWaterWeightFullAtOrBelow + P.canonicalDryWaterWeightZeroAtOrAbove) * 0.5;
const mixedGate = valyriaCanonicalDryGate01(mixedWater, 100);
assert(mixedGate > 0 && mixedGate < 1);
assert(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 100, mixedWater) < valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 100, 0));

const uplifts = [];
const morphologyMax = {
  calderaBasin: 0,
  brokenCalderaShoulder: 0,
  faultActivity: 0,
  lavaDrainage: 0,
  erosionGully: 0,
};
let positiveFaultSamples = 0;
let negativeFaultSamples = 0;
for (let iy = 0; iy <= 80; iy += 1) {
  const ny = 0.63 + iy / 80 * 0.18;
  for (let ix = 0; ix <= 80; ix += 1) {
    const nx = 0.37 + ix / 80 * 0.16;
    if (valyriaInfluence01(nx, ny) <= 0) continue;
    uplifts.push(valyriaUpliftMeters(nx, ny, 90));
    const morphology = valyriaMorphologySignals(nx, ny);
    for (const key of Object.keys(morphologyMax)) morphologyMax[key] = Math.max(morphologyMax[key], morphology[key]);
    if (morphology.faultEscarpment > 0.55) positiveFaultSamples += 1;
    if (morphology.faultEscarpment < -0.55) negativeFaultSamples += 1;
  }
}
assert(uplifts.length > 700);
const maxUplift = Math.max(...uplifts);
const positiveEnvelope = P.upliftMeters + P.brokenCalderaShoulderMeters + P.faultAmplitudeMeters + P.faultScarpMeters;
assert(maxUplift > 120 && maxUplift <= positiveEnvelope + 1e-9, `uplift escaped bounded positive envelope: ${maxUplift} > ${positiveEnvelope}`);
assert(morphologyMax.calderaBasin > 0.75, 'caldera basin field never activates');
assert(morphologyMax.brokenCalderaShoulder > 0.65, 'broken caldera shoulders never activate');
assert(morphologyMax.faultActivity > 0.75, 'fault activity never activates');
assert(morphologyMax.lavaDrainage > 0.80, 'lava drainage network never activates');
assert(morphologyMax.erosionGully > 0.80, 'erosion gullies never activate');
assert(positiveFaultSamples > 10 && negativeFaultSamples > 10, 'fault escarpments became one-sided or absent');

const ring = [];
for (let i = 0; i < 64; i += 1) {
  const angle = i / 64 * Math.PI * 2;
  ring.push(valyriaUpliftMeters(
    P.coreCenter.nx + Math.cos(angle) * P.coreRadius.nx * 0.58,
    P.coreCenter.ny + Math.sin(angle) * P.coreRadius.ny * 0.58,
    100,
  ));
}
const ringRange = Math.max(...ring) - Math.min(...ring);
assert(ringRange > 35, `Valyria is too radially symmetric: ${ringRange}`);

const base = { r: 0.23, g: 0.42, b: 0.19 };
const basalt = { ...base };
applyValyriaSurfaceColor(basalt, { nx: P.coreCenter.nx, ny: P.coreCenter.ny, heightAboveSeaMeters: 150, concavityMeters: 0, slopeDegrees: 24 });
assert(basalt.g < base.g * 0.55, `Valyria remained meadow-green: ${JSON.stringify(basalt)}`);

const pool = valyriaSurfaceWeights({ nx: P.coreCenter.nx, ny: P.coreCenter.ny, heightAboveSeaMeters: 130, concavityMeters: 2.2, slopeDegrees: 8 });
assert(pool.lava > 0.75, `core lava corridor/pool signal too weak: ${pool.lava}`);
assert(pool.drainage > 0.45, `core drainage signal missing: ${pool.drainage}`);
const ridge = valyriaSurfaceWeights({ nx: P.coreCenter.nx, ny: P.coreCenter.ny, heightAboveSeaMeters: 260, concavityMeters: -0.4, slopeDegrees: 38 });
// The v4 morphology intentionally permits cooled drainage traces across an ash-dominant ridge;
// the invariant is mineral dominance and cooling, not an artificial absence of all lava signal.
assert(ridge.ash > 0.5 && ridge.ash > ridge.lava, 'ridge must remain ash-dominant');
assert(ridge.cooledLava > 0.18 && ridge.drainage > 0.5, 'ridge drainage must read as cooled, terrain-following volcanic fabric');

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
  positiveEnvelopeMeters: positiveEnvelope,
  equalRadiusRingRangeMeters: Number(ringRange.toFixed(3)),
  morphologyMax,
  positiveFaultSamples,
  negativeFaultSamples,
  shoreRamp: [shoreOne, shoreTen, inland],
  mixedWaterGate: mixedGate,
  basaltColor: basalt,
  centerSurface: pool,
}, null, 2));
