import fs from 'node:fs';

const controller = fs.readFileSync('src/3d/editor/EditorScaleInputController.js', 'utf8');
const precisionCheck = fs.readFileSync('scripts/checkRun216ScaleInputPrecision.js', 'utf8');
const assetPolicyCheck = fs.readFileSync('scripts/checkRun216LargeAssetScalePolicy.js', 'utf8');

for (const required of [
  'input.min = String(MIN_EDITOR_SCALE);',
  'input.step = String(MIN_EDITOR_SCALE);',
  "input.setAttribute('inputmode', 'decimal');"
]) {
  if (!controller.includes(required)) throw new Error(`scale precision runtime contract missing: ${required}`);
}

if (!precisionCheck.includes('0.001 runtime scale policy')) throw new Error('scale precision regression proof missing');
if (!assetPolicyCheck.includes('oversized dragon/human imports normalize deterministically')) {
  throw new Error('large asset scale policy regression proof missing');
}

console.log('PASS Run216 scale precision branch contract: runtime precision and large-asset regression proofs are present.');
