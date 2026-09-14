#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = process.cwd();
const SOURCE_PATH = path.join(ROOT, 'src/3d/world/geographicAmbientCharacterDirector.js');
const MAP_PATH = path.join(ROOT, 'src/3d/world/worldReferenceMap.js');
const ALIGNMENT_PATH = path.join(ROOT, 'src/3d/world/worldReferenceAlignment.js');
const MATERIAL_PATH = path.join(ROOT, 'src/3d/materials/MaterialAssignmentCore.js');
const PLACEMENT_PATH = path.join(ROOT, 'src/3d/world/WorldAssetPlacementPipeline.js');
const SW_PATH = path.join(ROOT, 'service-worker.js');
const failures = [];

const EXPECTED_ASSETS = Object.freeze([
  Object.freeze({ id: 'peasant-girl', src: 'assets/models/characters/peasant_girl.fbx', role: 'settlement-worker' }),
  Object.freeze({ id: 'paladin-j-nordstrom', src: 'assets/models/characters/paladin_j_nordstrom.fbx', role: 'road-guard' }),
  Object.freeze({ id: 'erika-archer', src: 'assets/models/characters/erika_archer.fbx', role: 'frontier-scout' }),
]);

const SOURCE = fs.readFileSync(SOURCE_PATH, 'utf8');
const MAP = fs.readFileSync(MAP_PATH, 'utf8');
const ALIGNMENT = fs.readFileSync(ALIGNMENT_PATH, 'utf8');
const MATERIAL = fs.readFileSync(MATERIAL_PATH, 'utf8');
const PLACEMENT = fs.readFileSync(PLACEMENT_PATH, 'utf8');
const SW = fs.readFileSync(SW_PATH, 'utf8');

const check = (condition, message) => { if (!condition) failures.push(message); };
const countMatches = (text, regex) => [...text.matchAll(regex)].length;

function gitLfsPointerStatus(relativePath) {
  try {
    const blob = execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    return blob.startsWith('version https://git-lfs.github.com/spec') ? 'pointer' : 'materialized';
  } catch {
    return 'unavailable';
  }
}

function run() {
  check(!SOURCE.includes('EditorMaterialStudio.js'), 'runtime director imports EditorMaterialStudio.js');
  check(countMatches(SOURCE, /Math\.random\s*\(/g) === 0, 'runtime director uses Math.random()');
  check(countMatches(SOURCE, /autoAssignMaterials\s*\(/g) >= 1, 'textureless fallback does not use shared autoAssignMaterials');
  check(SOURCE.includes('resolveWorldSurfacePlacement('), 'placement path bypasses WorldAssetPlacementPipeline');
  check(SOURCE.includes('validateMaterialAssignment('), 'material validation is not enforced');
  check(SOURCE.includes('createMaterialManifest('), 'material manifest is not generated');
  check(SOURCE.includes('WORLD_REFERENCE_MAP.sha256'), 'canonical world reference hash is not pinned');
  check(SOURCE.includes('worldXZToNormalizedReference('), 'runtime mapping does not use canonical reference alignment');

  check(MAP.includes("id: 'owner-world-map-2026-08-08'"), 'canonical world map id drifted');
  check(MAP.includes('REFERENCE_BIOME_ZONES'), 'canonical biome zones are unavailable');
  check(ALIGNMENT.includes('mapCanvasWidthUnits: 9000'), '2D map width contract drifted');
  check(ALIGNMENT.includes('mapCanvasHeightUnits: 7000'), '2D map height contract drifted');
  check(MATERIAL.includes('export function validateMaterialAssignment'), 'shared material validation API drifted');
  check(PLACEMENT.includes('export function resolveWorldSurfacePlacement'), 'shared placement API drifted');

  for (const asset of EXPECTED_ASSETS) {
    check(SOURCE.includes(asset.src), `${asset.id} source path missing from director`);
    check(SOURCE.includes(`role: '${asset.role}'`), `${asset.id} role missing from director`);
    check(SW.includes(asset.src), `${asset.src} is not present in the existing service-worker shell graph`);
    check(gitLfsPointerStatus(asset.src) !== 'unavailable', `${asset.src} cannot be resolved through git HEAD`);
  }

  check(SOURCE.includes('desktopBudget: 12'), 'desktop population budget drifted');
  check(SOURCE.includes('mobileBudget: 5'), 'mobile population budget drifted');
  check(SOURCE.includes('showDistanceMeters: 700'), 'ambient show distance drifted');
  check(SOURCE.includes('hideDistanceMeters: 920'), 'ambient hide distance drifted');
  check(SOURCE.includes('minRoadDistanceMeters: 4'), 'road exclusion drifted');
  check(SOURCE.includes('minSettlementDistanceMeters: 88'), 'settlement-core exclusion drifted');
  check(SOURCE.includes('maxSettlementDistanceMeters: 260'), 'settlement binding radius drifted');
  check(SOURCE.includes('maxSlopeDegrees: 24'), 'slope policy drifted');
  check(SOURCE.includes('maxWaterDepthMeters: 0.02'), 'water policy drifted');

  check(SOURCE.includes("assetKey: key"), 'asset-family selection is not persisted in placement record');
  check(SOURCE.includes('biomeId: sample.biomeId || null'), 'canonical biome identity is not persisted in placement record');
  check(SOURCE.includes('settlementDistanceMeters: sample.settlementDistance'), 'settlement distance is not persisted for audit');
  check(SOURCE.includes('roadDistanceMeters: sample.roadDistance'), 'road distance is not persisted for audit');
  check(SOURCE.includes('groundSlopeDegrees: sample.slopeDegrees'), 'ground slope is not persisted for audit');

  const result = {
    policy: 'geographic-ambient-characters-2026-09-07-v2',
    expectedAssets: EXPECTED_ASSETS,
    lfsStatus: Object.fromEntries(EXPECTED_ASSETS.map((asset) => [asset.id, gitLfsPointerStatus(asset.src)])),
    checks: 32,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
}

run();
