import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  G77_ROCK_SNOW_POLICY,
  buildG77RockSnowControlContract,
  buildG77RockSnowProbe,
  measureG77RockSnow,
  sampleG77FilteredReliefSlope,
  sampleG77RawReliefSlope,
  sampleG77RockSnow,
} from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const need = (condition, message) => {
  if (!condition) throw new Error(`[checkSEG77RockSnow] ${message}`);
};
const nearlyEqual = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

const metrics = measureG77RockSnow();
need(metrics.policyId === 'kizil-ufuk-g77-terrain3d-rock-snow-2026-08-14-v6', `unexpected policy ${metrics.policyId}`);
need(metrics.canonicalWaterCells === 44 && metrics.canonicalLandCells === 52, `G77 canonical hydrology drifted: ${metrics.canonicalWaterCells} water / ${metrics.canonicalLandCells} land`);
need(metrics.sourceSamples === 4225, `unexpected source sample count ${metrics.sourceSamples}`);
need(metrics.slopeFilterTaps === 9, `slope filter tap count drifted: ${metrics.slopeFilterTaps}`);
need(nearlyEqual(metrics.slopeFilterRadiusNormalized, 1 / 1024), `slope filter radius drifted: ${metrics.slopeFilterRadiusNormalized}`);
need(metrics.fractionalRockSamples >= 512, `G77 rock field collapsed to binary/block output: ${metrics.fractionalRockSamples}`);
need(metrics.shorelineSamples >= 128, `G77 shoreline transition lost dense source coverage: ${metrics.shorelineSamples}`);
need(metrics.deepLandSamples >= 512, `G77 deep-land material source coverage collapsed: ${metrics.deepLandSamples}`);
need(metrics.rockBlendSpan >= 0.01, `G77 rock field has insufficient physical variation: ${metrics.rockBlendSpan}`);
need(metrics.maxAdjacentRockStep <= 0.20, `adjacent G77 rock blend step too large: ${metrics.maxAdjacentRockStep}`);
need(metrics.maxAdjacentFilteredSlopeStep <= 0.15, `filtered G77 slope still aliases material classification: ${metrics.maxAdjacentFilteredSlopeStep}`);
need(metrics.maxAdjacentFilteredSlopeStep < metrics.maxAdjacentRawSlopeStep * 0.75, `slope footprint failed to reduce derivative aliasing: raw=${metrics.maxAdjacentRawSlopeStep} filtered=${metrics.maxAdjacentFilteredSlopeStep}`);
need(metrics.maxGuardBandRockDelta <= 0.20, `G77 guard-band rock seam too large: ${metrics.maxGuardBandRockDelta}`);
need(metrics.maxGuardBandSnowDelta <= 0.10, `G77 guard-band snow seam too large: ${metrics.maxGuardBandSnowDelta}`);
need(metrics.maxCanonicalWaterSurfaceLeak <= 0.000001, `G77 rock/snow leaked onto canonical water: ${metrics.maxCanonicalWaterSurfaceLeak}`);
need(metrics.maxSnowWeight <= 0.35, `G77 southeast snow became implausible: ${metrics.maxSnowWeight}`);
need(metrics.minMaterialWeight >= -G77_ROCK_SNOW_POLICY.weightEpsilon, `negative material weight detected: ${metrics.minMaterialWeight}`);
need(metrics.maxMaterialWeight <= 1 + G77_ROCK_SNOW_POLICY.weightEpsilon, `material weight exceeded one: ${metrics.maxMaterialWeight}`);
need(metrics.maxRawSlope > metrics.maxFilteredSlope, `slope filter no longer damps local spikes: raw=${metrics.maxRawSlope} filtered=${metrics.maxFilteredSlope}`);
need(metrics.maxSlopeFilterDelta > 0.01, `slope filter is not exercising the G77 relief field: ${metrics.maxSlopeFilterDelta}`);

