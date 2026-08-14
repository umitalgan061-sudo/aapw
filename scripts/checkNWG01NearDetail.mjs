#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G01_NEAR_DETAIL_POLICY,
  buildG01NearDetailProbe,
  measureG01NearDetail,
} from '../godot/terrain-authoring/geocells/nw/g01_near_detail.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SOURCE_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';

function fail(message) {
  console.error(`[checkNWG01NearDetail] FAIL: ${message}`);
  process.exit(1);
}
function requireCondition(condition, message) {
  if (!condition) fail(message);
}

requireCondition(G01_NEAR_DETAIL_POLICY.sourceMapSha256 === EXPECTED_SOURCE_SHA, 'canonical map SHA changed');
requireCondition(G01_NEAR_DETAIL_POLICY.geoCell === 'G01' && G01_NEAR_DETAIL_POLICY.layer === 'Near Detail', 'unexpected cell/layer');
requireCondition(G01_NEAR_DETAIL_POLICY.sourceGridSize === 129, 'Near Detail source must remain 129x129');
requireCondition(G01_NEAR_DETAIL_POLICY.terrain3dRegionSize === 256, 'Terrain3D region must remain 256');
requireCondition(G01_NEAR_DETAIL_POLICY.terrain3dImportSize === 257, 'Near Detail proof must use 257x257 import');
requireCondition(G01_NEAR_DETAIL_POLICY.rockTextureId === 0 && G01_NEAR_DETAIL_POLICY.snowTextureId === 1, 'Rock/Snow texture IDs changed');
requireCondition(G01_NEAR_DETAIL_POLICY.roadTextureId === 2 && G01_NEAR_DETAIL_POLICY.pathTextureId === 3, 'Road/Path texture IDs changed');
requireCondition(JSON.stringify(G01_NEAR_DETAIL_POLICY.detailWavelengthMeters) === JSON.stringify([53, 79, 97, 61, 149]), 'qualified NW physical-metre phase changed');

const first = measureG01NearDetail();
const second = measureG01NearDetail();
requireCondition(JSON.stringify(first) === JSON.stringify(second), 'Near Detail metrics are not deterministic');
requireCondition(first.canonicalWaterCells === 88 && first.canonicalLandCells === 8, `G01 hydrology fingerprint changed: ${first.canonicalWaterCells} water / ${first.canonicalLandCells} land`);
requireCondition(first.sourceSamples === 129 * 129, 'expected deterministic 129x129 source');
requireCondition(first.landDetailSamples > 0, 'Near Detail produced no land micro-detail');
requireCondition(first.maxHeightDeltaMeters === 0, 'Near Detail modified merged Relief height');
requireCondition(first.maxControlDelta === 0, 'Near Detail modified merged Rock/Snow control');
requireCondition(first.maxCanonicalWaterTintDelta === 0, 'canonical water tint must remain neutral');
requireCondition(first.maxCanonicalWaterRoughnessDelta === 0, 'canonical water roughness must remain 0.90');
requireCondition(first.maxG00SharedSeamTintDelta <= 0.00001, `G00/G01 shared tint seam opened: ${first.maxG00SharedSeamTintDelta}`);
requireCondition(first.maxG00SharedSeamRoughnessDelta <= 0.00001, `G00/G01 shared roughness seam opened: ${first.maxG00SharedSeamRoughnessDelta}`);
requireCondition(first.minTint >= G01_NEAR_DETAIL_POLICY.tintFloor, `tint fell below floor: ${first.minTint}`);
requireCondition(first.maxTint <= G01_NEAR_DETAIL_POLICY.tintCeiling, `tint exceeded ceiling: ${first.maxTint}`);
requireCondition(first.maxTint - first.minTint >= 0.005, `Near Detail tint variation too weak: ${first.maxTint - first.minTint}`);
requireCondition(first.minRoughness >= G01_NEAR_DETAIL_POLICY.roughnessFloor, `roughness fell below floor: ${first.minRoughness}`);
requireCondition(first.maxRoughness <= G01_NEAR_DETAIL_POLICY.roughnessCeiling, `roughness exceeded ceiling: ${first.maxRoughness}`);
requireCondition(first.maxRoughness - first.minRoughness >= 0.01, `Near Detail roughness variation too weak: ${first.maxRoughness - first.minRoughness}`);
requireCondition(first.maxAdjacentTintDelta <= 0.08, `adjacent tint step too large: ${first.maxAdjacentTintDelta}`);
requireCondition(first.maxAdjacentRoughnessDelta <= 0.14, `adjacent roughness step too large: ${first.maxAdjacentRoughnessDelta}`);
requireCondition(first.maxGuardBandTintDelta <= 0.08, `guard-band tint delta too large: ${first.maxGuardBandTintDelta}`);
requireCondition(first.maxGuardBandRoughnessDelta <= 0.14, `guard-band roughness delta too large: ${first.maxGuardBandRoughnessDelta}`);

const source = fs.readFileSync(path.join(ROOT, 'godot/terrain-authoring/geocells/nw/g01_near_detail.mjs'), 'utf8');
const signalBody = source.match(/export function g01NearDetailSignal\([\s\S]*?\n}\n/);
requireCondition(Boolean(signalBody), 'could not isolate G01 Near Detail signal wrapper');
requireCondition(/g00NearDetailSignal/.test(signalBody[0]), 'G01 did not inherit the qualified G00 global detail phase');
requireCondition(!/normalizedBounds|xMin|xMax|yMin|yMax|gx|gy|maskBounds|sourceGridSize|Math\.floor|Math\.round/.test(signalBody[0]), 'GeoCell/grid quantization leaked into G01 Near Detail signal');

const g00Source = fs.readFileSync(path.join(ROOT, 'godot/terrain-authoring/geocells/nw/g00_near_detail.mjs'), 'utf8');
const inheritedBody = g00Source.match(/export function g00NearDetailSignal\([\s\S]*?\n}\n/);
requireCondition(Boolean(inheritedBody), 'could not isolate inherited G00 physical signal');
requireCondition(/physicalCoordinates/.test(inheritedBody[0]), 'inherited detail phase is not anchored to full-reference physical metres');
requireCondition(!/normalizedBounds|xMin|xMax|yMin|yMax|gx|gy|maskBounds|sourceGridSize|Math\.floor|Math\.round/.test(inheritedBody[0]), 'grid terms leaked into inherited NW detail phase');

console.log(`G01_NEAR_DETAIL_METRICS=${JSON.stringify(first)}`);
console.log('NW_G01_NEAR_DETAIL_VALIDATION_OK');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const destination = emitArg.slice('--emit-probe='.length);
  const absolute = path.resolve(ROOT, destination);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${JSON.stringify(buildG01NearDetailProbe())}\n`, 'utf8');
}
