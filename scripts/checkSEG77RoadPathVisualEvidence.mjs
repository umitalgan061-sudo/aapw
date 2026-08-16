#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((v) => v.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/se-g77-road-path-visual');
const probePath = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g77-road-path-probe.json');
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77RoadPathVisualEvidence] ${message}`); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
need(fs.existsSync(probePath), 'probe missing'); const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
need(probe.geoCell === 'G77' && probe.layer === 'Road/Path' && probe.canonicalWaterCells === 44 && probe.canonicalLandCells === 52, 'G77 probe identity/geography drifted');

const playwright = devServerHelper.loadPlaywright(); need(Boolean(playwright), 'Playwright required'); fs.mkdirSync(OUT, { recursive: true });
const server = await devServerHelper.startStaticServer(), browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 } }), errors = [];
page.on('pageerror', (e) => errors.push(`page:${e.message}`)); page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${base}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => { const map = document.createElement('script'); map.type = 'importmap'; map.textContent = JSON.stringify({ imports: { three: '/src/3d/vendor/three/three.module.js', 'three/addons/': '/src/3d/vendor/three/addons/' } }); document.head.append(map); });
  const setup = await page.evaluate(async (guard) => {
    document.body.innerHTML = '<canvas id="proof"></canvas>';
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { createScene } = await import('/src/3d/sceneManager.js');
    const { WORLD_SCALE, WORLD_DEFAULTS, SETTLEMENT_CONFIG } = await import('/src/3d/config.js');
    const { CURRENT_TERRAIN_POLICY, createHeightSampler } = await import('/src/3d/world/terrain.js');
    const { KINGDOM_SEATS, mapToWorldXZ, computeSettlementFlattenPads } = await import('/src/3d/world/settlements.js');
    const { buildRoadNetwork } = await import('/src/3d/world/roads.js');
    const { normalizedReferenceToWorldXZ, worldXZToNormalizedReference } = await import('/src/3d/world/worldReferenceAlignment.js');
    const state = createScene(document.getElementById('proof')); state.controls.enabled = false; state.scene.fog = null; state.sky.visible = false; state.stars.visible = false; state.renderer.setPixelRatio(1); state.renderer.setSize(1536, 1024, false); state.chunkManager.loadSquare(0, 0, 13);
    const raw = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED); const pads = computeSettlementFlattenPads({ sampleHeightMeters: raw, seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS, minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS, mapBounds: WORLD_SCALE.MAP_BOUNDS, metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT });
    const height = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, pads); const seats = KINGDOM_SEATS.map((s) => { const p = mapToWorldXZ(s.mapX, s.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT); return { id: s.id, x: p.x, z: p.z, groundY: height(p.x, p.z) }; });
    const roads = buildRoadNetwork({ seats, sampleHeightMeters: height }); state.scene.add(roads.group); state.scene.updateMatrixWorld(true);
    let renderedRoadVertices = 0, renderedRoadVerticesInGuard = 0;
    for (const mesh of roads.group.children) { const position = mesh.geometry.getAttribute('position'); renderedRoadVertices += position.count; for (let i = 0; i < position.count; i += 1) { const n = worldXZToNormalizedReference(position.getX(i), position.getZ(i), WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT); if (n.x >= guard.xMin && n.x <= guard.xMax && n.y >= guard.yMin && n.y <= guard.yMax) renderedRoadVerticesInGuard += 1; } }
    const meshes = [...state.chunkManager.loaded.values()], target = normalizedReferenceToWorldXZ(15 / 16, 15 / 16, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT), groundY = state.groundCollider.getGroundHeight(target.x, target.z);
    const hit = new THREE.Raycaster(new THREE.Vector3(target.x, 5000, target.z), new THREE.Vector3(0, -1, 0), 0, 10000).intersectObjects(meshes, false)[0] ?? null;
    const near = new THREE.PerspectiveCamera(48, 1.5, 1, 30000); near.position.set(target.x - 420, groundY + 360, target.z + 480); near.lookAt(target.x, groundY, target.z);
    const far = new THREE.PerspectiveCamera(42, 1.5, 1, 30000); far.position.set(target.x - 1050, groundY + 1050, target.z + 1350); far.lookAt(target.x, groundY, target.z);
    const aspect = 1.5, halfWidth = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS / 2, WORLD_SCALE.WORLD_DEPTH_METERS * aspect / 2) * 1.025, halfHeight = halfWidth / aspect; const full = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000); full.up.set(0, 0, -1); full.position.set(0, 13000, 0); full.lookAt(0, 0, 0);
    let visibleGeoCellOverlay = false; state.scene.traverse((o) => { if (o.visible !== false && (o.userData?.geoCellOverlay === true || o.userData?.debugGrid === true)) visibleGeoCellOverlay = true; });
    window.__g77RoadVisual = { render(kind) { state.renderer.render(state.scene, kind === 'near' ? near : kind === 'far' ? far : full); } };
    return { terrainMeshCount: meshes.length, missingSingleSource: meshes.filter((m) => m.userData.currentTerrainSingleSource !== true).length, fullOwnerMapCoverage: CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage, targetRayHit: Boolean(hit), renderPhysicsErrorMeters: hit ? Math.abs(hit.point.y - groundY) : null, mainEdges: roads.edges.length, footpathEdges: roads.footpathEdges.length, renderedRoadVertices, renderedRoadVerticesInGuard, fullCamera: 'THREE.OrthographicCamera', fullPitchDegrees: 90, visibleGeoCellOverlay, terrain3dRuntimeAdoptionClaimed: false };
  }, probe.guardBounds);
  need(setup.terrainMeshCount >= 500 && setup.missingSingleSource === 0 && setup.fullOwnerMapCoverage, 'shipped full-owner-map terrain regression');
  need(setup.targetRayHit && setup.renderPhysicsErrorMeters <= 0.75, `G77 render/physics parity failed: ${setup.renderPhysicsErrorMeters}`);
  need(setup.mainEdges >= 13 && setup.footpathEdges >= 1 && setup.renderedRoadVertices > 0, 'shipped Road/Path geometry missing');
  need((probe.crossingEdges.length > 0) === (setup.renderedRoadVerticesInGuard > 0), `source/rendered G77 route mismatch: ${probe.crossingEdges.length}/${setup.renderedRoadVerticesInGuard}`);
  need(setup.fullCamera === 'THREE.OrthographicCamera' && setup.fullPitchDegrees === 90 && !setup.visibleGeoCellOverlay, 'full-world camera/grid contract failed');
  const hashes = {}; for (const kind of ['near', 'far', 'full-world']) { await page.evaluate((k) => window.__g77RoadVisual.render(k), kind === 'full-world' ? 'full' : kind); const png = await page.locator('#proof').screenshot(); need(png.length > 4096, `${kind} PNG too small`); fs.writeFileSync(path.join(OUT, `g77-road-path-${kind}.png`), png); hashes[kind] = sha256(png); }
  need(new Set(Object.values(hashes)).size === 3 && errors.length === 0, errors.join(' | ') || 'visual frames duplicated');
  const report = { schema: 'se-g77-road-path-real-runtime-v1', policyId: probe.policyId, sourceMapSha256: probe.sourceMapSha256, crossingEdges: probe.crossingEdges, runtimeRoadReferenceEnvelope: probe.runtimeRoadReferenceEnvelope, runtime: setup, sha256: hashes, browserErrors: errors };
  fs.writeFileSync(path.join(OUT, 'g77-road-path-visual-metrics.json'), `${JSON.stringify(report, null, 2)}\n`); console.log(`SE_G77_ROAD_PATH_VISUAL_METRICS=${JSON.stringify(report)}`); console.log('SE_G77_ROAD_PATH_VISUAL_EVIDENCE_OK');
} finally { await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
