#!/usr/bin/env node
/**
 * Asset-first settlement audit.
 *
 * The rule is deliberately broader than the six functional landmark assets: before expanding the
 * world with additional settlement art, the repository's existing model families are inventoried
 * and the runtime assignment layer is checked against those sources. This prevents a well-written
 * placement algorithm from quietly falling back to decorative boxes or one generic brown material.
 *
 * The audit is deterministic and read-only. It never modifies source assets and never hydrates the
 * entire LFS repository. Hydration remains selective in CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = Object.freeze([
  'assets/models/settlements',
  'assets/models/houses',
  'assets/models/props',
  'assets/models/fbx',
  'assets/textures',
  'assets/audio',
  'assets/particles',
  'assets/shaders',
]);

const FUNCTIONAL_ROLES = Object.freeze([
  'blacksmith',
  'barracks',
  'farm',
  'stable',
  'tavern',
  'market',
]);

const SEMANTIC_MATERIAL_TOKENS = Object.freeze([
  'stone',
  'brick',
  'wood',
  'timber',
  'door',
  'window',
  'glass',
  'metal',
  'iron',
  'roof',
  'thatch',
  'plaster',
]);

const MODEL_EXTENSIONS = new Set(['.glb', '.gltf', '.fbx', '.blend', '.obj', '.dae']);
const TEXTURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.basis']);
const SOURCE_ASSET_MIN_BYTES = 4096;

function fail(message) { throw new Error(message); }
function expect(value, message) { if (!value) fail(message); }
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8'); }

function walk(directory) {
  const absolute = path.join(ROOT, directory);
  if (!fs.existsSync(absolute)) return [];
  const entries = fs.readdirSync(absolute, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(relative));
    else result.push(relative);
  }
  return result;
}

function inventoryAssets() {
  const files = SOURCE_DIRS.flatMap(walk);
  const models = files.filter((file) => MODEL_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const textures = files.filter((file) => TEXTURE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const sourceBytes = new Map();
  const pointerCandidates = [];
  const emptyFiles = [];
  for (const file of files) {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute)) continue;
    const size = fs.statSync(absolute).size;
    sourceBytes.set(file, size);
    if (MODEL_EXTENSIONS.has(path.extname(file).toLowerCase()) && size <= SOURCE_ASSET_MIN_BYTES) pointerCandidates.push(`${file} (${size} bytes)`);
    if (size === 0) emptyFiles.push(file);
  }
  return Object.freeze({ files, models, textures, sourceBytes, pointerCandidates, emptyFiles });
}

function extractFunctionalAssetPaths() {
  const source = read('src/3d/world/settlementFunctionalLandmarks.js');
  return [...new Set([...source.matchAll(/['\"](assets\/models\/(?:settlements|fbx)\/[^'\"]+\.(?:glb|fbx))['\"]/g)].map((match) => match[1]))];
}

function checkFunctionalSources(inventory) {
  const referenced = extractFunctionalAssetPaths();
  expect(referenced.length >= 10, `expected at least 10 functional source assets, got ${referenced.length}`);
  const missing = [];
  const pointers = [];
  for (const file of referenced) {
    const absolute = path.join(ROOT, file);
    if (!fs.existsSync(absolute)) missing.push(file);
    else if (fs.statSync(absolute).size <= SOURCE_ASSET_MIN_BYTES) pointers.push(`${file} (${fs.statSync(absolute).size} bytes)`);
  }
  expect(missing.length === 0, `functional assignment references missing source files:\n${missing.join('\n')}`);
  expect(pointers.length === 0, `functional assignment references unhydrated LFS model files:\n${pointers.join('\n')}`);
  for (const file of referenced) expect(inventory.sourceBytes.has(file), `functional source missing from asset inventory: ${file}`);
  return referenced;
}

function checkAssetFamilyDiversity(inventory) {
  expect(inventory.models.length >= 20, `settlement asset-family inventory is unexpectedly small: ${inventory.models.length} models`);
  const byFamily = Object.fromEntries(SOURCE_DIRS.slice(0, 4).map((directory) => [directory, inventory.models.filter((file) => file.startsWith(`${directory}/`))]));
  expect(byFamily['assets/models/settlements'].length >= 10, 'settlement family lacks enough authored model sources');
  expect(byFamily['assets/models/houses'].length >= 3, 'house family lacks regional source diversity');
  expect(byFamily['assets/models/props'].length >= 3, 'prop family is empty; settlement UX should not become building-only');
  expect(byFamily['assets/models/fbx'].some((file) => /market/i.test(file)), 'market FBX source family is missing');
  const extensions = new Set(inventory.models.map((file) => path.extname(file).toLowerCase()));
  expect(extensions.size >= 2, 'asset inventory collapsed to one model format');
  return byFamily;
}

function checkModelTokenCoverage(inventory) {
  const namedModels = inventory.models.filter((file) => /settlement|house|cabin|barn|market|blacksmith|barracks|stable|tavern|inn|door|chest|stall|forge|smith/i.test(file));
  expect(namedModels.length >= 18, `named settlement model coverage is too small: ${namedModels.length}`);
  const tokenCoverage = Object.fromEntries(SEMANTIC_MATERIAL_TOKENS.map((token) => [token, namedModels.filter((file) => file.toLowerCase().includes(token)).length]));
  return tokenCoverage;
}

function checkRuntimeMaterialSurfaceLanguage() {
  const source = read('src/3d/world/settlementFunctionalLandmarks.js').toLowerCase();
  const covered = SEMANTIC_MATERIAL_TOKENS.filter((token) => source.includes(token));
  expect(covered.length >= 9, `functional runtime exposes too few semantic material surface tokens: ${covered.length}`);
  expect(source.includes('mode: \'layers\''), 'single-surface fallback does not use layered material recipe');
  expect(source.includes('mode: \'surface\''), 'multi-surface imported models lack semantic surface override path');
  expect(source.includes('textureSize: functional_landmark_texture_size'), 'functional material evidence lacks texture size');
  expect(source.includes('analyzematerialsurfaces'), 'source material analysis is not referenced');
  return covered;
}

function checkPlacementContractLanguage() {
  const source = read('src/3d/world/settlementFunctionalLandmarks.js');
  const pipeline = read('src/3d/world/WorldAssetPlacementPipeline.js');
  const core = read('src/3d/materials/MaterialAssignmentCore.js');
  expect(source.includes('requireSurfaceContext: true'), 'functional buildings do not require world surface context');
  expect(source.includes("footprintGrounding: 'always'"), 'functional buildings do not request footprint grounding');
  expect(source.includes('foundationInsetMeters'), 'functional buildings do not record foundation inset policy');
  expect(source.includes('placement.manifest'), 'functional evidence does not persist placement manifest');
  expect(pipeline.includes('createMaterialManifest'), 'placement pipeline no longer emits material manifest');
  expect(core.includes('validateMaterialAssignment'), 'material core no longer validates assignment');
}

function checkSourceMutationSafety() {
  const landmarkSource = read('src/3d/world/settlementFunctionalLandmarks.js');
  expect(!/writeFileSync|rmSync|unlinkSync|renameSync/.test(landmarkSource), 'runtime landmark module must never mutate source assets');
  expect(!landmarkSource.includes('assets/models/settlements/').includes('derived'), 'source asset references must remain authored paths');
}

function buildRegionalAssetMatrix(inventory) {
  const files = inventory.models.map((file) => file.toLowerCase());
  return Object.freeze({
    north: Object.freeze({ cold: files.filter((file) => /log|cabin|barracks|fort|snow|ice/.test(file)).length, total: files.length }),
    fertile: Object.freeze({ agricultural: files.filter((file) => /barn|farm|house|market|shed/.test(file)).length, total: files.length }),
    maritime: Object.freeze({ coastal: files.filter((file) => /dock|boat|wood|market|house|cabin/.test(file)).length, total: files.length }),
    arid: Object.freeze({ dry: files.filter((file) => /desert|sand|stone|market|stable|house/.test(file)).length, total: files.length }),
    mountain: Object.freeze({ rugged: files.filter((file) => /stone|rock|brick|forge|blacksmith|stable/.test(file)).length, total: files.length }),
    temperate: Object.freeze({ rural: files.filter((file) => /cottage|house|market|tavern|barn/.test(file)).length, total: files.length }),
    volcanic: Object.freeze({ harsh: files.filter((file) => /rock|stone|brick|iron|blacksmith|barracks/.test(file)).length, total: files.length }),
  });
}

function main() {
  const inventory = inventoryAssets();
  expect(inventory.pointerCandidates.length === 0, `unhydrated source models remain in settlement asset families:\n${inventory.pointerCandidates.join('\n')}`);
  expect(inventory.emptyFiles.length === 0, `empty source assets found:\n${inventory.emptyFiles.join('\n')}`);
  const referenced = checkFunctionalSources(inventory);
  const family = checkAssetFamilyDiversity(inventory);
  const tokenCoverage = checkModelTokenCoverage(inventory);
  const surfaceTokens = checkRuntimeMaterialSurfaceLanguage();
  checkPlacementContractLanguage();
  checkSourceMutationSafety();
  const regional = buildRegionalAssetMatrix(inventory);

  console.log(JSON.stringify({
    ok: true,
    functionalSourceCount: referenced.length,
    modelCount: inventory.models.length,
    textureCount: inventory.textures.length,
    modelFamilyCounts: Object.fromEntries(Object.entries(family).map(([key, value]) => [key, value.length])),
    semanticModelTokenCoverage: tokenCoverage,
    runtimeMaterialSurfaceTokens: surfaceTokens,
    regionalSourceSignals: regional,
    lfsPointerModelCount: inventory.pointerCandidates.length,
    emptySourceCount: inventory.emptyFiles.length,
  }, null, 2));
  console.log('[checkSettlementAssetFamilyAudit] PASS');
}

try { main(); } catch (error) {
  console.error('[checkSettlementAssetFamilyAudit] FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
}
