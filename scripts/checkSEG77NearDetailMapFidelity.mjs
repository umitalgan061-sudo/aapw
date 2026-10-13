#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probePath = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g77-near-detail-probe.json');
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77NearDetailMapFidelity] ${message}`); };
const p = JSON.parse(fs.readFileSync(probePath, 'utf8'));
const EXPECTED_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
need(p.sourceMapSha256 === EXPECTED_SHA && p.sourceMapVersion === 'map.png-r1', 'map.png authority changed');
need(p.canonicalWaterCells === 44 && p.canonicalLandCells === 52, `canonical G77 fingerprint changed: ${p.canonicalWaterCells}/${p.canonicalLandCells}`);
need(p.normalizedBounds.xMin >= 0.87 && p.normalizedBounds.yMin >= 0.87 && p.normalizedBounds.xMax === 1 && p.normalizedBounds.yMax === 1, 'G77 southeast owner bounds drifted');
need(p.maxHeightDeltaMeters === 0 && p.maxRoadPathDelta === 0 && p.maxControlContractMismatch === 0, 'Near Detail mutated geography/control ownership');
need(p.maxCanonicalWaterTintDelta === 0 && p.maxCanonicalWaterRoughnessDelta === 0, 'canonical water was recolored or re-roughened');
need(p.maxNorthWestTintGuardDelta <= 0.16 && p.maxNorthWestRoughnessGuardDelta <= 0.22, 'north/west continuity guard failed');

let water = 0, land = 0, coastTransitions = 0, landVariation = 0;
let previous = null;
for (const row of p.rows) {
  for (let x = 0; x < row.length; x += 1) {
    const s = row[x], isOpenWater = s[6] >= 0.5 && s[7] <= 0.001;
    if (isOpenWater) water += 1; else land += 1;
    if (!isOpenWater) landVariation = Math.max(landVariation, Math.abs(1 - s[11]), Math.abs(1 - s[12]), Math.abs(1 - s[13]), Math.abs(0.9 - s[14]));
    if (x && isOpenWater !== (row[x - 1][6] >= 0.5 && row[x - 1][7] <= 0.001)) coastTransitions += 1;
    if (previous && isOpenWater !== (previous[x][6] >= 0.5 && previous[x][7] <= 0.001)) coastTransitions += 1;
  }
  previous = row;
}
need(water > 15000 && land > 15000, `mixed G77 coast collapsed: ${water}/${land}`);
need(coastTransitions > 100, `coastline transition evidence too weak: ${coastTransitions}`);
need(landVariation >= 0.04, `Near Detail does not visibly differentiate dry surface: ${landVariation}`);
need(p.detailChecksum > 0 && p.predecessorCoverageChecksum > 0, 'deterministic checksums missing');
console.log(`SE_G77_NEAR_DETAIL_MAP_FIDELITY_METRICS=${JSON.stringify({ canonicalWaterCells:p.canonicalWaterCells, canonicalLandCells:p.canonicalLandCells, waterSamples:water, landSamples:land, coastTransitions, landVariation, detailChecksum:p.detailChecksum, predecessorCoverageChecksum:p.predecessorCoverageChecksum })}`);
console.log('SE_G77_NEAR_DETAIL_MAP_FIDELITY_OK');
