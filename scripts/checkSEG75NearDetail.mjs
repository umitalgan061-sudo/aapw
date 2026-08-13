#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G75_NEAR_DETAIL_POLICY,
  buildG75NearDetailProbe,
  measureG75NearDetail,
} from '../godot/terrain-authoring/geocells/se/g75_near_detail.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SOURCE_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

function fail(message) {
  console.error(`[checkSEG75NearDetail] FAIL: ${message}`);
  process.exit(1);
}
function requireCondition(condition, message) {
  if (!condition) fail(message);
}

requireCondition(G75_NEAR_DETAIL_POLICY.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'canonical map SHA changed');
requireCondition(G75_NEAR_DETAIL_POLICY.layer === 'Near Detail', 'unexpected layer');
requireCondition(G75_NEAR_DETAIL_POLICY.sourceGridSize === 129, 'Near Detail proof must remain 129x129');
requireCondition(G75_NEAR_DETAIL_POLICY.terrain3dRegionSize === 256, 'Terrain3D region must remain 256');

const metrics = measureG75NearDetail();
requireCondition(metrics.canonicalWaterCells === 0 && metrics.canonicalLandCells === 96, 'G75 canonical 96-cell dry-land contract changed');
requireCondition(metrics.activeRoadSamples === 0 && metrics.activePathSamples === 0, 'Near Detail introduced phantom road/path coverage');
requireCondition(metrics.maxHeightDeltaMeters === 0, 'Near Detail modified merged Relief/Road height');
requireCondition(metrics.maxControlDelta === 0, 'Near Detail modified merged Rock/Snow/Road control weights');
requireCondition(metrics.minTint >= G75_NEAR_DETAIL_POLICY.tintFloor, `near-detail tint fell below floor: ${metrics.minTint}`);
requireCondition(metrics.maxTint <= G75_NEAR_DETAIL_POLICY.tintCeiling, `near-detail tint exceeded ceiling: ${metrics.maxTint}`);
requireCondition(metrics.maxTint - metrics.minTint >= 0.02, 'near-detail color field has insufficient deterministic variation');
requireCondition(metrics.minRoughness >= G75_NEAR_DETAIL_POLICY.roughnessFloor, `roughness fell below floor: ${metrics.minRoughness}`);
requireCondition(metrics.maxRoughness <= G75_NEAR_DETAIL_POLICY.roughnessCeiling, `roughness exceeded ceiling: ${metrics.maxRoughness}`);
requireCondition(metrics.maxRoughness - metrics.minRoughness >= 0.04, 'near-detail roughness field has insufficient variation');
requireCondition(metrics.maxAdjacentTintDelta <= 0.055, `near-detail tint adjacent step too large: ${metrics.maxAdjacentTintDelta}`);
requireCondition(metrics.maxAdjacentRoughnessDelta <= 0.11, `near-detail roughness adjacent step too large: ${metrics.maxAdjacentRoughnessDelta}`);
requireCondition(metrics.maxGuardBandTintDelta <= 0.006, `near-detail tint guard-band delta too large: ${metrics.maxGuardBandTintDelta}`);
requireCondition(metrics.maxGuardBandRoughnessDelta <= 0.012, `near-detail roughness guard-band delta too large: ${metrics.maxGuardBandRoughnessDelta}`);
requireCondition(metrics.sourceSamples === 129 * 129, 'expected deterministic 129x129 source field');

const source = fs.readFileSync(path.join(ROOT, 'godot/terrain-authoring/geocells/se/g75_near_detail.mjs'), 'utf8');
const signalBody = source.match(/export function g75NearDetailSignal\([\s\S]*?\n}\n/);
requireCondition(Boolean(signalBody), 'could not isolate near-detail signal function');
requireCondition(!/normalizedBounds|xMin|xMax|yMin|yMax|gx|gy/.test(signalBody[0]), 'GeoCell/grid terms leaked into near-detail signal');
requireCondition(/widthMeters/.test(signalBody[0]) || /physicalCoordinates/.test(signalBody[0]), 'near-detail signal is not anchored to full-reference physical coordinates');

const summary = {
  policyId: metrics.policyId,
  sourceMapSha256: metrics.sourceMapSha256,
  geoCell: metrics.geoCell,
  layer: metrics.layer,
  sourceSamples: metrics.sourceSamples,
  canonicalLandCells: metrics.canonicalLandCells,
  canonicalWaterCells: metrics.canonicalWaterCells,
  activeRoadSamples: metrics.activeRoadSamples,
  activePathSamples: metrics.activePathSamples,
  minTint: metrics.minTint,
  maxTint: metrics.maxTint,
  minRoughness: metrics.minRoughness,
  maxRoughness: metrics.maxRoughness,
  maxAdjacentTintDelta: metrics.maxAdjacentTintDelta,
  maxAdjacentRoughnessDelta: metrics.maxAdjacentRoughnessDelta,
  maxGuardBandTintDelta: metrics.maxGuardBandTintDelta,
  maxGuardBandRoughnessDelta: metrics.maxGuardBandRoughnessDelta,
  maxHeightDeltaMeters: metrics.maxHeightDeltaMeters,
  maxControlDelta: metrics.maxControlDelta,
  detailChecksum: metrics.detailChecksum,
};
console.log(`G75_NEAR_DETAIL_METRICS=${JSON.stringify(summary)}`);
console.log('SE_G75_NEAR_DETAIL_VALIDATION_OK');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const destination = emitArg.slice('--emit-probe='.length);
  const absolute = path.resolve(ROOT, destination);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(buildG75NearDetailProbe())}\n`, 'utf8');
}
