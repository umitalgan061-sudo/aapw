import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mapping = '    "./src/3d/world/terrain.js": "./src/3d/world/currentTerrainAdapter.js"';
const anchor = '    "three/addons/": "./src/3d/vendor/three/addons/"';

for (const relative of ['game3d.html', 'editor.html']) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8');
  if (before.includes(mapping.trim())) continue;
  if (!before.includes(anchor)) throw new Error(`${relative}: import-map anchor missing`);
  const after = before.replace(anchor, `${anchor},\n${mapping}`);
  if (after === before) throw new Error(`${relative}: current terrain mapping was not materialized`);
  fs.writeFileSync(file, after);
  console.log(`CURRENT_TERRAIN_MATERIALIZED=${relative}`);
}

const serviceWorkerFile = path.join(root, 'service-worker.js');
const serviceWorkerBefore = fs.readFileSync(serviceWorkerFile, 'utf8');
const offlineEntries = Object.freeze([
  './src/3d/world/currentTerrainAdapter.js',
  './src/3d/world/currentTerrainRuntime.js',
]);
if (!offlineEntries.every((entry) => serviceWorkerBefore.includes(entry))) {
  const marker = '// Run339 pause-menu offline shell extension';
  if (!serviceWorkerBefore.includes(marker)) throw new Error('service-worker current-terrain insertion marker missing');
  const block = `// Current full-map terrain single-source offline shell extension.\nself.addEventListener('install', () => {\n    GAME3D_SHELL_FILES.push('./src/3d/world/currentTerrainAdapter.js');\n    GAME3D_SHELL_FILES.push('./src/3d/world/currentTerrainRuntime.js');\n});\n\n`;
  fs.writeFileSync(serviceWorkerFile, serviceWorkerBefore.replace(marker, `${block}${marker}`));
  console.log('CURRENT_TERRAIN_MATERIALIZED=service-worker.js');
}
