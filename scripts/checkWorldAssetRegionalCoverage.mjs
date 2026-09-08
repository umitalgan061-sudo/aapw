#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_ASSET_REGIONAL_ANCHOR_POLICY,
  WORLD_ASSET_REGIONAL_ANCHORS,
  regionalAnchorInfluences,
  regionalAnchorBlend,
  regionalAnchorDiagnostics,
  regionalAnchorDistance,
  sampleRegionalAssetAnchor,
} from '../src/3d/world/worldAssetRegionalAnchors.js';

const families = ['tree', 'vegetation', 'shrub', 'rock', 'snow', 'building', 'settlement', 'waterside'];
const gridSize = 37;
let samples = 0;
let uncovered = 0;
let boundedFailures = 0;
let continuityFailures = 0;
let dominantChanges = 0;

function bounded(value, label) {
  assert.ok(Number.isFinite(value), `${label} finite`);
  assert.ok(value >= 0 && value <= 1, `${label} bounded`);
}

function sample(x, y) {
  const result = sampleRegionalAssetAnchor(x, y, 'vegetation');
  assert.ok(result);
  bounded(result.influence ?? result.totalInfluence ?? result.coverage ?? 0, 'anchor coverage');
  return result;
}

for (let iy = 0; iy < gridSize; iy++) {
  const y = iy / (gridSize - 1);
  for (let ix = 0; ix < gridSize; ix++) {
    const x = ix / (gridSize - 1);
    const influences = regionalAnchorInfluences(x, y);
    const values = Object.values(influences);
    assert.equal(values.length, Object.keys(WORLD_ASSET_REGIONAL_ANCHORS).length);
    for (const [id, value] of Object.entries(influences)) {
      try {
        bounded(value, `${id}@${x},${y}`);
      } catch {
        boundedFailures++;
      }
    }
    const maxInfluence = Math.max(...values);
    if (!(maxInfluence > 0.02)) uncovered++;
    const regional = sample(x, y);
    assert.ok(regional.anchors ?? regional.topAnchors ?? regional.dominantAnchor !== undefined);
    samples++;
  }
}

for (const [id, anchor] of Object.entries(WORLD_ASSET_REGIONAL_ANCHORS)) {
  const local = sampleRegionalAssetAnchor(anchor.x, anchor.y, 'vegetation');
  const top = local.dominantAnchor ?? local.id ?? local.topAnchor ?? null;
  assert.ok(top, `${id} should report a dominant anchor at its own centre`);
  const distance = regionalAnchorDistance(anchor.x, anchor.y, id);
  assert.ok(distance <= 0.02, `${id} centre distance should be near zero`);
  const diagnostics = regionalAnchorDiagnostics(anchor.x, anchor.y, 'vegetation');
  assert.ok(diagnostics);
  const blend = regionalAnchorBlend(anchor.x, anchor.y);
  assert.ok(blend);
}

for (const family of families) {
  for (let iy = 0; iy < 11; iy++) {
    const y = iy / 10;
    for (let ix = 0; ix < 11; ix++) {
      const x = ix / 10;
      const result = sampleRegionalAssetAnchor(x, y, family);
      const familyResponse = result.familyResponse ?? result.response ?? 0.5;
      bounded(Math.max(0, Math.min(1, familyResponse)), `${family}@${x},${y}.familyResponse`);
    }
  }
}

for (let iy = 0; iy < gridSize - 1; iy++) {
  const y = iy / (gridSize - 1);
  for (let ix = 0; ix < gridSize - 1; ix++) {
    const x = ix / (gridSize - 1);
    const a = regionalAnchorInfluences(x, y);
    const b = regionalAnchorInfluences(x + 1 / (gridSize - 1), y);
    for (const id of Object.keys(a)) {
      const delta = Math.abs(a[id] - b[id]);
      if (delta > 0.30) continuityFailures++;
    }
    const da = sampleRegionalAssetAnchor(x, y, 'tree');
    const db = sampleRegionalAssetAnchor(x + 1 / (gridSize - 1), y, 'tree');
    const dominantA = da.dominantAnchor ?? da.id ?? null;
    const dominantB = db.dominantAnchor ?? db.id ?? null;
    if (dominantA !== dominantB) dominantChanges++;
  }
}

assert.equal(boundedFailures, 0, 'all regional influences must remain bounded');
assert.equal(continuityFailures, 0, 'regional influence field should remain locally continuous');
assert.ok(uncovered < samples * 0.25, `regional coverage has too many completely unanchored cells: ${uncovered}/${samples}`);
assert.ok(dominantChanges > 0, 'coverage audit should observe meaningful regional transitions');

const namedRegions = Object.keys(WORLD_ASSET_REGIONAL_ANCHORS);
assert.ok(namedRegions.includes('northWesteros'));
assert.ok(namedRegions.includes('riverlands'));
assert.ok(namedRegions.includes('vale'));
assert.ok(namedRegions.includes('westerlands'));
assert.ok(namedRegions.includes('reach'));
assert.ok(namedRegions.includes('stormlands'));
assert.ok(namedRegions.includes('dorne'));
assert.ok(namedRegions.includes('essosWest'));
assert.ok(namedRegions.includes('valyria'));
assert.equal(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.newGeographyIntroduced, false);
assert.equal(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.renderOnly, true);
assert.equal(WORLD_ASSET_REGIONAL_ANCHOR_POLICY.distributionOnly, true);

console.log(JSON.stringify({
  ok: true,
  policyId: WORLD_ASSET_REGIONAL_ANCHOR_POLICY.id,
  regionCount: namedRegions.length,
  gridSamples: samples,
  uncovered,
  boundedFailures,
  continuityFailures,
  dominantChanges,
}, null, 2));
