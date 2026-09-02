import fs from 'node:fs';

const corePath = 'src/3d/materials/MaterialAssignmentCore.js';
const placementPath = 'src/3d/world/WorldAssetPlacementPipeline.js';
const placementCorePath = 'src/3d/world/WorldAssetPlacementPipelineCore.js';
const editorPath = 'src/3d/editor/EditorAutoTexture.js';

const core = fs.readFileSync(corePath, 'utf8');
const placement = fs.readFileSync(placementPath, 'utf8');
const placementCore = fs.readFileSync(placementCorePath, 'utf8');
const placementCombined = `${placement}\n${placementCore}`;
const editor = fs.readFileSync(editorPath, 'utf8');

const requiredCoreExports = [
  'describeMaterialSubject',
  'analyzeMaterialSurfaces',
  'buildAutoMaterialRecipe',
  'buildRecommendedLayerRecipe',
  'applyMaterialRecipe',
  'autoAssignMaterials',
  'restoreOriginalMaterials',
  'validateMaterialAssignment',
  'createMaterialManifest',
];
for (const name of requiredCoreExports) {
  assert(core.includes(`export function ${name}`), `missing shared core export: ${name}`);
}

assert(core.includes("from './meshPartClassifier.js'"), 'shared core must classify real mesh/material slots');
assert(core.includes('applyKitToObject'), 'shared core must use the existing figure-kit texture pipeline');
assert(core.includes("mode === 'surface'"), 'shared core must support per-material-slot recipes');
assert(core.includes("mode === 'layers'"), 'shared core must support single-mesh layered recipes');
assert(core.includes('generatedMaterialCount'), 'shared core must expose material validation evidence');
assert(core.includes('worldPlacementManifest') === false, 'material core must remain world-placement agnostic');

assert(placement.includes("export * from './WorldAssetPlacementPipelineCore.js'"), 'world placement facade must preserve every established core export');
assert(placement.includes("import * as Core from './WorldAssetPlacementPipelineCore.js'"), 'world placement facade must delegate grounding to preserved core');
assert(placementCore.includes("from '../materials/MaterialAssignmentCore.js'"), 'world placement core must consume the shared material core');
assert(placementCombined.includes('prepareWorldAssetForPlacement'), 'missing dress-before-placement entrypoint');
assert(placementCombined.includes('materialReadyForWorld'), 'placement must mark only validated dressed assets ready');
assert(placementCore.includes('placeholder-model'), 'placeholder models must be rejected before placement');
assert(placementCore.includes('groundHeight'), 'world placement must support terrain-ground alignment');
assert(placementCore.includes('createMaterialManifest'), 'world placement must persist a material/placement manifest');
assert(placementCore.indexOf('applyMaterialRecipe') < placementCore.indexOf('applyTransform'), 'material assignment must happen before transform/placement validation');
assert(placement.includes('resolveWorldAssetGeographicProfile'), 'placement facade must add canonical geographic presentation profile');
assert(placement.includes('applyWorldAssetGeographicWeathering'), 'placement facade must weather validated materials after core grounding');
assert(placement.includes('authoredStructurePlacementUnchanged: true'), 'geographic facade must protect authored structures');

assert(editor.includes("from '../materials/MaterialAssignmentCore.js'"), 'editor auto-texture path must delegate to the shared core');
assert(editor.includes('autoAssignMaterials'), 'editor and agents must share the same auto assignment implementation');
assert(!editor.includes('applyKitToObject'), 'editor must not own a second figure-kit assignment path');

console.log('[checkSharedMaterialPlacementContract] PASS: preserved placement core + geographic facade share one material core, retain grounding order and add canonical render adaptation before attachment.');

function assert(condition, message) {
  if (!condition) {
    console.error(`[checkSharedMaterialPlacementContract] FAIL: ${message}`);
    process.exit(1);
  }
}
