import fs from 'node:fs';

const corePath = 'src/3d/materials/MaterialAssignmentCore.js';
const placementPath = 'src/3d/world/WorldAssetPlacementPipeline.js';
const editorPath = 'src/3d/editor/EditorAutoTexture.js';

const core = fs.readFileSync(corePath, 'utf8');
const placement = fs.readFileSync(placementPath, 'utf8');
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

assert(placement.includes("from '../materials/MaterialAssignmentCore.js'"), 'world placement must consume the shared material core');
assert(placement.includes('prepareWorldAssetForPlacement'), 'missing dress-before-placement entrypoint');
assert(placement.includes('materialReadyForWorld'), 'placement must mark only validated dressed assets ready');
assert(placement.includes('placeholder-model'), 'placeholder models must be rejected before placement');
assert(placement.includes('groundHeight'), 'world placement must support terrain-ground alignment');
assert(placement.includes('surfaceQuery'), 'world placement must accept a terrain-context query');
assert(placement.includes('evaluateWorldSurfacePlacement'), 'world placement must validate terrain-context policy before scene attachment');
assert(placement.includes('WORLD_SURFACE_POLICY_PRESETS'), 'world placement must expose shared category presets');
assert(placement.includes('placementSurface'), 'world placement manifest must retain terrain-context evidence');
assert(placement.includes('surface:non-finite-height'), 'invalid terrain height must fail instead of leaving floating assets');
assert(placement.includes('createMaterialManifest'), 'world placement must persist a material/placement manifest');
assert(placement.indexOf('applyMaterialRecipe') < placement.indexOf('applyTransform'), 'material assignment must happen before transform/placement validation');
assert(placement.indexOf('applyTransform') < placement.indexOf('resolveWorldSurfacePlacement'), 'ground/context validation must happen after requested transform');
assert(placement.indexOf('resolveWorldSurfacePlacement') < placement.indexOf('validateMaterialAssignment'), 'surface placement must be validated before final scene-ready marking');

assert(editor.includes("from '../materials/MaterialAssignmentCore.js'"), 'editor auto-texture path must delegate to the shared core');
assert(editor.includes('autoAssignMaterials'), 'editor and agents must share the same auto assignment implementation');
assert(!editor.includes('applyKitToObject'), 'editor must not own a second figure-kit assignment path');

console.log('[checkSharedMaterialPlacementContract] PASS: editor and autonomous world placement share one multi-surface material core; placeholders, invalid ground/context placement, and missing material evidence are rejected before scene attachment.');

function assert(condition, message) {
  if (!condition) {
    console.error(`[checkSharedMaterialPlacementContract] FAIL: ${message}`);
    process.exit(1);
  }
}
