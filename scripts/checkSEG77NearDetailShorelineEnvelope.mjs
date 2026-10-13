#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probe = JSON.parse(fs.readFileSync(path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g77-near-detail-probe.json'), 'utf8'));
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77NearDetailShorelineEnvelope] ${message}`); };
const openWater = (s) => s[6] >= 0.5 && s[7] <= 0.001;
const tintDelta = (a, b) => Math.max(Math.abs(a[11] - b[11]), Math.abs(a[12] - b[12]), Math.abs(a[13] - b[13]));
need(probe.geoCell === 'G77' && probe.layer === 'Near Detail' && probe.rows.length === 257, 'probe identity/size drifted');

let waterSamples = 0, detailSamples = 0, coastPairs = 0, roadSamples = 0, pathSamples = 0;
let unsupportedWetRouteSamples = 0, supportedWetSamples = 0, maxCoastTintStep = 0, maxCoastRoughnessStep = 0;
const waterColors = new Set(), landColors = new Set();
for (let y = 0; y < 257; y += 1) for (let x = 0; x < 257; x += 1) {
  const s = probe.rows[y][x], water = openWater(s), route = Math.max(s[1], s[2]);
  if (s[1] > 0.02) roadSamples += 1;
  if (s[2] > 0.02) pathSamples += 1;
  const key = [s[11], s[12], s[13], s[14]].map((v) => Math.round(v * 255)).join(':');
  if (water) {
    waterSamples += 1; waterColors.add(key);
    need(Math.abs(s[11] - 1) <= 1e-8 && Math.abs(s[12] - 1) <= 1e-8 && Math.abs(s[13] - 1) <= 1e-8, 'canonical water tint changed');
    need(Math.abs(s[14] - 0.9) <= 1e-8, 'canonical water roughness changed');
    if (route > 0.000001) unsupportedWetRouteSamples += 1;
  } else {
    detailSamples += 1; landColors.add(key);
    if (s[6] >= 0.5 && s[7] > 0.001) supportedWetSamples += 1;
  }
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    if (x + dx >= 257 || y + dy >= 257) continue;
    const n = probe.rows[y + dy][x + dx];
    if (water !== openWater(n)) {
      coastPairs += 1;
      maxCoastTintStep = Math.max(maxCoastTintStep, tintDelta(s, n));
      maxCoastRoughnessStep = Math.max(maxCoastRoughnessStep, Math.abs(s[14] - n[14]));
    }
  }
}
need(waterSamples === probe.canonicalWaterSamples && detailSamples === probe.detailedLandSamples, 'shoreline sample accounting disagrees with source metrics');
need(roadSamples === probe.activeRoadSamples && pathSamples === probe.activePathSamples, 'Near Detail changed active Road/Path sample population');
need(unsupportedWetRouteSamples === 0, `route/detail leaked onto unsupported canonical water: ${unsupportedWetRouteSamples}`);
need(waterColors.size === 1, `canonical water acquired deterministic texture variation: ${waterColors.size} variants`);
need(landColors.size >= 256, `dry/mixed surface detail diversity collapsed: ${landColors.size} variants`);
need(coastPairs > 100 && maxCoastTintStep <= 0.16 && maxCoastRoughnessStep <= 0.22, `shoreline envelope failed: pairs=${coastPairs} tint=${maxCoastTintStep} rough=${maxCoastRoughnessStep}`);
console.log(`SE_G77_NEAR_DETAIL_SHORELINE_ENVELOPE_METRICS=${JSON.stringify({waterSamples,detailSamples,coastPairs,roadSamples,pathSamples,unsupportedWetRouteSamples,supportedWetSamples,waterVariants:waterColors.size,landVariants:landColors.size,maxCoastTintStep,maxCoastRoughnessStep})}`);
console.log('SE_G77_NEAR_DETAIL_SHORELINE_ENVELOPE_OK');
