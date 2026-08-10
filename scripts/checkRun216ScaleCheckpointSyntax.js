import fs from 'node:fs';

for (const path of [
  'src/3d/editor/EditorScaleInputController.js',
  'scripts/checkRun216ScaleInputPrecision.js',
  'scripts/checkRun216LargeAssetScalePolicy.js',
  'scripts/checkRun216ScaleInputPrecisionBranchContract.js'
]) {
  if (!fs.existsSync(path)) throw new Error(`Run216 scale checkpoint file missing: ${path}`);
}

console.log('PASS Run216 scale checkpoint syntax inventory.');
