#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G65_NEAR_DETAIL_POLICY,
  buildG65NearDetailProbe,
  measureG65NearDetail,
} from '../godot/terrain-authoring/geocells/se/g65_near_detail.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SOURCE_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

function fail(message) {
  console.error(`[checkSEG65NearDetail] FAIL: ${message}`);
  process.exit(1);
}
function requireCondition(condition, message) {
  if (!condition) fail(message);
}

requireCondition(G65_NEAR_DETAIL_POLICY.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'canonical map SHA changed');
requireCondition(G65_NEAR_DETAIL_POLICY.layer === 'Near Detail', 'unexpected layer');
requireCondition(G65_NEAR_DETAIL_POLICY.sourceGridSize === 129, 'Near Detail proof must remain 129x129');
requireCondition(G65_NEAR_DETAIL_POLICY.terrain3dRegionSize === 256, 'Terrain3D region must remain 256');
requireCondition(G65_NEAR_DETAIL_POLICY.terrain3dImportSize === 257, 'G65 Near Detail must preserve four-region 257 import');

const first = measureG65NearDetail();
const second = measureG65NearDetail();
requireCondition(JSON.stringify(first) === JSON.stringify(second), 'G65 Near Detail metrics are not deterministic');
requireCondition(first.canonicalWaterCells === 0 && first.canonicalLandCells === 96, `G65 canonical dry-land contract changed: ${first.canonicalWaterCells} water / ${first.canonicalLandCells} land`);
requireCondition(first.activeRoadSamples === 0 && first.activePathSamples === 0, 'Near Detail introduced phantom road/path coverage');
requireCondition(first.maxSnowWeight === 0, `Near Detail regressed warm G65 zero-snow contract: ${first.maxSnowWeight}`);
requireCondition(first.maxHeightDeltaMeters === 0, 'Near Detail modified merged Relief/Road height');
requireCondition(first.maxControlDelta === 0, 'Near Detail modified merged Rock/Snow/Road control weights');
requireCondition(first.minTint >= G65_NEAR_DETAIL_POLICY.tintFloor, `near-detail tint fell below floor: ${first.minTint}`);
requireCondition(first.maxTint <= G65_NEAR_DETAIL_POLICY.tintCeiling, `near-detail tint exceeded ceiling: ${first.maxTint}`);
requireCondition(first.maxTint - first.minTint >= 0.025, `near-detail color field has insufficient deterministic variation: ${first.maxTint - first.minTint}`);
requireCondition(first.minRoughness >= G65_NEAR_DETAIL_POLICY.roughnessFloor, `roughness fell below floor: ${first.minRoughness}`);
requireCondition(first.maxRoughness <= G65_NEAR_DETAIL_POLICY.roughnessCeiling, `roughness exceeded ceiling: ${first.maxRoughness}`);
requireCondition(first.maxRoughness - first.minRoughness >= 0.055, `near-detail roughness field has insufficient variation: ${first.maxRoughness - first.minRoughness}`);
requireCondition(first.maxAdjacentTintDelta <= 0.055, `near-detail tint adjacent step too large: ${first.maxAdjacentTintDelta}`);
requireCondition(first.maxAdjacentRoughnessDelta <= 0.11, `near-detail roughness adjacent step too large: ${first.maxAdjacentRoughnessDelta}`);
requireCondition(first.maxGuardBandTintDelta <= 0.006, `near-detail tint guard-band delta too large: ${first.maxGuardBandTintDelta}`);
requireCondition(first.maxGuardBandRoughnessDelta <= 0.012, `near-detail roughness guard-band delta too large: ${first.maxGuardBandRoughnessDelta}`);
requireCondition(first.sourceSamples === 129 * 129, 'expected deterministic 129x129 source field');

const source = fs.readFileSync(path.join(ROOT, 'godot/terrain-authoring/geocells/se/g65_near_detail.mjs'), 'utf8');
const signalBody = source.match(/export function g65NearDetailSignal\([\s\S]*?\n}\n/);
requireCondition(Boolean(signalBody), 'could not isolate near-detail signal function');
requireCondition(!/normalizedBounds|xMin|xMax|yMin|yMax|gx|gy|maskBounds|sourceGridSize/.test(signalBody[0]), 'GeoCell/grid terms leaked into near-detail signal');
requireCondition(/physicalCoordinates/.test(signalBody[0]), 'near-detail signal is not anchored to full-reference physical coordinates');

const summary = {
  policyId: first.policyId,
  sourceMapSha256: first.sourceMapSha256,
  geoCell: first.geoCell,
  layer: first.layer,
  sourceSamples: first.sourceSamples,
  terrain3dImportSize: first.terrain3dImportSize,
  canonicalLandCells: first.canonicalLandCells,
  canonicalWaterCells: first.canonicalWaterCells,
  activeRoadSamples: first.activeRoadSamples,
  activePathSamples: first.activePathSamples,
  maxSnowWeight: first.maxSnowWeight,
  minTint: first.minTint,
  maxTint: first.maxTint,
  minRoughness: first.minRoughness,
  maxRoughness: first.maxRoughness,
  maxAdjacentTintDelta: first.maxAdjacentTintDelta,
  maxAdjacentRoughnessDelta: first.maxAdjacentRoughnessDelta,
  maxGuardBandTintDelta: first.maxGuardBandTintDelta,
  maxGuardBandRoughnessDelta: first.maxGuardBandRoughnessDelta,
  maxHeightDeltaMeters: first.maxHeightDeltaMeters,
  maxControlDelta: first.maxControlDelta,
  detailChecksum: first.detailChecksum,
};
console.log(`G65_NEAR_DETAIL_METRICS=${JSON.stringify(summary)}`);
console.log('SE_G65_NEAR_DETAIL_VALIDATION_OK');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const destination = emitArg.slice('--emit-probe='.length);
  const absolute = path.resolve(ROOT, destination);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(buildG65NearDetailProbe())}\n`, 'utf8');
}