const bounds = G77_ROCK_SNOW_POLICY.normalizedBounds;
const contractSamples = [
  [bounds.xMin, bounds.yMin],
  [(bounds.xMin + bounds.xMax) * 0.5, (bounds.yMin + bounds.yMax) * 0.5],
  [bounds.xMax, bounds.yMax],
  [0.955078125, 0.990234375],
  [0.955078125, 0.9912109375],
  [0.955078125, 0.9921875],
  [0.955078125, 0.9931640625],
];
let controlChecksum = 2166136261;
let filteredSlopeImprovementSamples = 0;
for (const [nx, ny] of contractSamples) {
  const surface = sampleG77RockSnow(nx, ny);
  const control = buildG77RockSnowControlContract(surface);
  const rawSlope = sampleG77RawReliefSlope(nx, ny);
  const filteredSlope = sampleG77FilteredReliefSlope(nx, ny);
  need(Object.isFrozen(surface), 'surface sample must remain immutable');
  need(Object.isFrozen(control), 'control contract must remain immutable');
  need(Number.isFinite(surface.height), `non-finite height at ${nx},${ny}`);
  need(Number.isFinite(rawSlope) && Number.isFinite(filteredSlope), `non-finite slope at ${nx},${ny}`);
  need(nearlyEqual(surface.rawSlope, rawSlope), `raw slope contract drift at ${nx},${ny}`);
  need(nearlyEqual(surface.slope, filteredSlope), `filtered slope contract drift at ${nx},${ny}`);
  need(surface.rockWeight >= 0 && surface.rockWeight <= 1, `rock weight outside [0,1] at ${nx},${ny}`);
  need(surface.snowWeight >= 0 && surface.snowWeight <= 1, `snow weight outside [0,1] at ${nx},${ny}`);
  need(surface.groundWeight >= 0 && surface.groundWeight <= 1, `ground weight outside [0,1] at ${nx},${ny}`);
  need(control.baseTextureId === G77_ROCK_SNOW_POLICY.groundTextureId, 'ground texture ID changed');
  need([G77_ROCK_SNOW_POLICY.rockTextureId, G77_ROCK_SNOW_POLICY.snowTextureId].includes(control.overlayTextureId), 'overlay texture ID outside Rock/Snow contract');
  need(control.overlayBlend >= 0 && control.overlayBlend <= 1, `overlay blend outside [0,1] at ${nx},${ny}`);
  need(control.overlayBlend8 >= 0 && control.overlayBlend8 <= 255, `8-bit overlay blend outside [0,255] at ${nx},${ny}`);
  need(control.overlayBlend8 === Math.round(control.overlayBlend * 255), '8-bit overlay quantization drifted');
  if (Math.abs(filteredSlope - rawSlope) > 0.001) filteredSlopeImprovementSamples += 1;
  controlChecksum = Math.imul((controlChecksum ^ control.overlayBlend8) >>> 0, 16777619) >>> 0;
  controlChecksum = Math.imul((controlChecksum ^ control.overlayTextureId) >>> 0, 16777619) >>> 0;
}
need(filteredSlopeImprovementSamples >= 2, `representative probes did not exercise slope filtering: ${filteredSlopeImprovementSamples}`);

for (const [x, y] of [[Number.NaN, 0.9], [0.9, Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY, 0.9]]) {
  let rejected = false;
  try { sampleG77RockSnow(x, y); } catch (error) { rejected = error instanceof TypeError; }
  need(rejected, `invalid normalized coordinate was accepted: ${x},${y}`);
}
let badContractRejected = false;
try { buildG77RockSnowControlContract(null); } catch (error) { badContractRejected = error instanceof TypeError; }
need(badContractRejected, 'invalid control-contract input was accepted');

