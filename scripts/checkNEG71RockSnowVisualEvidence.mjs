#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { buildG71Terrain3DRockSnowProbe, measureG71Terrain3DRockSnow } from '../godot/terrain-authoring/geocells/ne/g71_rock_snow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((v) => v.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/ne-g71-rock-snow-visual');
const requireOk = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const probe = buildG71Terrain3DRockSnowProbe();
const authored = measureG71Terrain3DRockSnow();
requireOk(authored.canonicalSea === 96 && authored.canonicalLand === 0, 'G71 canonical sea drifted');
requireOk(authored.maxRockWeight === 0 && authored.maxSnowWeight === 0 && authored.maxTerrestrialSurfaceMass === 0, 'G71 terrestrial material leaked into sea');
requireOk(probe.rows.flat().every((s) => s[0] === 0 && s[1] === 0 && s[3] === -8 && s[4] === 0), 'G71 Rock/Snow probe drifted');

const playwright = devServerHelper.loadPlaywright();
requireOk(Boolean(playwright), 'Playwright required'); fs.mkdirSync(OUT, { recursive: true });
const server = await devServerHelper.startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`page:${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => {
    const map = document.createElement('script'); map.type = 'importmap';
    map.textContent = JSON.stringify({ imports: { three: '/src/3d/vendor/three/three.module.js', 'three/addons/': '/src/3d/vendor/three/addons/' } }); document.head.append(map);
  });
  const setup = await page.evaluate(async () => {
    document.body.innerHTML = '<canvas id="proof"></canvas>';
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { createScene } = await import('/src/3d/sceneManager.js');
    const { WORLD_SCALE } = await import('/src/3d/config.js');
    const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { CURRENT_TERRAIN_POLICY } = await import('/src/3d/world/terrain.js');
    const state = createScene(document.getElementById('proof')); state.controls.enabled = false; state.scene.fog = null; state.sky.visible = false; state.stars.visible = false;
    state.renderer.setPixelRatio(1); state.renderer.setSize(1536, 1024, false); state.chunkManager.loadSquare(0, 0, 12);
    const meshes = [...state.chunkManager.loaded.values()];
    const target = normalizedReferenceToWorldXZ(15 / 16, 3 / 16, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    const near = new THREE.PerspectiveCamera(48, 1.5, 1, 30000); const far = new THREE.PerspectiveCamera(42, 1.5, 1, 30000);
    near.position.set(target.x - 480, 420, target.z + 520); near.lookAt(target.x, 0, target.z);
    far.position.set(target.x - 1100, 1150, target.z + 1400); far.lookAt(target.x, 0, target.z);
    const aspect = 1.5; const halfWidth = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS / 2, WORLD_SCALE.WORLD_DEPTH_METERS * aspect / 2) * 1.025; const halfHeight = halfWidth / aspect;
    const full = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000); full.up.set(0, 0, -1); full.position.set(0, 13000, 0); full.lookAt(0, 0, 0);
    window.__g71RockSnowVisual = { render(kind) { state.renderer.render(state.scene, kind === 'near' ? near : kind === 'far' ? far : full); } };
    return { terrainMeshCount: meshes.length, missingSingleSource: meshes.filter((m) => m.userData.currentTerrainSingleSource !== true).length, fullOwnerMapCoverage: CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage, currentTerrainPolicy: CURRENT_TERRAIN_POLICY.id, resolution: [1536, 1024], fullCamera: 'THREE.OrthographicCamera', fullPitchDegrees: 90, terrain3dRuntimeAdoptionClaimed: false };
  });
  requireOk(setup.terrainMeshCount >= 500 && setup.missingSingleSource === 0 && setup.fullOwnerMapCoverage === true, 'shipped terrain regression detected');
  const hashes = {};
  for (const kind of ['near', 'far', 'full-world']) {
    await page.evaluate((k) => window.__g71RockSnowVisual.render(k), kind === 'full-world' ? 'full' : kind);
    const png = await page.locator('#proof').screenshot(); requireOk(png.length > 4096, `${kind} PNG too small`);
    fs.writeFileSync(path.join(OUT, `g71-rock-snow-${kind}.png`), png); hashes[kind] = sha256(png);
  }
  requireOk(new Set(Object.values(hashes)).size === 3, 'near/far/full-world images must differ'); requireOk(errors.length === 0, errors.join(' | '));
  const report = { authored, runtime: setup, sha256: hashes, browserErrors: errors };
  fs.writeFileSync(path.join(OUT, 'g71-rock-snow-visual-metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`G71_ROCK_SNOW_VISUAL_METRICS=${JSON.stringify(report)}`); console.log('NE_G71_ROCK_SNOW_VISUAL_EVIDENCE_OK');
} finally { await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
