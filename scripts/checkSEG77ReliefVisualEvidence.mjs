import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { G77_RELIEF_POLICY, sampleG77ReliefHeight } from '../godot/terrain-authoring/geocells/se/g77_relief.mjs';
import { sampleG77BiomeSurface } from '../godot/terrain-authoring/geocells/se/g77_biome.mjs';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.find((value) => value.startsWith('--out-dir='));
const OUT_DIR = path.resolve(ROOT, outArg ? outArg.slice('--out-dir='.length) : 'artifacts/se-g77-relief-visual');
const fail = (message) => { throw new Error(`[checkSEG77ReliefVisualEvidence] FAIL: ${message}`); };
const need = (condition, message) => { if (!condition) fail(message); };
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const size = 97;
const bounds = G77_RELIEF_POLICY.normalizedBounds;
const samples = [];
let minHeight = Infinity;
let maxHeight = -Infinity;
let wet = 0;
let dry = 0;
for (let y = 0; y < size; y += 1) {
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * y / (size - 1);
  for (let x = 0; x < size; x += 1) {
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * x / (size - 1);
    const height = sampleG77ReliefHeight(nx, ny);
    const biome = sampleG77BiomeSurface(nx, ny);
    need(Number.isFinite(height) && biome.color.every(Number.isFinite), 'non-finite visual source sample');
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
    if (biome.water >= 0.5) wet += 1; else dry += 1;
    samples.push([height, biome.color[0], biome.color[1], biome.color[2], biome.roughness, biome.water]);
  }
}
need(wet > 0 && dry > 0 && maxHeight - minHeight > 2, `visual source lacks mixed relief: wet=${wet} dry=${dry} span=${maxHeight - minHeight}`);

const playwright = loadPlaywright();
need(Boolean(playwright), 'Playwright is required');
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });
  const renderMetrics = await page.evaluate(async ({ samples, size, bounds }) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x182329);
    const centerMap = normalizedReferenceToMapCanvas((bounds.xMin + bounds.xMax) * 0.5, (bounds.yMin + bounds.yMax) * 0.5);
    const centerWorld = mapCanvasToPlannedWorldXZ(centerMap.x, centerMap.y);
    const positions = []; const colors = []; const indices = [];
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity; let minY = Infinity; let maxY = -Infinity; let roughness = 0;
    const heightScale = 7;
    for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * col / (size - 1);
      const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * row / (size - 1);
      const source = samples[row * size + col];
      const map = normalizedReferenceToMapCanvas(nx, ny); const world = mapCanvasToPlannedWorldXZ(map.x, map.y); const py = source[0] * heightScale;
      minX = Math.min(minX, world.x); maxX = Math.max(maxX, world.x); minZ = Math.min(minZ, world.z); maxZ = Math.max(maxZ, world.z); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      positions.push(world.x - centerWorld.x, py, world.z - centerWorld.z); colors.push(source[1], source[2], source[3]); roughness += source[4];
    }
    for (let row = 0; row < size - 1; row += 1) for (let col = 0; col < size - 1; col += 1) {
      const a = row * size + col; const b = a + 1; const c = a + size; const d = c + 1; indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: roughness / samples.length, metalness: 0, side: THREE.DoubleSide })); scene.add(mesh);
    const spanX = maxX - minX; const spanZ = maxZ - minZ; const span = Math.max(spanX, spanZ);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(spanX * 1.15, spanZ * 1.15), new THREE.MeshPhysicalMaterial({ color: 0x417f98, transparent: true, opacity: 0.32, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide })); water.rotation.x = -Math.PI / 2; scene.add(water);
    scene.add(new THREE.HemisphereLight(0xddefff, 0x3a2a1e, 1.8)); const sun = new THREE.DirectionalLight(0xffe9c0, 2.6); sun.position.set(-spanX * 0.4, span * 0.8, -spanZ * 0.25); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, span * 8);
    window.__g77Relief = { renderer, scene, camera, spanX, spanZ, span, minY, maxY, render(kind) {
      if (kind === 'near') camera.position.set(-spanX * 0.30, span * 0.24, spanZ * 0.32);
      else if (kind === 'far') camera.position.set(0, span * 0.72, spanZ * 0.72);
      else camera.position.set(0, span * 1.45, 0.01);
      camera.lookAt(0, kind === 'top' ? 0 : (minY + maxY) * 0.5, 0); renderer.render(scene, camera);
    }};
    return { vertices: positions.length / 3, triangles: indices.length / 3, worldSpanMeters: { x: spanX, z: spanZ }, diagnosticHeightScale: heightScale, diagnosticVerticalSpan: maxY - minY };
  }, { samples, size, bounds });
  async function capture(kind, name) {
    await page.evaluate((value) => window.__g77Relief.render(value), kind);
    const png = await page.locator('#terrain-proof').screenshot(); need(png.length > 1024, `${kind} PNG too small`); fs.writeFileSync(path.join(OUT_DIR, name), png); return sha256(png);
  }
  const hashes = { near: await capture('near', 'g77-relief-near.png'), far: await capture('far', 'g77-relief-far.png'), top: await capture('top', 'g77-relief-topdown.png') };
  need(pageErrors.length === 0, `browser errors: ${pageErrors.join(' | ')}`);
  const metrics = { schema: 'se-g77-relief-visual-v1', sourceMapSha256: G77_RELIEF_POLICY.sourceMapSha256, size, wetSamples: wet, drySamples: dry, physicalHeightRange: [minHeight, maxHeight], render: renderMetrics, visibleGeoCellOverlay: false, evidenceSha256: hashes, determinismPolicy: 'numeric relief/Terrain3D metrics gate determinism; GPU PNG hashes are provenance only' };
  fs.writeFileSync(path.join(OUT_DIR, 'g77-relief-visual-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`SE_G77_RELIEF_VISUAL_METRICS=${JSON.stringify(metrics)}`); console.log('SE_G77_RELIEF_VISUAL_OK');
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
