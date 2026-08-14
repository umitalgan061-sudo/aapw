import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { G77_ROCK_SNOW_POLICY, sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';
import { sampleG77BiomeSurface } from '../godot/terrain-authoring/geocells/se/g77_biome.mjs';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.find((value) => value.startsWith('--out-dir='));
const OUT_DIR = path.resolve(ROOT, outArg ? outArg.slice('--out-dir='.length) : 'artifacts/se-g77-rock-snow-visual');
const need = (condition, message) => { if (!condition) throw new Error(`[checkSEG77RockSnowVisualEvidence] FAIL: ${message}`); };
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const size = 129, bounds = G77_ROCK_SNOW_POLICY.normalizedBounds, samples = [];
let wet = 0, dry = 0, fractionalRock = 0, snowSamples = 0, minHeight = Infinity, maxHeight = -Infinity;
for (let y = 0; y < size; y += 1) {
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (size - 1);
  for (let x = 0; x < size; x += 1) {
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (size - 1);
    const surface = sampleG77RockSnow(nx, ny), biome = sampleG77BiomeSurface(nx, ny);
    let color = mix(biome.color.slice(), [0.34, 0.33, 0.31], surface.rockWeight);
    color = mix(color, [0.88, 0.90, 0.92], surface.snowWeight);
    if (surface.waterConfidence >= 0.5) wet += 1; else dry += 1;
    if (surface.rockBlend > 0.001 && surface.rockBlend < 0.999) fractionalRock += 1;
    if (surface.snowWeight > 0.001) snowSamples += 1;
    minHeight = Math.min(minHeight, surface.height); maxHeight = Math.max(maxHeight, surface.height);
    samples.push([surface.height, color[0], color[1], color[2]]);
  }
}
need(wet > 0 && dry > 0, `mixed coast disappeared: wet=${wet} dry=${dry}`);
need(fractionalRock > 1024, `rock material collapsed to blocks: ${fractionalRock}`);
need(maxHeight - minHeight > 2, `relief span collapsed: ${maxHeight - minHeight}`);

const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright is required');
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });
  const render = await page.evaluate(async ({ samples, size, bounds }) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x172229);
    const centerMap = normalizedReferenceToMapCanvas((bounds.xMin + bounds.xMax) * 0.5, (bounds.yMin + bounds.yMax) * 0.5);
    const centerWorld = mapCanvasToPlannedWorldXZ(centerMap.x, centerMap.y);
    const positions = [], colors = [], indices = []; let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity; const heightScale = 7;
    for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) { const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * col / (size - 1), ny = bounds.yMin + (bounds.yMax - bounds.yMin) * row / (size - 1), s = samples[row * size + col], map = normalizedReferenceToMapCanvas(nx, ny), world = mapCanvasToPlannedWorldXZ(map.x, map.y), py = s[0] * heightScale; minX = Math.min(minX, world.x); maxX = Math.max(maxX, world.x); minZ = Math.min(minZ, world.z); maxZ = Math.max(maxZ, world.z); minY = Math.min(minY, py); maxY = Math.max(maxY, py); positions.push(world.x - centerWorld.x, py, world.z - centerWorld.z); colors.push(s[1], s[2], s[3]); }
    for (let row = 0; row < size - 1; row += 1) for (let col = 0; col < size - 1; col += 1) { const a = row * size + col, b = a + 1, c = a + size, d = c + 1; indices.push(a, c, b, b, c, d); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide })));
    const spanX = maxX - minX, spanZ = maxZ - minZ, span = Math.max(spanX, spanZ);
    const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(spanX * 1.15, spanZ * 1.15), new THREE.MeshPhysicalMaterial({ color: 0x417f98, transparent: true, opacity: 0.30, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide }));
    waterMesh.rotation.x = -Math.PI / 2; scene.add(waterMesh); scene.add(new THREE.HemisphereLight(0xddefff, 0x392a20, 1.8));
    const sun = new THREE.DirectionalLight(0xffe9c0, 2.6); sun.position.set(-spanX * 0.4, span * 0.8, -spanZ * 0.25); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, span * 8);
    window.__g77RockSnow = { renderer, scene, camera, spanX, spanZ, span, minY, maxY, render(kind) { if (kind === 'near') camera.position.set(-spanX * 0.30, span * 0.24, spanZ * 0.32); else if (kind === 'far') camera.position.set(0, span * 0.72, spanZ * 0.72); else camera.position.set(0, span * 1.45, 0.01); camera.lookAt(0, kind === 'top' ? 0 : (minY + maxY) * 0.5, 0); renderer.render(scene, camera); } };
    return { vertices: positions.length / 3, triangles: indices.length / 3, worldSpanMeters: { x: spanX, z: spanZ }, diagnosticHeightScale: heightScale };
  }, { samples, size, bounds });
  need(render.vertices === size * size, `visual mesh vertex count drifted: ${render.vertices}`);
  need(render.triangles === (size - 1) * (size - 1) * 2, `visual mesh triangle count drifted: ${render.triangles}`);
  async function capture(kind, name) { await page.evaluate((value) => window.__g77RockSnow.render(value), kind); const png = await page.locator('#terrain-proof').screenshot(); need(png.length > 1024, `${kind} PNG too small`); fs.writeFileSync(path.join(OUT_DIR, name), png); return sha256(png); }
  const hashes = { near: await capture('near', 'g77-rock-snow-near.png'), far: await capture('far', 'g77-rock-snow-far.png'), top: await capture('top', 'g77-rock-snow-topdown.png') };
  need(new Set(Object.values(hashes)).size === 3, 'near/far/top-down evidence collapsed to duplicate frames');
  const renderInfo = await page.evaluate(() => ({ calls: window.__g77RockSnow.renderer.info.render.calls, triangles: window.__g77RockSnow.renderer.info.render.triangles }));
  need(renderInfo.calls > 0 && renderInfo.triangles > 0, `GPU proof rendered no geometry: ${JSON.stringify(renderInfo)}`);
  need(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
  const metrics = { schema: 'se-g77-rock-snow-visual-v5', sourceMapSha256: G77_ROCK_SNOW_POLICY.sourceMapSha256, size, wetSamples: wet, drySamples: dry, fractionalRockSamples: fractionalRock, snowSamples, physicalHeightRange: [minHeight, maxHeight], render, renderInfo, visibleGeoCellOverlay: false, distinctCameraFrames: true, evidenceSha256: hashes, determinismPolicy: 'numeric source/import/seam gates are authoritative; GPU hashes are provenance only' };
  fs.writeFileSync(path.join(OUT_DIR, 'g77-rock-snow-visual-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`SE_G77_ROCK_SNOW_VISUAL_METRICS=${JSON.stringify(metrics)}`);
  console.log('SE_G77_ROCK_SNOW_VISUAL_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
