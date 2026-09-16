#!/usr/bin/env node
/**
 * Static geography coverage audit for the settlement runtime.
 *
 * This gate intentionally checks the existing source-of-truth modules rather than rebuilding the
 * settlement system in a test. It catches the regressions most likely to make a geographically
 * plausible map feel artificial: region/role drift, one-surface material recipes, missing road and
 * ground inputs, unsupported runtime editor imports, and asset paths that have fallen out of the
 * repository.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VILLAGES = path.join(ROOT, 'src/3d/world/villages.js');
const LANDMARKS = path.join(ROOT, 'src/3d/world/settlementFunctionalLandmarks.js');
const TERRAIN = path.join(ROOT, 'src/3d/world/terrain.js');
const ROADS = path.join(ROOT, 'src/3d/world/roads.js');
const GROUNDING = path.join(ROOT, 'src/3d/world/structureGroundingPolicy.js');
const MATERIALS = path.join(ROOT, 'src/3d/materials/MaterialAssignmentCore.js');
const PLACEMENT = path.join(ROOT, 'src/3d/world/WorldAssetPlacementPipeline.js');
const PALETTES = path.join(ROOT, 'src/3d/materials/palettes.js');

const REGIONS = Object.freeze(['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic']);
const ROLES = Object.freeze(['blacksmith', 'barracks', 'farm', 'stable', 'tavern', 'market']);
const ROLE_REQUIREMENTS = Object.freeze({
  blacksmith: Object.freeze({ service: 'smithing', action: 'smithing', mustBeOuter: true, roadOptional: true }),
  barracks: Object.freeze({ service: 'barracks', action: 'watch', mustBeOuter: true, roadOptional: true }),
  farm: Object.freeze({ service: 'farm', action: 'farm', mustBeOuter: true, roadOptional: true }),
  stable: Object.freeze({ service: 'stable', action: 'mount', mustBeOuter: true, roadOptional: true }),
  tavern: Object.freeze({ service: 'tavern', action: 'rest', mustBeOuter: false, roadOptional: false }),
  market: Object.freeze({ service: 'market', action: 'trade', mustBeOuter: false, roadOptional: false }),
});

function source(file) { return fs.readFileSync(file, 'utf8'); }
function fail(message) { throw new Error(message); }
function expect(condition, message) { if (!condition) fail(message); }

function extractObjectBlock(text, marker) {
  const start = text.indexOf(marker);
  if (start < 0) return null;
  let depth = 0;
  let started = false;
  let quote = null;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '\"' || char === "'") { quote = char; continue; }
    if (char === '{') { depth += 1; started = true; }
    else if (char === '}' && started) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function count(text, pattern) { return (text.match(pattern) || []).length; }

function extractAssetPaths(text) {
  return [...new Set([...text.matchAll(/['\"](assets\/models\/(?:settlements|fbx)\/[^'\"]+\.(?:glb|fbx))['\"]/g)].map((match) => match[1]))];
}

function checkSourceBoundaries() {
  const landmarks = source(LANDMARKS);
  const villages = source(VILLAGES);
  const terrain = source(TERRAIN);
  const roads = source(ROADS);
  const grounding = source(GROUNDING);
  const materials = source(MATERIALS);
  const placement = source(PLACEMENT);
  const palettes = source(PALETTES);

  expect(landmarks.includes("../materials/MaterialAssignmentCore.js"), 'functional landmarks bypass MaterialAssignmentCore');
  expect(landmarks.includes('./WorldAssetPlacementPipeline.js'), 'functional landmarks bypass WorldAssetPlacementPipeline');
  expect(landmarks.includes('analyzeMaterialSurfaces'), 'functional landmarks do not inspect source material surfaces');
  expect(landmarks.includes('placeWorldAsset'), 'functional landmarks do not use shared placement entrypoint');
  expect(!landmarks.includes('EditorMaterialStudio.js'), 'EditorMaterialStudio leaked into runtime');
  expect(!/new THREE\.(BoxGeometry|ConeGeometry|CylinderGeometry|SphereGeometry)\b/.test(landmarks), 'functional landmarks use primitive decorative geometry');

  expect(villages.includes('villageHamletCenters'), 'villages do not publish hamlet centres');
  expect(villages.includes('villageHouses'), 'villages do not publish residential clearance inputs');
  expect(villages.includes('scheduleFunctionalSettlementLandmarks'), 'functional landmark layer is not scheduled by villages');
  expect(villages.includes('roadEdges'), 'village geography does not consume existing road context');
  expect(villages.includes('sampleHeightMeters'), 'village geography does not consume terrain height authority');
  expect(villages.includes('seaLevelMeters'), 'village geography does not consume sea-level authority');

  expect(terrain.includes('sampleHeightMeters'), 'terrain height sampler missing');
  expect(roads.includes('roadEdges') || roads.includes('createRoad'), 'roads source lacks authored road graph entrypoint');
  expect(grounding.includes('footprint'), 'grounding policy lacks footprint semantics');
  expect(materials.includes('validateMaterialAssignment'), 'material validation contract missing');
  expect(materials.includes('createMaterialManifest'), 'material manifest contract missing');
  expect(placement.includes('prepareWorldAssetForPlacement'), 'world placement preparation gate missing');
  expect(placement.includes('createMaterialManifest'), 'world placement manifest evidence missing');
  expect(palettes.includes('stone') && palettes.includes('wood'), 'regional palette catalog is incomplete');
}

function checkRegionsAndRoles() {
  const landmarks = source(LANDMARKS);
  for (const region of REGIONS) expect(landmarks.includes(`${region}: Object.freeze([`), `region role definition missing: ${region}`);
  for (const role of ROLES) {
    expect(landmarks.includes(`${role}: Object.freeze({`), `functional role definition missing: ${role}`);
    expect(landmarks.includes(`service: Object.freeze({ kind: '${ROLE_REQUIREMENTS[role].service}'`), `service binding missing for role: ${role}`);
  }
  expect(count(landmarks, /FUNCTIONAL_LANDMARK_MAX_PER_HAMLET/g) >= 4, 'hamlet density policy is not consistently referenced');
  expect(count(landmarks, /FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS/g) >= 3, 'residential clearance policy is not consistently referenced');
  expect(count(landmarks, /FUNCTIONAL_LANDMARK_MIN_SPACING_METERS/g) >= 3, 'functional spacing policy is not consistently referenced');
}

function checkMaterialRecipes() {
  const landmarks = source(LANDMARKS);
  const recipeBlocks = [...landmarks.matchAll(/layers:\s*\[(.*?)\]\s*\}/gs)].map((match) => match[1]);
  expect(recipeBlocks.length >= ROLES.length, `expected at least ${ROLES.length} material layer definitions, got ${recipeBlocks.length}`);
  for (const role of ROLES) {
    const block = extractObjectBlock(landmarks, `${role}: Object.freeze({`);
    expect(block, `cannot parse role material definition: ${role}`);
    expect(block.includes('material: Object.freeze({'), `role missing material definition: ${role}`);
    const layerMatch = block.match(/layers:\s*\[(.*?)\]\s*\)\s*\}/s);
    expect(layerMatch, `role lacks layered material recipe: ${role}`);
    const layerCount = count(layerMatch[1], /palette:/g);
    expect(layerCount >= 3, `${role} layered material recipe must expose >=3 semantic palette bands`);
    expect(block.includes('textureSize') || landmarks.includes('FUNCTIONAL_LANDMARK_TEXTURE_SIZE'), `${role} lacks texture-size evidence`);
  }
}

function checkAssetProvenance() {
  const landmarks = source(LANDMARKS);
  const paths = extractAssetPaths(landmarks);
  expect(paths.length >= 10, `functional source asset catalog unexpectedly small: ${paths.length}`);
  const directories = new Set(paths.map((asset) => asset.split('/').slice(0, 4).join('/')));
  expect(directories.has('assets/models/settlements'), 'settlement GLB source family missing');
  expect(directories.has('assets/models/fbx'), 'authored market FBX source family missing');
  const missing = [];
  const pointers = [];
  for (const asset of paths) {
    const absolute = path.join(ROOT, asset);
    if (!fs.existsSync(absolute)) { missing.push(asset); continue; }
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) missing.push(asset);
    else if (stat.size <= 4096) pointers.push(`${asset} (${stat.size} bytes)`);
  }
  expect(missing.length === 0, `missing authored assets:\n${missing.join('\n')}`);
  expect(pointers.length === 0, `unhydrated LFS assets:\n${pointers.join('\n')}`);
}

function checkGeographyHeuristics() {
  const landmarks = source(LANDMARKS);
  expect(landmarks.includes('roadDistance'), 'road affinity is not part of candidate scoring');
  expect(landmarks.includes('ROLE_DISTANCE_BIAS'), 'role radial distribution policy missing');
  expect(landmarks.includes('REGION_DIRECTION_BIAS'), 'regional orientation bias missing');
  expect(landmarks.includes('nearestHouseDistance'), 'residential clearance helper missing');
  expect(landmarks.includes('nearestLandmarkDistance'), 'inter-landmark spacing helper missing');
  expect(landmarks.includes('slopeDegrees'), 'slope constraint missing from candidate acceptance');
  expect(landmarks.includes('waterDepth'), 'water-depth constraint missing from candidate acceptance');
  expect(landmarks.includes('footprintGrounding'), 'world footprint grounding not requested');
  expect(landmarks.includes('requireSurfaceContext: true'), 'functional landmarks may bypass ground surface context');
}

function checkVillageBridge() {
  const villages = source(VILLAGES);
  expect(/villageGroup\.userData\.villageFunctionalLandmarkPromise/.test(villages), 'functional landmark promise is not exposed for acceptance');
  expect(/villageGroup\.userData\.villageFunctionalLandmarkEvidence/.test(villages) || villages.includes('villageFunctionalLandmarkEvidence'), 'functional landmark evidence is not persisted');
  expect(/disposeFunctionalSettlementLandmarks/.test(villages), 'functional landmark disposal is not wired');
}

function checkInteractionBoundary() {
  const interactions = path.join(ROOT, 'src/3d/gameplay/interaction.js');
  expect(fs.existsSync(interactions), 'existing interaction runtime missing');
  const text = source(interactions);
  expect(text.includes('userData'), 'interaction runtime has no metadata consumption boundary');
  expect(!text.includes('settlementFunctionalInventoryState'), 'functional landmark layer must not own inventory state');
  expect(!text.includes('settlementFunctionalQuestRegistry'), 'functional landmark layer must not own quest registry');
}

function run() {
  checkSourceBoundaries();
  checkRegionsAndRoles();
  checkMaterialRecipes();
  checkAssetProvenance();
  checkGeographyHeuristics();
  checkVillageBridge();
  checkInteractionBoundary();
  console.log(JSON.stringify({
    ok: true,
    regionCount: REGIONS.length,
    roleCount: ROLES.length,
    assetCount: extractAssetPaths(source(LANDMARKS)).length,
    textureSize: 512,
    geographyPolicies: ['road-affinity', 'slope', 'water', 'residential-clearance', 'landmark-spacing', 'role-radial-bias'],
    sharedMaterialPlacement: true,
  }, null, 2));
  console.log('[checkSettlementGeographyCoverage] PASS');
}

try { run(); } catch (error) {
  console.error('[checkSettlementGeographyCoverage] FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
}