const probeA = buildG77RockSnowProbe();
const probeB = buildG77RockSnowProbe();
const probeJsonA = JSON.stringify(probeA);
const probeJsonB = JSON.stringify(probeB);
need(probeJsonA === probeJsonB, 'source probe serialization is not deterministic');
need(probeA.schema === 'westeros-g77-terrain3d-rock-snow-v6', `unexpected probe schema ${probeA.schema}`);
need(probeA.policyId === metrics.policyId, 'probe and metric policy IDs disagree');
need(probeA.sourceGridSize === 65, `probe source grid changed: ${probeA.sourceGridSize}`);
need(probeA.terrain3dRegionSize === 256 && probeA.terrain3dImportSize === 257, 'Terrain3D region/import geometry drifted');
need(probeA.rowSchema.length === 12, `probe row schema drifted: ${probeA.rowSchema.length}`);
need(probeA.rows.length === 65 && probeA.rows.every((row) => row.length === 65), 'probe rows are not 65x65');
need(probeA.sourceMapSha256 === G77_ROCK_SNOW_POLICY.sourceMapSha256, 'probe map.png provenance drifted');
need(probeA.geoCell === G77_ROCK_SNOW_POLICY.geoCell, `probe GeoCell drifted: ${probeA.geoCell}`);
need(probeA.layer === G77_ROCK_SNOW_POLICY.layer, `probe layer drifted: ${probeA.layer}`);
need(probeA.groundTextureId === G77_ROCK_SNOW_POLICY.groundTextureId, 'probe ground texture ID drifted');
need(probeA.rockTextureId === G77_ROCK_SNOW_POLICY.rockTextureId, 'probe rock texture ID drifted');
need(probeA.snowTextureId === G77_ROCK_SNOW_POLICY.snowTextureId, 'probe snow texture ID drifted');
need(probeA.slopeFilterTaps === G77_ROCK_SNOW_POLICY.slopeFilterTaps, 'probe slope filter tap count drifted');
need(nearlyEqual(probeA.slopeFilterRadiusNormalized, G77_ROCK_SNOW_POLICY.slopeFilterRadiusNormalized), 'probe slope filter radius drifted');
need(Object.isFrozen(probeA.rowSchema), 'probe row schema must remain immutable');

let probeFiniteValues = 0;
let probeWaterLeakRows = 0;
let probeQuantizedBlendMismatch = 0;
for (const row of probeA.rows) {
  for (const cell of row) {
    need(cell.length === probeA.rowSchema.length, `probe cell width drifted: ${cell.length}`);
    need(cell.every(Number.isFinite), 'probe cell contains a non-finite value');
    probeFiniteValues += cell.length;
    const rock = cell[1];
    const snow = cell[2];
    const water = cell[6];
    const overlayTextureId = cell[10];
    const overlayBlend8 = cell[11];
    if (water >= 0.5 && rock + snow > 0.000001) probeWaterLeakRows += 1;
    const expectedOverlay = snow > rock ? G77_ROCK_SNOW_POLICY.snowTextureId : G77_ROCK_SNOW_POLICY.rockTextureId;
    const expectedBlend8 = Math.round(Math.max(rock, snow) * 255);
    if (overlayTextureId !== expectedOverlay || Math.abs(overlayBlend8 - expectedBlend8) > 1) probeQuantizedBlendMismatch += 1;
  }
}
need(probeFiniteValues === 65 * 65 * 12, `unexpected finite probe value count ${probeFiniteValues}`);
need(probeWaterLeakRows === 0, `probe contains canonical-water Rock/Snow leakage: ${probeWaterLeakRows}`);
need(probeQuantizedBlendMismatch === 0, `probe control quantization mismatches: ${probeQuantizedBlendMismatch}`);

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const output = emitArg.slice('--emit-probe='.length);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${probeJsonA}\n`);
}

const diagnostics = Object.freeze({
  ...metrics,
  controlContractSamples: contractSamples.length,
  controlChecksum,
  filteredSlopeImprovementSamples,
  probeFiniteValues,
  probeWaterLeakRows,
  probeQuantizedBlendMismatch,
  probeSha256: hash(probeJsonA),
});
console.log(`SE_G77_ROCK_SNOW_METRICS=${JSON.stringify(diagnostics)}`);
console.log('SE_G77_ROCK_SNOW_VALIDATION_OK');
