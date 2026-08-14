#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G70_TERRAIN3D_NEAR_DETAIL_POLICY,
  buildG70Terrain3DNearDetailProbe,
  measureG70Terrain3DNearDetail,
} from '../godot/terrain-authoring/geocells/ne/g70_near_detail.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const fail = (message) => { console.error(`[checkNEG70NearDetail] FAIL: ${message}`); process.exit(1); };
const requireCondition = (condition, message) => { if (!condition) fail(message); };

const p = G70_TERRAIN3D_NEAR_DETAIL_POLICY;
requireCondition(p.sourceMapSha256 === EXPECTED_SHA, 'canonical map SHA changed');
requireCondition(p.geoCell === 'G70' && p.gx === 7 && p.gy === 0 && p.layer === 'Near Detail', 'unexpected cell/layer');
requireCondition(p.sourceGridSize === 129 && p.terrain3dImportSize === 257 && p.terrain3dRegionSize === 256, 'proof dimensions changed');
requireCondition(p.foliageDensity === 0, 'open-sea G70 may not invent foliage');
requireCondition(JSON.stringify(p.microWavelengthMeters) === JSON.stringify([47, 71, 109, 163]), 'physical-metre detail phase changed');

const first = measureG70Terrain3DNearDetail();
const second = measureG70Terrain3DNearDetail();
requireCondition(JSON.stringify(first) === JSON.stringify(second), 'Near Detail metrics are not deterministic');
requireCondition(first.canonicalWaterCells === 96 && first.canonicalLandCells === 0, `G70 hydrology changed: ${first.canonicalWaterCells} water / ${first.canonicalLandCells} land`);
requireCondition(first.sourceSamples === 16641, 'expected 129x129 source grid');
requireCondition(first.maxHeightDelta === 0, 'Near Detail changed merged Relief/Road height');
requireCondition(first.maxControlDelta === 0, 'Near Detail changed merged Rock/Snow control');
requireCondition(first.maxRoadPathDelta === 0, 'Near Detail changed merged Road/Path coverage');
requireCondition(first.maxFoliageDensity === 0, 'Near Detail invented foliage on open sea');
requireCondition(first.minSignal < -0.70 && first.maxSignal > 0.70, `microvariation signal is too weak: ${first.minSignal}..${first.maxSignal}`);
requireCondition(first.minTint >= p.tintFloor && first.maxTint <= p.tintCeiling, `tint range escaped policy: ${first.minTint}..${first.maxTint}`);
requireCondition(first.maxTint - first.minTint >= 0.018, `marine tint variation too weak: ${first.maxTint - first.minTint}`);
requireCondition(first.minRoughness >= p.roughnessFloor && first.maxRoughness <= p.roughnessCeiling, `roughness range escaped policy: ${first.minRoughness}..${first.maxRoughness}`);
requireCondition(first.maxRoughness - first.minRoughness >= 0.06, `marine roughness variation too weak: ${first.maxRoughness - first.minRoughness}`);
requireCondition(first.maxAdjacentTintDelta <= 0.025, `adjacent tint step too large: ${first.maxAdjacentTintDelta}`);
requireCondition(first.maxAdjacentRoughnessDelta <= 0.08, `adjacent roughness step too large: ${first.maxAdjacentRoughnessDelta}`);
requireCondition(first.maxGuardTintDelta <= 0.025, `west/south guard tint seam too large: ${first.maxGuardTintDelta}`);
requireCondition(first.maxGuardRoughnessDelta <= 0.08, `west/south guard roughness seam too large: ${first.maxGuardRoughnessDelta}`);

const source = fs.readFileSync(path.join(ROOT, 'godot/terrain-authoring/geocells/ne/g70_near_detail.mjs'), 'utf8');
const signalBody = source.match(/export function g70NearDetailSignal\([\s\S]*?\n}\n/);
requireCondition(Boolean(signalBody), 'could not isolate Near Detail signal');
requireCondition(/physicalCoordinates/.test(signalBody[0]), 'Near Detail phase is not anchored to physical metres');
requireCondition(!/normalizedBounds|xMin|xMax|yMin|yMax|gx|gy|Math\.floor|Math\.round/.test(signalBody[0]), 'GeoCell/grid term leaked into detail signal');

console.log(`G70_NEAR_DETAIL_METRICS=${JSON.stringify(first)}`);
console.log('NE_G70_NEAR_DETAIL_VALIDATION_OK');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const destination = path.resolve(ROOT, emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(buildG70Terrain3DNearDetailProbe())}\n`, 'utf8');
}
