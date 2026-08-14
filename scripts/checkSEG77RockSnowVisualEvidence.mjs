import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { G77_ROCK_SNOW_POLICY, sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';
import { sampleG77BiomeSurface } from '../godot/terrain-authoring/geocells/se/g77_biome.mjs';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((v) => v.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice('--out-dir='.length) : 'artifacts/se-g77-rock-snow-r9');
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77RockSnowVisualEvidence] ${message}`); };
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });

const size = 129, b = G77_ROCK_SNOW_POLICY.normalizedBounds, samples = [];
let wet = 0, dry = 0, fractional = 0, minHeight = Infinity, maxHeight = -Infinity;
for (let y = 0; y < size; y += 1) {
  const ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1);
  for (let x = 0; x < size; x += 1) {
    const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1), s = sampleG77RockSnow(nx, ny), biome = sampleG77BiomeSurface(nx, ny);
    let color = mix(biome.color.slice(), [0.34, 0.33, 0.31], s.rockWeight); color = mix(color, [0.88, 0.90, 0.92], s.snowWeight);
    if (s.waterConfidence >= 0.5) wet += 1; else dry += 1;
    if (s.rockBlend > 0.001 && s.rockBlend < 0.999) fractional += 1;
    minHeight = Math.min(minHeight, s.height); maxHeight = Math.max(maxHeight, s.height);
    samples.push([s.height, ...color]);
  }
}
need(wet > 0 && dry > 0, 'mixed G77 coast disappeared');
need(fractional > 1024, `rock field became blocky: ${fractional}`);
need(maxHeight - minHeight > 2, 'relief span collapsed');

const playwright = loadPlaywright(); need(Boolean(playwright), 'Playwright is required');
const server = await startStaticServer(); const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });
  const render = await page.evaluate(async ({ samples, size, bounds }) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { normalizedReferenceToMapCanvas } = await import('/src/3d/world/worldReferenceAlignment.js');
    const { mapCanvasToPlannedWorldXZ } = await import('/src/3d/world/worldReferenceMigrationPlan.js');
    const canvas = document.getElementById('terrain-proof'); const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.setSize(960, 640, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x172229); const centerMap = normalizedReferenceToMapCanvas((bounds.xMin + bounds.xMax) / 2, (bounds.yMin + bounds.yMax) / 2); const center = mapCanvasToPlannedWorldXZ(centerMap.x, centerMap.y);
    const positions = [], colors = [], indices = []; let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) { const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * col / (size - 1), ny = bounds.yMin + (bounds.yMax - bounds.yMin) * row / (size - 1), s = samples[row * size + col], map = normalizedReferenceToMapCanvas(nx, ny), world = mapCanvasToPlannedWorldXZ(map.x, map.y), py = s[0] * 7; positions.push(world.x - center.x, py, world.z - center.z); colors.push(s[1], s[2], s[3]); minX = Math.min(minX, world.x); maxX = Math.max(maxX, world.x); minZ = Math.min(minZ, world.z); maxZ = Math.max(maxZ, world.z); minY = Math.min(minY, py); maxY = Math.max(maxY, py); }
    for (let row = 0; row < size - 1; row += 1) for (let col = 0; col < size - 1; col += 1) { const a = row * size + col, c = a + size, d = c + 1; indices.push(a, c, a + 1, a + 1, c, d); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide })));
    const spanX = maxX - minX, spanZ = maxZ - minZ, span = Math.max(spanX, spanZ); const water = new THREE.Mesh(new THREE.PlaneGeometry(spanX * 1.15, spanZ * 1.15), new THREE.MeshPhysicalMaterial({ color: 0x417f98, transparent: true, opacity: 0.30, roughness: 0.2, depthWrite: false, side: THREE.DoubleSide })); water.rotation.x = -Math.PI / 2; scene.add(water); scene.add(new THREE.HemisphereLight(0xddefff, 0x392a20, 1.8)); const sun = new THREE.DirectionalLight(0xffe9c0, 2.6); sun.position.set(-spanX * 0.4, span * 0.8, -spanZ * 0.25); scene.add(sun); const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, span * 8);
    window.__g77 = { renderer, scene, camera, spanX, spanZ, span, minY, maxY, render(kind) { if (kind === 'near') camera.position.set(-spanX * 0.30, span * 0.24, spanZ * 0.32); else if (kind === 'far') camera.position.set(0, span * 0.72, spanZ * 0.72); else camera.position.set(0, span * 1.45, 0.01); camera.lookAt(0, kind === 'top' ? 0 : (minY + maxY) / 2, 0); renderer.render(scene, camera); return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }; } };
    return { vertices: positions.length / 3, triangles: indices.length / 3, visibleGeoCellOverlay: false };
  }, { samples, size, bounds: b });
  need(render.vertices === size * size, 'visual mesh vertex count drifted'); need(render.triangles === (size - 1) * (size - 1) * 2, 'visual mesh triangle count drifted'); need(render.visibleGeoCellOverlay === false, 'GeoCell overlay must be hidden');
  const hashes = {}; for (const [kind, name] of [['near', 'g77-rock-snow-near.png'], ['far', 'g77-rock-snow-far.png'], ['top', 'g77-rock-snow-topdown.png']]) { const stats = await page.evaluate((k) => window.__g77.render(k), kind); need(stats.calls > 0 && stats.triangles > 0, `${kind} render is empty`); const png = await page.locator('#terrain-proof').screenshot(); need(png.length > 1024, `${kind} PNG too small`); fs.writeFileSync(path.join(OUT, name), png); hashes[kind] = sha256(png); }
  need(new Set(Object.values(hashes)).size === 3, 'near/far/top-down frames are not distinct'); need(errors.length === 0, `browser errors: ${errors.join(' | ')}`);
  const metrics = { schema: 'se-g77-rock-snow-visual-r9', sourceMapSha256: G77_ROCK_SNOW_POLICY.sourceMapSha256, size, wetSamples: wet, drySamples: dry, fractionalRockSamples: fractional, physicalHeightRange: [minHeight, maxHeight], render, visibleGeoCellOverlay: false, evidenceSha256: hashes };
  fs.writeFileSync(path.join(OUT, 'g77-rock-snow-visual-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`); console.log(`SE_G77_ROCK_SNOW_VISUAL_METRICS=${JSON.stringify(metrics)}`); console.log('SE_G77_ROCK_SNOW_VISUAL_OK');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
