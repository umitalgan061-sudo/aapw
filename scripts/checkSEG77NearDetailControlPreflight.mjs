#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probePath = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g77-near-detail-probe.json');
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77NearDetailControlPreflight] ${message}`); };
need(fs.existsSync(probePath), 'Near Detail probe missing');
const p = JSON.parse(fs.readFileSync(probePath, 'utf8'));
need(p.schema === 'westeros-g77-terrain3d-near-detail-probe-v1' && p.geoCell === 'G77' && p.layer === 'Near Detail', 'probe identity drifted');
need(p.sourceGridSize === 257 && p.rows.length === 257 && p.rows.every((r) => r.length === 257), 'probe is not 257x257');
const ids = new Set([p.groundTextureId, p.rockTextureId, p.snowTextureId, p.roadTextureId, p.pathTextureId]);
need(ids.size === 5, 'Terrain3D texture IDs collapsed');

let samples = 0, routeSamples = 0, openWaterSamples = 0, reconstructedMismatches = 0, invalidRanges = 0;
let minTint = 1, maxTint = 0, minRoughness = 1, maxRoughness = 0;
for (const row of p.rows) for (const s of row) {
  samples += 1;
  const [height, road, footpath, ground, rock, snow, water, settlement, baseId, overlayId, blend8, r, g, b, roughness] = s;
  if (![height, road, footpath, ground, rock, snow, water, settlement, r, g, b, roughness].every(Number.isFinite)) invalidRanges += 1;
  if (![baseId, overlayId].every((v) => Number.isInteger(v) && ids.has(v)) || !Number.isInteger(blend8) || blend8 < 0 || blend8 > 255) invalidRanges += 1;
  if ([road, footpath, ground, rock, snow, water, settlement, r, g, b, roughness].some((v) => v < -1e-8 || v > 1 + 1e-8)) invalidRanges += 1;
  const coverage = Math.max(road, footpath);
  let expectedBase, expectedOverlay, expectedBlend8;
  if (coverage > 0.002) {
    const ranked = [[ground, p.groundTextureId], [rock, p.rockTextureId], [snow, p.snowTextureId]].sort((a, b2) => b2[0] - a[0]);
    expectedBase = ranked[0][1]; expectedOverlay = footpath > road ? p.pathTextureId : p.roadTextureId; expectedBlend8 = Math.round(coverage * 255); routeSamples += 1;
  } else {
    expectedBase = p.groundTextureId; expectedOverlay = snow > rock ? p.snowTextureId : p.rockTextureId; expectedBlend8 = Math.round(Math.max(rock, snow) * 255);
  }
  if (baseId !== expectedBase || overlayId !== expectedOverlay || Math.abs(blend8 - expectedBlend8) > 1) reconstructedMismatches += 1;
  const openWater = water >= 0.5 && settlement <= 0.001;
  if (openWater) {
    openWaterSamples += 1;
    if (r !== 1 || g !== 1 || b !== 1 || Math.abs(roughness - 0.9) > 1e-8) reconstructedMismatches += 1;
  } else {
    minTint = Math.min(minTint, r, g, b); maxTint = Math.max(maxTint, r, g, b); minRoughness = Math.min(minRoughness, roughness); maxRoughness = Math.max(maxRoughness, roughness);
  }
}
need(samples === 66049, `expected 66,049 samples, got ${samples}`);
need(routeSamples > 0 === (p.activeRoadSamples > 0 || p.activePathSamples > 0), 'route material coverage disagrees with predecessor metrics');
need(openWaterSamples > 15000, 'canonical open-water sample population collapsed');
need(invalidRanges === 0, `invalid sample/control ranges: ${invalidRanges}`);
need(reconstructedMismatches === 0, `control/color reconstruction mismatches: ${reconstructedMismatches}`);
need(minTint >= 0.86 && maxTint <= 1 && minRoughness >= 0.60 && maxRoughness <= 0.96, 'Near Detail bounded material envelope failed');
console.log(`SE_G77_NEAR_DETAIL_CONTROL_PREFLIGHT_METRICS=${JSON.stringify({ samples, routeSamples, openWaterSamples, minTint, maxTint, minRoughness, maxRoughness, detailChecksum: p.detailChecksum })}`);
console.log('SE_G77_NEAR_DETAIL_CONTROL_PREFLIGHT_OK');
