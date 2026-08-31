#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  VALYRIA_GEOLOGY_POLICY,
  valyriaCanonicalDryGate01,
  valyriaInfluence01,
  valyriaMorphologySignals,
  valyriaSurfaceWeights,
  valyriaUpliftMeters,
} from '../src/3d/world/valyriaGeology.js';

const P = VALYRIA_GEOLOGY_POLICY;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const stddev = (values) => {
  if (!values.length) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
};

assert(P.id.includes('v4-natural-volcanic-morphology'));
assert.equal(P.canonicalCoastlinePreserved, true);
assert.equal(P.canonicalWaterClassificationPreserved, true);
assert.equal(P.deterministic, true);
assert(P.faultScarpAcrossFrequency > P.faultScarpAlongFrequency * 2.5);

const GRID = 120;
const minNx = 0.36;
const maxNx = 0.54;
const minNy = 0.62;
const maxNy = 0.82;
let sampled = 0;
let faultActive = 0;
let lavaActive = 0;
let gullyActive = 0;
let shoulderActive = 0;
let positiveFault = 0;
let negativeFault = 0;
let calderaActive = 0;
let checksumA = 0;
let checksumB = 0;
const uplifts = [];
const drainageHighLava = [];
const drainageLowLava = [];
const rowCoverage = new Array(GRID).fill(0);
const columnCoverage = new Array(GRID).fill(0);

function accumulateChecksum(current, value, ix, iy) {
  const quantized = Math.round(value * 1000);
  return (current + quantized * (ix + 3) * (iy + 7)) % 1_000_000_007;
}

for (let iy = 0; iy < GRID; iy += 1) {
  const ny = minNy + ((iy + 0.5) / GRID) * (maxNy - minNy);
  for (let ix = 0; ix < GRID; ix += 1) {
    const nx = minNx + ((ix + 0.5) / GRID) * (maxNx - minNx);
    const influence = valyriaInfluence01(nx, ny);
    if (influence < 0.08) continue;
    sampled += 1;
    rowCoverage[iy] += 1;
    columnCoverage[ix] += 1;

    const morphology = valyriaMorphologySignals(nx, ny);
    if (morphology.faultActivity > 0.5) faultActive += 1;
    if (morphology.lavaDrainage > 0.5) lavaActive += 1;
    if (morphology.erosionGully > 0.5) gullyActive += 1;
    if (morphology.brokenCalderaShoulder > 0.5) shoulderActive += 1;
    if (morphology.calderaBasin > 0.5) calderaActive += 1;
    if (morphology.faultEscarpment > 0.4) positiveFault += 1;
    if (morphology.faultEscarpment < -0.4) negativeFault += 1;

    const uplift = valyriaUpliftMeters(nx, ny, 100, 0);
    uplifts.push(uplift);
    checksumA = accumulateChecksum(checksumA, uplift, ix, iy);
    checksumB = accumulateChecksum(checksumB, valyriaUpliftMeters(nx, ny, 100, 0), ix, iy);

    const surface = valyriaSurfaceWeights({
      nx,
      ny,
      heightAboveSeaMeters: 150,
      concavityMeters: 0.6,
      slopeDegrees: 12,
    });
    if (morphology.lavaDrainage > 0.65) drainageHighLava.push(surface.lava);
    if (morphology.lavaDrainage < 0.10) drainageLowLava.push(surface.lava);
  }
}

assert(sampled > 8000, `insufficient Valyria morphology coverage: ${sampled}`);
assert.equal(checksumA, checksumB, 'Valyria morphology/uplift lost deterministic checksum parity');
const fractions = {
  fault: faultActive / sampled,
  lava: lavaActive / sampled,
  gully: gullyActive / sampled,
  shoulder: shoulderActive / sampled,
  caldera: calderaActive / sampled,
  positiveFault: positiveFault / sampled,
  negativeFault: negativeFault / sampled,
};

// Natural volcanic structure should be present but not carpet the whole province. Wide ranges are
// intentional: these are morphology invariants, not aesthetic overfitting to one exact sample count.
assert(fractions.fault > 0.20 && fractions.fault < 0.70, `fault coverage implausible: ${fractions.fault}`);
assert(fractions.lava > 0.08 && fractions.lava < 0.42, `lava drainage coverage implausible: ${fractions.lava}`);
assert(fractions.gully > 0.05 && fractions.gully < 0.38, `erosion gully coverage implausible: ${fractions.gully}`);
assert(fractions.shoulder > 0.12 && fractions.shoulder < 0.62, `caldera shoulder coverage implausible: ${fractions.shoulder}`);
assert(fractions.caldera > 0.02 && fractions.caldera < 0.50, `caldera basin coverage implausible: ${fractions.caldera}`);
assert(fractions.positiveFault > 0.08 && fractions.negativeFault > 0.08, 'fault field lost two-sided scarps');

