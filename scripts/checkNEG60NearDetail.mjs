#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G60_TERRAIN3D_NEAR_DETAIL_POLICY,
  buildG60Terrain3DNearDetailProbe,
  measureG60Terrain3DNearDetail,
} from '../godot/terrain-authoring/geocells/ne/g60_near_detail.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const fail = (message) => { console.error(`[checkNEG60NearDetail] FAIL: ${message}`); process.exit(1); };
const requireCondition = (condition, message) => { if (!condition) fail(message); };
const p = G60_TERRAIN3D_NEAR_DETAIL_POLICY;

requireCondition(p.sourceMapSha256 === EXPECTED_SHA, 'canonical map SHA changed');
requireCondition(p.geoCell === 'G60' && p.gx === 6 && p.gy === 0 && p.layer === 'Near Detail', 'unexpected cell/layer');
requireCondition(p.sourceGridSize === 129 && p.denseEnvelopeSize === 193 && p.terrain3dImportSize === 257 && p.terrain3dRegionSize === 256, 'proof dimensions changed');
requireCondition(p.foliageDensity === 0, 'open-sea G60 may not invent foliage');
requireCondition(JSON.stringify(p.microWavelengthMeters) === JSON.stringify([47,71,109,163]), 'physical-metre phase changed');

const first = measureG60Terrain3DNearDetail();
const second = measureG60Terrain3DNearDetail();
requireCondition(JSON.stringify(first) === JSON.stringify(second), 'Near Detail metrics are not deterministic');
requireCondition(first.canonicalWaterCells === 96 && first.canonicalLandCells === 0, `G60 hydrology changed: ${first.canonicalWaterCells}/${first.canonicalLandCells}`);
requireCondition(first.sourceSamples === 16641, 'expected 129x129 source grid');
requireCondition(first.maxHeightDelta === 0 && first.maxControlDelta === 0 && first.maxRoadPathDelta === 0, 'Near Detail changed prior terrain layers');
requireCondition(first.maxFoliageDensity === 0 && first.maxMacroColorDelta === 0, 'Near Detail changed macro color provenance or invented foliage');
requireCondition(first.minSignal < -0.70 && first.maxSignal > 0.70, `microvariation signal too weak: ${first.minSignal}..${first.maxSignal}`);
requireCondition(first.minTint >= p.tintFloor && first.maxTint <= p.tintCeiling, `tint escaped policy: ${first.minTint}..${first.maxTint}`);
requireCondition(first.maxTint-first.minTint >= 0.018, 'marine tint variation too weak');
requireCondition(first.minRoughness >= p.roughnessFloor && first.maxRoughness <= p.roughnessCeiling, `roughness escaped policy: ${first.minRoughness}..${first.maxRoughness}`);
requireCondition(first.maxRoughness-first.minRoughness >= 0.06, 'marine roughness variation too weak');
requireCondition(first.maxAdjacentTintDelta <= 0.025 && first.maxAdjacentRoughnessDelta <= 0.08, 'source-grid detail continuity too rough');

const source = fs.readFileSync(path.join(ROOT, 'godot/terrain-authoring/geocells/ne/g60_near_detail.mjs'), 'utf8');
const signalBody = source.match(/export function g60NearDetailSignal\([\s\S]*?\n}\n/);
requireCondition(Boolean(signalBody), 'could not isolate Near Detail signal');
requireCondition(/physicalCoordinates/.test(signalBody[0]), 'Near Detail phase is not anchored in physical metres');
requireCondition(!/normalizedBounds|xMin|xMax|yMin|yMax|gx|gy|Math\.floor|Math\.round/.test(signalBody[0]), 'GeoCell/grid term leaked into detail signal');

const probeA = buildG60Terrain3DNearDetailProbe();
const probeB = buildG60Terrain3DNearDetailProbe();
requireCondition(JSON.stringify(probeA) === JSON.stringify(probeB), 'Near Detail probe is not deterministic');
console.log(`G60_NEAR_DETAIL_METRICS=${JSON.stringify(first)}`);
console.log('NE_G60_NEAR_DETAIL_VALIDATION_OK');

const emitArg = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emitArg) {
  const destination = path.resolve(ROOT, emitArg.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(probeA)}\n`, 'utf8');
}
