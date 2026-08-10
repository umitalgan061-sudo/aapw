import {
  computeEditorAssetImportScale,
  EDITOR_ASSET_SCALE_POLICY
} from '../src/3d/editor/EditorAssetScalePolicy.js';

const cases = Object.freeze([
  { id: 'black-dragon', maxDimension: 160, expectedScale: 0.05, expectedTarget: 8 },
  { id: 'paladin', maxDimension: 200, expectedScale: 0.01, expectedTarget: 2 },
  { id: 'peasant-girl', maxDimension: 180, expectedScale: 0.01, expectedTarget: 1.8 }
]);

for (const entry of cases) {
  const actual = computeEditorAssetImportScale({ id: entry.id, format: 'glb' }, entry.maxDimension);
  if (Math.abs(actual - entry.expectedScale) > 1e-12) {
    throw new Error(`${entry.id} oversized import scale mismatch: expected ${entry.expectedScale}, got ${actual}`);
  }
  const target = EDITOR_ASSET_SCALE_POLICY.targetMaxDimensionByAsset[entry.id];
  if (target !== entry.expectedTarget) {
    throw new Error(`${entry.id} target dimension mismatch: expected ${entry.expectedTarget}, got ${target}`);
  }
}

const explicit = computeEditorAssetImportScale({ id: 'custom', format: 'fbx', targetMaxDimension: 1.5 }, 150);
if (Math.abs(explicit - 0.01) > 1e-12) throw new Error(`explicit target scaling mismatch: ${explicit}`);

const alreadyReasonable = computeEditorAssetImportScale({ id: 'black-dragon', format: 'glb' }, 20);
if (alreadyReasonable !== 1) throw new Error(`non-oversized import should remain untouched: ${alreadyReasonable}`);

const tinyManualScale = 0.001;
for (const entry of cases) {
  const normalized = computeEditorAssetImportScale({ id: entry.id, format: 'glb' }, entry.maxDimension);
  if (!(normalized * tinyManualScale > 0 && normalized * tinyManualScale < normalized)) {
    throw new Error(`${entry.id} must remain shrinkable below normalized import scale`);
  }
}

console.log('PASS Run216 large asset scale policy: oversized dragon/human imports normalize deterministically and remain shrinkable.');
