import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';
import { assertCanonicalMapFile } from './canonicalMapProvenance.mjs';
import { G17_ROAD_PATH_POLICY } from '../godot/terrain-authoring/geocells/sw/g17_road_path.mjs';

const value = (flag) => { const arg = process.argv.find((candidate) => candidate.startsWith(`${flag}=`)); if (!arg) throw new Error(`missing ${flag}=...`); return arg.slice(flag.length + 1); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const pngIdentity = (file) => { const bytes = fs.readFileSync(file); if (bytes.length < 4096 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error(`invalid runtime PNG ${file}`); return { bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), sha256: sha256(bytes) }; };
const visualDir = value('--visual-dir'), source = JSON.parse(fs.readFileSync(value('--source'), 'utf8')), out = value('--out');
if (source.sourceMapSha256 !== G17_ROAD_PATH_POLICY.sourceMapSha256 || source.sourceMapVersion !== G17_ROAD_PATH_POLICY.sourceMapVersion || source.sourceMapSize?.[0] !== 1536 || source.sourceMapSize?.[1] !== 1024) throw new Error('Road/Path canonical SHA-bound source provenance changed');
if (source.coverage?.activeSamples !== 0 || source.routeEvidence?.roadGuardCrossingSegments !== 0 || source.routeEvidence?.pathGuardCrossingSegments !== 0) throw new Error('G17 open-sea Road/Path source is not empty');
const mapPath = ['map.png', 'resimler/map.png', 'public/map.png'].find((candidate) => fs.existsSync(candidate));
const trackedMap = mapPath ? assertCanonicalMapFile(mapPath) : null;
const semantic = path.join(visualDir, 'g17-hydrology-full-world-topdown.png'); if (!fs.existsSync(semantic)) throw new Error('semantic owner-map reference evidence missing');
const playwright = devServerHelper.loadPlaywright(); if (!playwright) throw new Error('Playwright is required');
const server = await devServerHelper.startStaticServer(), browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 }), consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(`page:${error.message}`)); page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`console:${message.text()}`); });

