import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager = fs.readFileSync('src/3d/editor/EditorAssetManager.js', 'utf8');
const palette = fs.readFileSync('src/3d/editor/EditorFallbackMaterialPalette.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');

assert.match(manager, /import \{ applyEditorFallbackMaterialPalette \} from '\.\/EditorFallbackMaterialPalette\.js';/);
assert.match(manager, /applyEditorFallbackMaterialPalette\(object, asset\);/);
assert.match(palette, /asset\?\.format !== 'fbx'/, 'fallback palette must remain FBX-only');
assert.match(palette, /material\.map \|\| material\.vertexColors/, 'textured and vertex-colored materials must be preserved');
assert.match(serviceWorker, /'\.\/src\/3d\/editor\/EditorFallbackMaterialPalette\.js'/, 'fallback palette module must remain in offline shell');

const importIndex = manager.indexOf('applyEditorFallbackMaterialPalette(object, asset);');
const traversalIndex = manager.indexOf('object.traverse((child) => {', importIndex);
assert.ok(importIndex >= 0 && traversalIndex > importIndex, 'palette must apply before editor mesh traversal/ownership wiring');

console.log('Run259 Editor fallback material integration PASS');
