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
  './src/3d/renderQuality.js',
  './src/3d/world/g01Terrain3dRuntimeAdapter.js',
  './assets/models/animals/white_horse_bEdE4rmZy9.glb',
  './assets/models/animals/cow_26zM1outCr.glb',
  './assets/models/animals/bull_a8PIIYwF7r.glb',
  './assets/models/animals/deer_T6Cs7tmMHJ.glb',
  './assets/models/animals/stag_tQdzbZ1Cmw.glb',
  './assets/models/animals/fox_Bc97C66HKi.glb',
  './assets/models/animals/husky_wcWiuEqwzq.glb',
  './assets/models/animals/alpaca_bCVFD48i2l.glb',
  './assets/models/animals/zebra_iclPBR6SBZ.glb',
  './assets/models/animals/sheep_C39AUXUUes.glb',
]);
const missingOfflineEntries = offlineEntries.filter((entry) => !serviceWorkerBefore.includes(entry));
if (missingOfflineEntries.length > 0) {
  const marker = '// Run339 pause-menu offline shell extension';
  if (!serviceWorkerBefore.includes(marker)) throw new Error('service-worker current-terrain insertion marker missing');
  const pushes = missingOfflineEntries.map((entry) => `    GAME3D_SHELL_FILES.push('${entry}');`).join('\n');
  const block = `// Current 3D runtime offline dependency completion.\nself.addEventListener('install', () => {\n${pushes}\n});\n\n`;
  fs.writeFileSync(serviceWorkerFile, serviceWorkerBefore.replace(marker, `${block}${marker}`));
  console.log(`CURRENT_TERRAIN_MATERIALIZED=service-worker.js:${missingOfflineEntries.length}-offline-dependencies`);
}

const oldMime = "const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };";
const currentMime = "const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };";
const safetyFiles = ['scripts/terrainSeatSafetyCheck.js', 'scripts/roadNetworkSafetyCheck.js'];
for (const relative of safetyFiles) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8');
  if (before.includes(currentMime)) continue;
  if (!before.includes(oldMime)) throw new Error(`${relative}: browser MIME anchor missing`);
  fs.writeFileSync(file, before.replace(oldMime, currentMime));
  console.log(`CURRENT_TERRAIN_MATERIALIZED=${relative}`);
}

const oldNavigation = "await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });";
const currentNavigation = "await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });";
for (const relative of safetyFiles) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, 'utf8');
  if (before.includes(currentNavigation)) continue;
  if (!before.includes(oldNavigation)) throw new Error(`${relative}: browser navigation timeout anchor missing`);
  fs.writeFileSync(file, before.replace(oldNavigation, currentNavigation));
  console.log(`CURRENT_TERRAIN_MATERIALIZED=${relative}:navigation-timeout`);
}
