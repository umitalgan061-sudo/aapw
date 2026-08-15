#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ARG = process.argv.find((value) => value.startsWith('--out-dir='));
const OUT_DIR = path.resolve(ROOT, OUT_ARG ? OUT_ARG.slice(10) : 'artifacts/ne-g71-biome-visual');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function requireOk(condition, message) { if (!condition) throw new Error(message); }

const playwright = devServerHelper.loadPlaywright();
requireOk(Boolean(playwright), 'Playwright is required for G71 visual evidence');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await devServerHelper.startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });

try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${baseUrl}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => {
    const map = document.createElement('script'); map.type = 'importmap';
    map.textContent = JSON.stringify({ imports: { three: '/src/3d/vendor/three/three.module.js', 'three/addons/': '/src/3d/vendor/three/addons/' } });
    document.head.append(map);
  });
  const metrics = await page.evaluate(async () => {
    document.body.innerHTML = '<canvas id="g71-proof"></canvas>';
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { createScene } = await import('/src/3d/sceneManager.js');
    const { WORLD_SCALE } = await import('/src/3d/config.js');
    const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { CURRENT_TERRAIN_POLICY } = await import('/src/3d/world/terrain.js');
    const state = createScene(document.getElementById('g71-proof'));
    state.controls.enabled = false; state.scene.fog = null; state.sky.visible = false; state.stars.visible = false;
    state.renderer.setPixelRatio(1); state.renderer.setSize(1536, 1024, false); state.chunkManager.loadSquare(0, 0, 12);
    const meshes = [...state.chunkManager.loaded.values()];
    const missingSingleSource = meshes.filter((mesh) => mesh.userData.currentTerrainSingleSource !== true).length;
    const target = normalizedReferenceToWorldXZ(15 / 16, 3 / 16, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    const near = new THREE.PerspectiveCamera(48, 1536 / 1024, 1, 20000);
    near.position.set(target.x - 520, 520, target.z + 620); near.lookAt(target.x, 0, target.z); near.updateProjectionMatrix();
    state.renderer.render(state.scene, near);
    globalThis.__g71Proof = { THREE, state, WORLD_SCALE };
    return {
      terrainMeshCount: meshes.length, missingSingleSource,
      currentTerrainPolicy: CURRENT_TERRAIN_POLICY.id, fullOwnerMapCoverage: CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage,
      target, resolution: [1536, 1024], worldWidth: WORLD_SCALE.WORLD_WIDTH_METERS, worldDepth: WORLD_SCALE.WORLD_DEPTH_METERS,
    };
  });
  requireOk(metrics.terrainMeshCount >= 500, `full-world runtime incomplete: ${metrics.terrainMeshCount} terrain meshes`);
  requireOk(metrics.missingSingleSource === 0, `runtime has ${metrics.missingSingleSource} terrain meshes outside single-height-source contract`);
  requireOk(metrics.fullOwnerMapCoverage === true, 'shipped terrain lost full-owner-map coverage');
  const near = await page.screenshot({ type: 'png' });
  await page.evaluate(() => {
    const { THREE, state, WORLD_SCALE } = globalThis.__g71Proof;
    const aspect = 1536 / 1024;
    const halfWidth = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS / 2, WORLD_SCALE.WORLD_DEPTH_METERS * aspect / 2) * 1.025;
    const halfHeight = halfWidth / aspect;
    const full = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000);
    full.up.set(0, 0, -1); full.position.set(0, 13000, 0); full.lookAt(0, 0, 0); full.updateProjectionMatrix();
    state.renderer.render(state.scene, full);
  });
  const full = await page.screenshot({ type: 'png' });
  requireOk(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
  requireOk(near.length > 4096 && full.length > 4096, 'visual proof PNG unexpectedly small');
  fs.writeFileSync(path.join(OUT_DIR, 'g71-near-perspective.png'), near);
  fs.writeFileSync(path.join(OUT_DIR, 'g71-full-world-orthographic.png'), full);
  const report = { ...metrics, fullCamera: 'THREE.OrthographicCamera', fullPitchDegrees: 90, nearSha256: sha256(near), fullSha256: sha256(full), browserErrors: errors };
  fs.writeFileSync(path.join(OUT_DIR, 'g71-visual-metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`G71_BIOME_VISUAL_METRICS=${JSON.stringify(report)}`);
  console.log('NE_G71_BIOME_VISUAL_EVIDENCE_OK');
} finally {
  await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve));
}
