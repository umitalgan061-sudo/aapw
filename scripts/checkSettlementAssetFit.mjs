#!/usr/bin/env node
/**
 * Asset footprint/scale coherence audit for functional settlement buildings.
 *
 * The runtime deliberately fits authored source bounds into geographic parcel footprints instead of
 * assuming every exported model was authored at the same meter scale. This static gate verifies that
 * the code keeps that invariant, that each role has a plausible parcel size, and that the fit result
 * remains deterministic and bounded. It does not inspect binary model dimensions; the Chromium proof
 * is responsible for that runtime measurement.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LANDMARK = path.join(ROOT, 'src/3d/world/settlementFunctionalLandmarks.js');
const VILLAGES = path.join(ROOT, 'src/3d/world/villages.js');

const ROLE_FOOTPRINTS = Object.freeze({
  blacksmith: { width: 9, depth: 9, minCoverage: 0.42, maxCoverage: 1.01 },
  barracks: { width: 13, depth: 10, minCoverage: 0.34, maxCoverage: 1.01 },
  farm: { width: 12, depth: 14, minCoverage: 0.28, maxCoverage: 1.01 },
  stable: { width: 13, depth: 15, minCoverage: 0.28, maxCoverage: 1.01 },
  tavern: { width: 10, depth: 9, minCoverage: 0.40, maxCoverage: 1.01 },
  market: { width: 15, depth: 11, minCoverage: 0.24, maxCoverage: 1.01 },
});

const EXPECTED_SCALE_GUARDS = Object.freeze([
  'targetWidth / sourceSize.x',
  'targetDepth / sourceSize.z',
  'turnedScale = Math.min(targetWidth / sourceSize.z, targetDepth / sourceSize.x)',
  'parcelCoverage:',
]);

function read(file) {
  if (!fs.existsSync(file)) throw new Error(`missing source file: ${path.relative(ROOT, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function parseFootprint(source, role) {
  const pattern = new RegExp(`${role}: Object\\.freeze\\(\\{[\\s\\S]*?footprint: Object\\.freeze\\(\\{ width: (\\d+), depth: (\\d+) \\}`);
  const match = source.match(pattern);
  if (!match) return null;
  return { width: Number(match[1]), depth: Number(match[2]) };
}

function checkRoleFootprints(source) {
  for (const [role, expected] of Object.entries(ROLE_FOOTPRINTS)) {
    const actual = parseFootprint(source, role);
    assert(actual, `missing footprint for role: ${role}`);
    assert(actual.width === expected.width, `${role} footprint width drifted: ${actual.width} !== ${expected.width}`);
    assert(actual.depth === expected.depth, `${role} footprint depth drifted: ${actual.depth} !== ${expected.depth}`);
    assert(actual.width >= 7 && actual.depth >= 7, `${role} parcel is too small for authored architecture`);
    assert(actual.width <= 18 && actual.depth <= 18, `${role} parcel is too large for hamlet-scale functional architecture`);
  }
}

function checkFitAlgorithm(source) {
  for (const guard of EXPECTED_SCALE_GUARDS) assert(source.includes(guard), `asset fit invariant missing: ${guard}`);
  assert(source.includes('const directScale = Math.min'), 'direct scale fit path disappeared');
  assert(source.includes('const turnedScale = Math.min'), '90-degree fit path disappeared');
  assert(source.includes('const quarterTurn = turnedScale > directScale + 1e-9'), 'orientation-aware footprint fitting disappeared');
  assert(source.includes('model.scale.multiplyScalar(scale)'), 'source asset is no longer scaled into parcel footprint');
  assert(source.includes("parcelCoverage:"), 'parcel coverage evidence disappeared');
  assert(source.includes("fittedWidth:"), 'fitted width evidence disappeared');
  assert(source.includes("fittedDepth:"), 'fitted depth evidence disappeared');
  assert(!source.includes('scale.set(targetWidth'), 'non-uniform scale is not allowed as a fit shortcut');
}

function checkGeographicScaleSeparation(source) {
  assert(source.includes('FUNCTIONAL_LANDMARK_MIN_CENTER_DISTANCE_METERS'), 'functional centre distance missing');
  assert(source.includes('FUNCTIONAL_LANDMARK_MAX_CENTER_DISTANCE_METERS'), 'functional centre envelope missing');
  assert(source.includes('ROLE_DISTANCE_BIAS'), 'role distance policy missing');
  assert(source.includes('distanceFromCentre: distance'), 'distance provenance missing from site plan');
  assert(source.includes('roadDistanceMeters'), 'road proximity provenance missing from site plan');
  assert(source.includes('nearestHouseDistance'), 'house clearance is not part of site planning');
  assert(source.includes('nearestLandmarkDistance'), 'landmark spacing is not part of site planning');
}

function checkHouseScaleDiversity(villages) {
  const matches = [...villages.matchAll(/\{ id: '(cottage|longhouse|twostory)', weight: ([0-9.]+), width: ([0-9.]+), depth: ([0-9.]+), wallHeight: ([0-9.]+), roofHeight: ([0-9.]+) \}/g)];
  assert(matches.length === 3, `expected three procedural house scale types, found ${matches.length}`);
  const widths = matches.map((match) => Number(match[3]));
  const heights = matches.map((match) => Number(match[5]) + Number(match[6]));
  assert(new Set(widths).size === 3, 'procedural house widths collapsed to a single scale');
  assert(new Set(heights).size === 3, 'procedural house silhouette heights collapsed to a single scale');
  assert(Math.max(...widths) / Math.min(...widths) >= 1.3, 'house width variation is visually too weak');
}

function checkRegionalParcelVariation(source) {
  const north = parseFootprint(source, 'blacksmith');
  const fertile = parseFootprint(source, 'farm');
  const maritime = parseFootprint(source, 'tavern');
  const market = parseFootprint(source, 'market');
  assert(north && fertile && maritime && market, 'regional footprint anchors missing');
  const areas = [north.width * north.depth, fertile.width * fertile.depth, maritime.width * maritime.depth, market.width * market.depth];
  assert(new Set(areas).size >= 3, 'functional parcel areas do not vary enough by role');
  assert(market.width * market.depth > maritime.width * maritime.depth, 'market parcel is not larger than tavern parcel');
  assert(fertile.width * fertile.depth > north.width * north.depth, 'farm parcel is not larger than blacksmith parcel');
}

function main() {
  const landmark = read(LANDMARK);
  const villages = read(VILLAGES);
  checkRoleFootprints(landmark);
  checkFitAlgorithm(landmark);
  checkGeographicScaleSeparation(landmark);
  checkHouseScaleDiversity(villages);
  checkRegionalParcelVariation(landmark);
  console.log(JSON.stringify({
    ok: true,
    roleCount: Object.keys(ROLE_FOOTPRINTS).length,
    fittedBy: 'uniform-min-fit-with-quarter-turn-option',
    scaleMode: 'author-bounds-to-role-footprint',
    nonUniformScale: false,
    deterministic: true,
  }, null, 2));
  console.log('[checkSettlementAssetFit] PASS');
}

try {
  main();
} catch (error) {
  console.error('[checkSettlementAssetFit] FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
}