// Faults must remain elongated along strike. Compare the same fault activity field after a tiny move
// along strike versus the same metric across strike; across-strike change should be much stronger.
const c = Math.cos(P.faultStrikeRadians);
const s = Math.sin(P.faultStrikeRadians);
const alongDeltas = [];
const acrossDeltas = [];
for (let iy = 10; iy < 70; iy += 2) {
  for (let ix = 10; ix < 70; ix += 2) {
    const nx = 0.39 + (ix / 80) * 0.11;
    const ny = 0.665 + (iy / 80) * 0.12;
    if (valyriaInfluence01(nx, ny) < 0.25) continue;
    const base = valyriaMorphologySignals(nx, ny).faultActivity;
    const step = 0.035;
    const along = valyriaMorphologySignals(
      nx + c * P.coreRadius.nx * step,
      ny + s * P.coreRadius.ny * step,
    ).faultActivity;
    const across = valyriaMorphologySignals(
      nx - s * P.coreRadius.nx * step,
      ny + c * P.coreRadius.ny * step,
    ).faultActivity;
    alongDeltas.push(Math.abs(along - base));
    acrossDeltas.push(Math.abs(across - base));
  }
}
const alongDelta = mean(alongDeltas);
const acrossDelta = mean(acrossDeltas);
const anisotropyRatio = acrossDelta / Math.max(1e-9, alongDelta);
assert(anisotropyRatio > 1.7, `faults became isotropic blobs: ratio=${anisotropyRatio}`);

// Lava shading should follow the shared drainage field rather than appearing everywhere concave.
assert(drainageHighLava.length > 300 && drainageLowLava.length > 1000);
const highDrainageLavaMean = mean(drainageHighLava);
const lowDrainageLavaMean = mean(drainageLowLava);
assert(highDrainageLavaMean > lowDrainageLavaMean + 0.30, `lava surface detached from drainage: ${highDrainageLavaMean} vs ${lowDrainageLavaMean}`);

// Equal-radius rings must retain large angular variation at several scales. This explicitly rejects
// the artificial volcano-cone / perfect-caldera failure mode.
const ringStats = [];
for (const normalizedRadius of [0.30, 0.55, 0.80]) {
  const ring = [];
  for (let i = 0; i < 96; i += 1) {
    const angle = (i / 96) * Math.PI * 2;
    ring.push(valyriaUpliftMeters(
      P.coreCenter.nx + Math.cos(angle) * P.coreRadius.nx * normalizedRadius,
      P.coreCenter.ny + Math.sin(angle) * P.coreRadius.ny * normalizedRadius,
      120,
      0,
    ));
  }
  const m = mean(ring);
  const sd = stddev(ring);
  const range = Math.max(...ring) - Math.min(...ring);
  const cv = sd / Math.max(1e-9, m);
  ringStats.push({ normalizedRadius, mean: m, sd, range, cv });
  assert(range > 45, `radial morphology too uniform at r=${normalizedRadius}: ${range}`);
  assert(cv > 0.055, `radial morphology variation too low at r=${normalizedRadius}: ${cv}`);
}

// Water/coast invariants are exact and independent of morphology complexity.
for (const height of [-20, -1, 0]) {
  assert.equal(valyriaCanonicalDryGate01(0, height), 0);
  assert.equal(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, height, 0), 0);
}
for (const waterWeight of [P.canonicalDryWaterWeightZeroAtOrAbove, 0.25, 0.5, 1]) {
  assert.equal(valyriaCanonicalDryGate01(waterWeight, 200), 0);
  assert.equal(valyriaUpliftMeters(P.coreCenter.nx, P.coreCenter.ny, 200, waterWeight), 0);
}

// Coverage should follow an organic region rather than every row/column receiving the same count.
const nonZeroRows = rowCoverage.filter(Boolean);
const nonZeroColumns = columnCoverage.filter(Boolean);
assert(nonZeroRows.length > 40 && nonZeroColumns.length > 40);
assert(Math.max(...nonZeroRows) - Math.min(...nonZeroRows) > GRID * 0.20, 'Valyria region coverage looks like a rectangular mask');
assert(Math.max(...nonZeroColumns) - Math.min(...nonZeroColumns) > GRID * 0.20, 'Valyria region coverage looks like a vertical stripe');

console.log('[checkValyriaVolcanicMorphology] PASS');
console.log(JSON.stringify({
  policyId: P.id,
  sampled,
  checksum: checksumA,
  fractions,
  uplift: {
    min: Math.min(...uplifts),
    max: Math.max(...uplifts),
    mean: mean(uplifts),
    sd: stddev(uplifts),
  },
  faultAnisotropy: {
    alongMeanAbsoluteDelta: alongDelta,
    acrossMeanAbsoluteDelta: acrossDelta,
    ratio: anisotropyRatio,
    samples: alongDeltas.length,
  },
  lavaDrainageCorrelation: {
    highDrainageCount: drainageHighLava.length,
    lowDrainageCount: drainageLowLava.length,
    highDrainageLavaMean,
    lowDrainageLavaMean,
  },
  ringStats,
}, null, 2));