try {
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  await page.evaluate(() => { const map = document.createElement('script'); map.type = 'importmap'; map.textContent = JSON.stringify({ imports: { three: '/src/3d/vendor/three/three.module.js', 'three/addons/': '/src/3d/vendor/three/addons/' } }); document.head.append(map); });
  const runtime = await page.evaluate(async () => {
    document.body.innerHTML = '<canvas id="proof"></canvas>';
    const THREE = await import('/src/3d/vendor/three/three.module.js'), { createScene } = await import('/src/3d/sceneManager.js'), { WORLD_SCALE } = await import('/src/3d/config.js');
    const { normalizedReferenceToWorldXZ } = await import('/src/3d/world/worldReferenceAlignment.js'), { CURRENT_TERRAIN_POLICY } = await import('/src/3d/world/terrain.js');
    const state = createScene(document.getElementById('proof')); state.controls.enabled = false; state.scene.fog = null; state.sky.visible = false; state.stars.visible = false; state.renderer.setPixelRatio(1); state.renderer.setSize(1536, 1024, false); state.chunkManager.loadSquare(0, 0, 12);
    const meshes = [...state.chunkManager.loaded.values()], target = normalizedReferenceToWorldXZ(3 / 16, 15 / 16, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
    const near = new THREE.PerspectiveCamera(48, 1.5, 1, 30000), far = new THREE.PerspectiveCamera(42, 1.5, 1, 30000); near.position.set(target.x - 420, 360, target.z + 480); near.lookAt(target.x, 0, target.z); far.position.set(target.x - 1050, 1100, target.z + 1350); far.lookAt(target.x, 0, target.z);
    const halfWidth = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS / 2, WORLD_SCALE.WORLD_DEPTH_METERS * 1.5 / 2) * 1.025, full = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfWidth / 1.5, -halfWidth / 1.5, 1, 30000); full.up.set(0, 0, -1); full.position.set(0, 13000, 0); full.lookAt(0, 0, 0);
    window.__g17RoadVisual = { render(kind) { state.renderer.render(state.scene, kind === 'near' ? near : kind === 'far' ? far : full); } };
    return { terrainMeshCount: meshes.length, missingSingleSource: meshes.filter((mesh) => mesh.userData.currentTerrainSingleSource !== true).length, nonPbrTerrainMeshes: meshes.filter((mesh) => !mesh.material?.isMeshStandardMaterial).length, fullOwnerMapCoverage: CURRENT_TERRAIN_POLICY.fullOwnerMapCoverage, currentTerrainPolicy: CURRENT_TERRAIN_POLICY.id, sourceMapSha256: CURRENT_TERRAIN_POLICY.sourceMapSha256, runtimeWater: Boolean(state.water?.isMesh && state.water.visible), runtimeVegetation: Boolean(state.vegetation?.isGroup && state.vegetation.children.length > 0), roadEdges: state.roadEdges?.length ?? 0, target, worldBounds: { width: WORLD_SCALE.WORLD_WIDTH_METERS, depth: WORLD_SCALE.WORLD_DEPTH_METERS } };
  });
  if (runtime.terrainMeshCount < 500 || runtime.missingSingleSource || runtime.nonPbrTerrainMeshes || runtime.fullOwnerMapCoverage !== true || runtime.sourceMapSha256 !== source.sourceMapSha256 || !runtime.runtimeWater || !runtime.runtimeVegetation || runtime.roadEdges < 13) throw new Error(`shipped full-world runtime composition failed: ${JSON.stringify(runtime)}`);
  const files = { near: 'g17-road-path-runtime-near.png', far: 'g17-road-path-runtime-far.png', fullWorld3DTopDown: 'g17-road-path-full-world-3d-topdown.png' }, images = {};
  for (const [kind, name] of Object.entries(files)) { await page.evaluate((camera) => window.__g17RoadVisual.render(camera), kind === 'fullWorld3DTopDown' ? 'full' : kind); fs.writeFileSync(path.join(visualDir, name), await page.locator('#proof').screenshot()); images[kind] = pngIdentity(path.join(visualDir, name)); }
  images.semanticReference = pngIdentity(semantic);
  if (images.fullWorld3DTopDown.width !== 1536 || images.fullWorld3DTopDown.height !== 1024 || new Set([images.near.sha256, images.far.sha256, images.fullWorld3DTopDown.sha256]).size !== 3) throw new Error('runtime near/far/full-world evidence contract failed');
  if (consoleErrors.length) throw new Error(`runtime visual console errors: ${consoleErrors.join(' | ')}`);
  const runtimeChecksum = sha256(Buffer.from(JSON.stringify(runtime))), renderChecksum = sha256(Buffer.from([images.near.sha256, images.far.sha256, images.fullWorld3DTopDown.sha256].join(':')));
  const metadata = { cameraType: 'OrthographicCamera', topDownDegrees: 90, visibleGeoCellOverlay: false, runtimeTerrain: true, runtimeWater: runtime.runtimeWater, productionPBR: runtime.nonPbrTerrainMeshes === 0, runtimeVegetation: runtime.runtimeVegetation, sourceMapSha256: source.sourceMapSha256, runtimeChecksum, renderChecksum, worldBounds: runtime.worldBounds, consoleErrors };
  fs.writeFileSync(path.join(visualDir, 'g17-road-path-full-world-3d-topdown.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const manifest = { schema: 'westeros-g17-road-path-visual-evidence-v4', sourceMapSha256: source.sourceMapSha256, sourceMapVersion: source.sourceMapVersion, sourceMapSize: source.sourceMapSize, geoCell: 'G17', layer: 'Road/Path', runtimeCovered: true, visibleGeoCellOverlay: false, roadGuardCrossings: 0, pathGuardCrossings: 0, canonicalMapTracked: Boolean(trackedMap), trackedMap, rawPixelEvidenceClaimed: false, runtime, images, runtimeMetadata: metadata };
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`); console.log(`SW_G17_ROAD_PATH_VISUAL_EVIDENCE=${JSON.stringify({ runtimeCovered: true, canonicalMapTracked: Boolean(trackedMap), fullWorld3DTopDownSha256: images.fullWorld3DTopDown.sha256 })}`); console.log('SW_G17_ROAD_PATH_VISUAL_EVIDENCE_OK');
} finally { await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
