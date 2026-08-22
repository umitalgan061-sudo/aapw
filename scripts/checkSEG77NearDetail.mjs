#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  G77_NEAR_DETAIL_POLICY,
  buildG77NearDetailProbe,
  g77NearDetailSignal,
  measureG77NearDetail,
  sampleG77NearDetail,
} from '../godot/terrain-authoring/geocells/se/g77_near_detail.mjs';
import { sampleG77RoadPath } from '../godot/terrain-authoring/geocells/se/g77_road_path.mjs';
import { loadG77NearDetailLiveContext } from './runtime/g77NearDetailLiveContext.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77NearDetail] ${message}`); };
need(G77_NEAR_DETAIL_POLICY.sourceMapSha256 === EXPECTED_SHA, 'canonical map SHA changed');
need(G77_NEAR_DETAIL_POLICY.sourceGridSize === 257 && G77_NEAR_DETAIL_POLICY.terrain3dImportSize === 257, 'Near Detail must remain 257x257');
need(G77_NEAR_DETAIL_POLICY.terrain3dRegionSize === 256, 'Terrain3D region size changed');

const source = fs.readFileSync(path.join(ROOT, 'godot/terrain-authoring/geocells/se/g77_near_detail.mjs'), 'utf8');
const signalBody = source.match(/export function g77NearDetailSignal\([\s\S]*?\n}\n/);
need(Boolean(signalBody), 'detail signal function missing');
need(/physicalCoordinates/.test(signalBody[0]), 'detail signal is not physical-metre anchored');
need(!/normalizedBounds|maskBounds|sourceGridSize|gx|gy|Pindex|pindex/.test(signalBody[0]), 'GeoCell/grid term leaked into detail signal');
need(Number.isFinite(g77NearDetailSignal(0.93, 0.94)), 'detail signal returned non-finite value');

const { runtimeNetwork, browserErrors } = await loadG77NearDetailLiveContext();
const first = measureG77NearDetail(runtimeNetwork);
need(first.canonicalWaterCells === 44 && first.canonicalLandCells === 52, `canonical 44/52 fingerprint drifted: ${first.canonicalWaterCells}/${first.canonicalLandCells}`);
need(first.sourceSamples === 66049, `expected 66,049 samples, got ${first.sourceSamples}`);
need(first.detailedLandSamples > 15000 && first.canonicalWaterSamples > 15000, 'mixed coast detail coverage collapsed');
need(first.maxHeightDeltaMeters <= 0.000001, `Near Detail changed height: ${first.maxHeightDeltaMeters}`);
need(first.maxRoadPathDelta <= 0.000001, `Near Detail changed Road/Path coverage: ${first.maxRoadPathDelta}`);
need(first.maxControlContractMismatch === 0, `Near Detail changed Terrain3D control contract: ${first.maxControlContractMismatch}`);
need(first.maxCanonicalWaterTintDelta === 0 && first.maxCanonicalWaterRoughnessDelta === 0, 'canonical open water color/roughness was modified');
need(first.minLandTint >= G77_NEAR_DETAIL_POLICY.tintFloor && first.maxLandTint <= G77_NEAR_DETAIL_POLICY.tintCeiling, `land tint out of bounds: ${first.minLandTint}/${first.maxLandTint}`);
need(first.maxLandTint - first.minLandTint >= 0.035, 'land tint variation is too weak');
need(first.minLandRoughness >= G77_NEAR_DETAIL_POLICY.roughnessFloor && first.maxLandRoughness <= G77_NEAR_DETAIL_POLICY.roughnessCeiling, `roughness out of bounds: ${first.minLandRoughness}/${first.maxLandRoughness}`);
need(first.maxLandRoughness - first.minLandRoughness >= 0.07, 'roughness variation is too weak');
need(first.maxAdjacentTintDelta <= 0.16 && first.maxAdjacentRoughnessDelta <= 0.22, `adjacent detail discontinuity too large: ${first.maxAdjacentTintDelta}/${first.maxAdjacentRoughnessDelta}`);
need(first.maxNorthWestTintGuardDelta <= 0.16 && first.maxNorthWestRoughnessGuardDelta <= 0.22, `north/west guard discontinuity too large: ${first.maxNorthWestTintGuardDelta}/${first.maxNorthWestRoughnessGuardDelta}`);
need(browserErrors.length === 0, 'live context browser errors');

const b = G77_NEAR_DETAIL_POLICY.normalizedBounds;
for (const [nx, ny] of [[b.xMin, b.yMin], [b.xMax, b.yMax], [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2]]) {
  const before = sampleG77RoadPath(nx, ny, runtimeNetwork), after = sampleG77NearDetail(nx, ny, runtimeNetwork);
  need(after.authoredHeight === before.authoredHeight, 'spot check height changed');
  need(after.roadCoverage === before.roadCoverage && after.pathCoverage === before.pathCoverage, 'spot check route coverage changed');
}

const emit = process.argv.find((arg) => arg.startsWith('--emit-probe='));
if (emit) {
  const out = path.resolve(ROOT, emit.slice('--emit-probe='.length));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(buildG77NearDetailProbe(runtimeNetwork, first))}\n`);
}
console.log(`SE_G77_NEAR_DETAIL_METRICS=${JSON.stringify({ ...first, mainEdges: runtimeNetwork.mainEdges.length, footpathEdges: runtimeNetwork.footpathEdges.length, browserErrors })}`);
console.log('SE_G77_NEAR_DETAIL_VALIDATION_OK');
