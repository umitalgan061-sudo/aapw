import fs from 'node:fs';

const requiredFiles = [
  'editor.html',
  'editor.css',
  'src/3d/editor/worldEditor.js',
  'src/3d/editor/editorAssetLibrary.js',
  'src/3d/editor/EditorAssetManager.js',
  'src/3d/editor/EditorInstanceManager.js',
  'src/3d/editor/EditorSceneSerializer.js',
  'scenes/westeros-world.example.json',
  'WORLD_EDITOR_README.md'
];

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) throw new Error(`World Editor dosyası eksik: ${file}`);
}

const html = fs.readFileSync('editor.html', 'utf8');
const worldEditor = fs.readFileSync('src/3d/editor/worldEditor.js', 'utf8');
const assetManager = fs.readFileSync('src/3d/editor/EditorAssetManager.js', 'utf8');
const instanceManager = fs.readFileSync('src/3d/editor/EditorInstanceManager.js', 'utf8');
const library = fs.readFileSync('src/3d/editor/editorAssetLibrary.js', 'utf8');
const example = JSON.parse(fs.readFileSync('scenes/westeros-world.example.json', 'utf8'));

const requiredHtmlIds = ['we-canvas', 'we-grid-toggle', 'we-snap-toggle', 'we-snap-size', 'we-hierarchy', 'we-inspector', 'we-create-formation', 'we-load-file'];
for (const id of requiredHtmlIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`Editor HTML kontrolü eksik: ${id}`);
}
if (!html.includes('three/addons/')) throw new Error('Editor importmap local Three.js addons yolunu içermiyor.');
if (!assetManager.includes('GLTFLoader') || !assetManager.includes('FBXLoader')) throw new Error('GLB/FBX loader desteği eksik.');
if (!instanceManager.includes('THREE.InstancedMesh')) throw new Error('InstancedMesh desteği eksik.');
if (!worldEditor.includes("snapEnabled") || !worldEditor.includes("gridVisible")) throw new Error('Grid/Snap bağımsız state kontratı eksik.');
if (!library.includes("format: 'glb'") || !library.includes("format: 'fbx'")) throw new Error('Asset library GLB+FBX örneği içermiyor.');
if (example.schemaVersion !== 1 || !Array.isArray(example.objects) || !Array.isArray(example.instanceGroups)) throw new Error('Örnek scene JSON kontratı geçersiz.');

console.log('PASS World Editor foundation: HTML/CSS/JS + GLB/FBX + selection/inspector + grid/snap + JSON + InstancedMesh contracts present.');
