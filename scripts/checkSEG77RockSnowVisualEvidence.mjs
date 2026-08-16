#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { measureG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((v) => v.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/se-g77-rock-snow-visual');
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77RockSnowVisualEvidence] ${message}`); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const authored = measureG77RockSnow();
need(authored.canonicalWaterCells === 44 && authored.canonicalLandCells === 52, 'merged G77 geography drifted');
need(authored.maxCanonicalWaterLeak === 0 && authored.fractionalRockSamples >= 512, 'authored Rock/Snow envelope drifted');

const playwright = devServerHelper.loadPlaywright(); need(Boolean(playwright), 'Playwright required'); fs.mkdirSync(OUT, { recursive: true });
const server = await devServerHelper.startStaticServer();
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`page:${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => { const map = document.createElement('script'); map.type = 'importmap'; map.textContent = JSON.stringify({ imports: { three: '/src/3d/vendor/three/three.module.js', 'three/addons/': '/src/3d/vendor/three/addons/' } }); document.head.append(map); });
  const setup = await page.evaluate(async () => {
    document.body.innerHTML = '<canvas id="proof" style="display:block;width:1536px;height:1024px"></canvas>';
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { createScene } = await import('/src/3d/sceneManager.js');
    const { WORLD_SCALE } = await import('/src/3d/config.js');
    const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { CURRENT_TERRAIN_POLICY } = await import('/src/3d/world/terrain.js');
    const state = createScene(document.getElementById('proof')); state.controls.enabled = false; state.scene.fog = null; state.sky.visible = false; state.stars.visible = false;
    state.renderer.setPixelRatio(1); state.renderer.setSize(1536, 1024, true); state.chunkManager.loadSquare(0, 0, 13);
    state.scene.updateMatrixWorld(true);
    const meshes = [...state.chunkManager.loaded.values()];
    const target = normalizedReferenceToWorldXZ(15 / 16, 15 / 16, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    const groundY = state.groundCollider.getGroundHeight(target.x, target.z);
    const ray = new THREE.Raycaster(new THREE.Vector3(target.x, 5000, target.z), new THREE.Vector3(0, -1, 0), 0, 10000);
    const hit = ray.intersectObjects(meshes, false)[0] ?? null;
    const renderPhysicsErrorMeters = hit ? Math.abs(hit.point.y - groundY) : null;
    const near = new THREE.PerspectiveCamera(48, 1.5, 1, 30000); near.position.set(target.x - 420, groundY + 360, target.z + 480); near.lookAt(target.x, groundY, target.z);
    const far = new THREE.PerspectiveCamera(42, 1.5, 1, 30000); far.position.set(target.x - 1050, groundY + 1050, target.z + 1350); far.lookAt(target.x, groundY, target.z);
    const aspect = 1.5; const halfWidth = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS / 2, WORLD_SCALE.WORLD_DEPTH_METERS * aspect / 2) * 1.025; const halfHeight = halfWidth / aspect;
    const full = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000); full.up.set(0, 0, -1); full.position.set(0, 13000, 0); full.lookAt(0, 0, 0);
    let visibleGeoCellOverlay = false; state.scene.traverse((o) => { if (o.visible !== false && (o.userData?.geoCellOverlay === true || o.userData?.debugGrid === true)) visibleGeoCellOverlay = true; });
    window.__g77RockSnowVisual = { render(kind) { state.renderer.render(state.scene, kind === 'near' ? near : kind === 'far' ? far : full); } };
    return { terrainMeshCount: meshes.length, missingSingleSource: meshes.filter((m) => m.userData.currentTerrainSingleSource !== true).length, fullOwnerMapCoverage: CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage, currentTerrainPolicy: CURRENT_TERRAIN_POLICY.id, target, groundY, targetRayHit: Boolean(hit), renderPhysicsErrorMeters, fullCamera: 'THREE.OrthographicCamera', fullPitchDegrees: 90, visibleGeoCellOverlay, resolution: [1536, 1024], terrain3dRuntimeAdoptionClaimed: false, rawPixelEvidenceClaimed: false };
  });
  need(setup.terrainMeshCount >= 500 && setup.missingSingleSource === 0 && setup.fullOwnerMapCoverage === true, 'shipped full-owner-map terrain regression detected');
  need(setup.targetRayHit === true && Number.isFinite(setup.renderPhysicsErrorMeters) && setup.renderPhysicsErrorMeters <= 0.75, `G77 render/collider parity failed: ${setup.renderPhysicsErrorMeters}`);
  need(setup.fullCamera === 'THREE.OrthographicCamera' && setup.fullPitchDegrees === 90 && setup.visibleGeoCellOverlay === false, 'top-down/grid evidence contract failed');
  const hashes = {};
  for (const kind of ['near', 'far', 'full-world']) { await page.evaluate((k) => window.__g77RockSnowVisual.render(k), kind === 'full-world' ? 'full' : kind); const png = await page.locator('#proof').screenshot(); need(png.length > 4096, `${kind} PNG too small`); fs.writeFileSync(path.join(OUT, `g77-rock-snow-${kind}.png`), png); hashes[kind] = sha256(png); }
  need(new Set(Object.values(hashes)).size === 3, 'near/far/full-world images must differ'); need(errors.length === 0, errors.join(' | '));
  const report = { schema: 'se-g77-rock-snow-real-runtime-v1', authored, runtime: setup, sourceProvenanceMode: 'merged-sha-bound-derived-inputs', sha256: hashes, browserErrors: errors };
  fs.writeFileSync(path.join(OUT, 'g77-rock-snow-visual-metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`SE_G77_ROCK_SNOW_VISUAL_METRICS=${JSON.stringify(report)}`); console.log('SE_G77_ROCK_SNOW_VISUAL_EVIDENCE_OK');
} finally { await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
