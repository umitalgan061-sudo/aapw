import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync('src/3d/world/photorealismSceneIntegration.ts', 'utf8');
assert.match(source, /createPhotorealismRuntimeController/);
assert.match(source, /applyPhotorealismToSceneTargets/);
assert.match(source, /RuntimeTarget/);
assert.doesNotMatch(source, /EditorMaterialStudio/);
assert.doesNotMatch(source, /document\.|window\.|GeoCell|Pindex/);
console.log('Photorealism scene integration contract: PASS');
