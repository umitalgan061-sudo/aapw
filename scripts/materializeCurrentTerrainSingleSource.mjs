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

const configFile = path.join(root, 'src/3d/config.js');
let config = fs.readFileSync(configFile, 'utf8');
const configReplacements = Object.freeze([
  ['METERS_PER_MAP_UNIT: 1.75,', 'METERS_PER_MAP_UNIT: 1.477342100713197,'],
  ['MAP_BOUNDS: Object.freeze({ minX: 120, maxX: 6990, minY: 0, maxY: 6170 }),', 'MAP_BOUNDS: Object.freeze({ minX: 0, maxX: 9000, minY: 0, maxY: 7000 }),'],
  ['WORLD_WIDTH_METERS: 12022.5,', 'WORLD_WIDTH_METERS: 13296.078906418774,'],
  ['WORLD_DEPTH_METERS: 10797.5,', 'WORLD_DEPTH_METERS: 10341.394704992379,'],
  ['GRID_COLUMNS: 25,', 'GRID_COLUMNS: 27,'],
  ['GRID_ROWS: 22,', 'GRID_ROWS: 21,'],
]);
let configChanged = false;
for (const [before, after] of configReplacements) {
  if (config.includes(after)) continue;
  if (!config.includes(before)) throw new Error(`config full-map extent anchor missing: ${before}`);
  config = config.replace(before, after);
  configChanged = true;
}
if (configChanged) {
  fs.writeFileSync(configFile, config);
  console.log('CURRENT_TERRAIN_MATERIALIZED=src/3d/config.js');
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

const oldMime = "const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };";
const currentMime = "const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };";
for (const relative of ['scripts/terrainSeatSafetyCheck.js', 'scripts/roadNetworkSafetyCheck.js']) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8');
  if (before.includes(currentMime)) continue;
  if (!before.includes(oldMime)) throw new Error(`${relative}: browser MIME anchor missing`);
  fs.writeFileSync(file, before.replace(oldMime, currentMime));
  console.log(`CURRENT_TERRAIN_MATERIALIZED=${relative}`);
}
