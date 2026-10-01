#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { sampleReferencePindexQualityV2 } from '../src/3d/world/worldReferenceSurfacePindexes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((v) => v.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/se-g77-near-detail-visual');
const probePath = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g77-near-detail-probe.json');
const need = (ok, message) => { if (!ok) throw new Error(`[checkSEG77NearDetailVisualEvidence] ${message}`); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const p = JSON.parse(fs.readFileSync(probePath, 'utf8'));
need(p.geoCell === 'G77' && p.layer === 'Near Detail' && p.canonicalWaterCells === 44 && p.canonicalLandCells === 52, 'probe identity/geography drifted');

const pick = (u, v) => p.rows[Math.max(0, Math.min(256, Math.round(v * 256)))][Math.max(0, Math.min(256, Math.round(u * 256)))];
const rgbFor = (s) => {
  const openWater = s[6] >= 0.5 && s[7] <= 0.001;
  if (openWater) return [0.14, 0.29, 0.37];
  const road = s[1], foot = s[2], ground = s[3], rock = s[4], snow = s[5];
  const base = [0.45 * ground + 0.34 * rock + 0.90 * snow, 0.38 * ground + 0.34 * rock + 0.92 * snow, 0.24 * ground + 0.33 * rock + 0.94 * snow];
  const route = Math.max(road, foot), routeColor = road >= foot ? [0.33, 0.23, 0.13] : [0.38, 0.28, 0.17];
  return base.map((v, i) => (v * (1 - route) + routeColor[i] * route) * s[11 + i]);
};

const grid = 129, samples = []; let minHeight = Infinity, maxHeight = -Infinity, waterVertices = 0, routeVertices = 0;
for (let y = 0; y < grid; y += 1) for (let x = 0; x < grid; x += 1) {
  const s = pick(x / (grid - 1), y / (grid - 1)); const rgb = rgbFor(s);
  minHeight = Math.min(minHeight, s[0]); maxHeight = Math.max(maxHeight, s[0]); if (s[6] >= 0.5 && s[7] <= 0.001) waterVertices += 1; if (Math.max(s[1], s[2]) > 0.02) routeVertices += 1;
  samples.push([s[0], ...rgb, s[14]]);
}

const worldWidth = 480, worldHeight = 320, worldPixels = new Uint8ClampedArray(worldWidth * worldHeight * 4);
const palette = { sea:[35,73,93], lake:[62,113,128], soil:[132,121,76], rock:[112,105,96], snow:[220,227,226] }; let overlayPixels = 0;
const bounds = p.normalizedBounds;
for (let y = 0; y < worldHeight; y += 1) for (let x = 0; x < worldWidth; x += 1) {
  const nx = (x + 0.5) / worldWidth, ny = (y + 0.5) / worldHeight, quality = sampleReferencePindexQualityV2(nx, ny), base = palette[quality.dominantSurface] || palette.soil;
  let r = base[0], g = base[1], b = base[2];
  if (nx >= bounds.xMin && nx <= bounds.xMax && ny >= bounds.yMin && ny <= bounds.yMax) {
    const s = pick((nx - bounds.xMin) / (bounds.xMax - bounds.xMin), (ny - bounds.yMin) / (bounds.yMax - bounds.yMin));
    r *= s[11]; g *= s[12]; b *= s[13]; overlayPixels += 1;
  }
  const o = (y * worldWidth + x) * 4; worldPixels[o] = Math.round(r); worldPixels[o + 1] = Math.round(g); worldPixels[o + 2] = Math.round(b); worldPixels[o + 3] = 255;
}

const playwright = devServerHelper.loadPlaywright(); need(Boolean(playwright), 'Playwright required'); fs.mkdirSync(OUT, { recursive: true });
const server = await devServerHelper.startStaticServer(), browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 }), errors = [];
page.on('pageerror', (e) => errors.push(`page:${e.message}`)); page.on('console', (m) => { if (m.type() === 'error') errors.push(`console:${m.text()}`); });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  const topology = await page.evaluate(async ({ samples, grid, minHeight }) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js'); document.body.innerHTML = '<canvas id="proof" width="1200" height="800"></canvas>';
    const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('proof'), antialias: true, preserveDrawingBuffer: true }); renderer.setSize(1200, 800, false); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9fc4d4); const positions = [], colors = [], indices = [];
    for (let y = 0; y < grid; y += 1) for (let x = 0; x < grid; x += 1) { const u = x / (grid - 1), v = y / (grid - 1), s = samples[y * grid + x]; positions.push((u - .5) * 1200, (s[0] - minHeight) * 4.5, (v - .5) * 800); colors.push(s[1], s[2], s[3]); }
    for (let y = 0; y < grid - 1; y += 1) for (let x = 0; x < grid - 1; x += 1) { const a = y * grid + x, b = a + 1, c = a + grid, d = c + 1; indices.push(a,c,b,b,c,d); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.82, metalness:0, side:THREE.DoubleSide }))); scene.add(new THREE.HemisphereLight(0xeaf6ff,0x342b24,1.8)); const sun = new THREE.DirectionalLight(0xffe4bd,2.2); sun.position.set(-500,900,-350); scene.add(sun);
    const near = new THREE.PerspectiveCamera(48,1.5,1,5000); near.position.set(-360,300,420); near.lookAt(0,80,0); const far = new THREE.PerspectiveCamera(42,1.5,1,5000); far.position.set(0,900,1150); far.lookAt(0,40,0);
    window.__g77Near = { render(k) { renderer.render(scene, k === 'near' ? near : far); } }; window.__g77Near.render('near'); return { vertices:positions.length/3, triangles:indices.length/3 };
  }, { samples, grid, minHeight });
  const hashes = {}; for (const kind of ['near','far']) { await page.evaluate((k) => window.__g77Near.render(k), kind); const png = await page.locator('#proof').screenshot(); need(png.length > 4096, `${kind} image too small`); fs.writeFileSync(path.join(OUT, `g77-near-detail-${kind}.png`), png); hashes[kind] = sha256(png); }
  await page.evaluate(({ pixels, width, height }) => { document.body.innerHTML = '<canvas id="map" width="1200" height="800"></canvas>'; const c = document.getElementById('map'), ctx = c.getContext('2d',{alpha:false}), low = document.createElement('canvas'); low.width=width; low.height=height; const l=low.getContext('2d'), image=l.createImageData(width,height); image.data.set(pixels); l.putImageData(image,0,0); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high'; ctx.drawImage(low,0,0,1200,800); }, { pixels:Array.from(worldPixels), width:worldWidth, height:worldHeight });
  const full = await page.locator('#map').screenshot(); need(full.length > 10000, 'full-world top-down too small'); fs.writeFileSync(path.join(OUT, 'g77-near-detail-full-world-topdown.png'), full); hashes.fullWorld = sha256(full);
  need(topology.vertices === 16641 && topology.triangles === 32768, 'visual mesh topology drifted'); need(waterVertices > 3000 && overlayPixels > 5000, 'mixed coast/full-world overlay evidence too weak'); need(new Set(Object.values(hashes)).size === 3 && errors.length === 0, errors.join(' | ') || 'visual frames duplicated');
  const report = { schema:'se-g77-near-detail-authoring-visual-v1', policyId:p.policyId, sourceMapSha256:p.sourceMapSha256, vertices:topology.vertices, triangles:topology.triangles, minHeight, maxHeight, waterVertices, routeVertices, overlayPixels, fullCamera:'top-down map projection', sha256:hashes, browserErrors:errors };
  fs.writeFileSync(path.join(OUT, 'g77-near-detail-visual-metrics.json'), `${JSON.stringify(report,null,2)}\n`); console.log(`SE_G77_NEAR_DETAIL_VISUAL_METRICS=${JSON.stringify(report)}`); console.log('SE_G77_NEAR_DETAIL_VISUAL_EVIDENCE_OK');
} finally { await page.close(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
