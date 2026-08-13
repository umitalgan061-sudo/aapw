import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}

const settings = JSON.parse(read('.vscode/settings.json'));
if (settings['liveServer.settings.root'] !== '/') throw new Error('Live Server root must remain workspace root');
if (settings['liveServer.settings.file'] !== 'live3d.html') throw new Error('Live Server must boot live3d.html');
if (settings['liveServer.settings.fullReload'] !== true) throw new Error('Live Server fullReload must be enabled');

const live3d = read('live3d.html');
const game3d = read('game3d.html');
const editor = read('editor.html');
const bridge = read('src/3d/editor/EditorLiveWorldBridge.js');

for (const [html, label] of [[live3d, 'live3d'], [game3d, 'game3d']]) {
  requireText(html, 'id="game3d-canvas"', label);
  requireText(html, "installRuntimePindexTerrainPolish", label);
  requireText(html, "initGame3D", label);
  requireText(html, "./src/3d/world/worldReferenceSurfaceTerrainVisual.js", label);
  requireText(html, "./src/3d/game3d.js", label);
}

requireText(live3d, '__WESTEROS_LIVE_SERVER_3D__', 'live3d');
requireText(editor, './src/3d/editor/EditorLiveWorldBridge.js', 'editor');
requireText(bridge, "import { installRuntimePindexTerrainPolish } from '../world/worldReferenceSurfaceTerrainVisual.js';", 'EditorLiveWorldBridge');
requireText(bridge, 'installRuntimePindexTerrainPolish();', 'EditorLiveWorldBridge');
requireText(bridge, 'const liveState = createScene(offscreenCanvas);', 'EditorLiveWorldBridge');
requireText(bridge, 'if (editorGround) editorGround.visible = false;', 'EditorLiveWorldBridge');
requireText(bridge, 'runtimeTerrainPolishInstalled: true', 'EditorLiveWorldBridge');

if (bridge.indexOf('installRuntimePindexTerrainPolish();') > bridge.indexOf('const liveState = createScene(offscreenCanvas);')) {
  throw new Error('Editor terrain polish must install before createScene loads terrain chunks');
}

console.log('LIVE_SERVER_CURRENT_3D_OK');
console.log(JSON.stringify({
  liveServerEntry: settings['liveServer.settings.file'],
  live3dUsesCurrentRuntime: true,
  editorUsesCurrentRuntime: true,
  editorSyntheticGroundHidden: true
}));
