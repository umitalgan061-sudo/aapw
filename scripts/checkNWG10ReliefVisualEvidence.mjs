#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/nw-g10-relief-visual');
const EXPECTED_MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(`[checkNWG10ReliefVisualEvidence] ${message}`); };

const playwright = loadPlaywright();
need(playwright, 'Playwright unavailable');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 20000 });
  const metrics = await page.evaluate(async () => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { G10_RELIEF_POLICY, sampleG10ReliefHeight } = await import('/godot/terrain-authoring/geocells/nw/g10_relief.mjs');
    const { WORLD_REFERENCE_BASE_SURFACE_MASK, sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c1720);
    const size = 129, positions = [], colors = [], indices = [], b = G10_RELIEF_POLICY.bounds;
    let min = Infinity, max = -Infinity;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (size - 1), ny = b.yMin + (b.yMax - b.yMin) * y / (size - 1);
      const h = sampleG10ReliefHeight(nx, ny); min = Math.min(min, h); max = Math.max(max, h);
      positions.push((x / (size - 1) - 0.5) * 900, h * 3.2, (y / (size - 1) - 0.5) * 900);
      const wet = h < 0 ? 1 : 0, t = Math.min(1, Math.max(0, (h + 8) / 90));
      colors.push(wet ? 0.17 : 0.24 + t * 0.32, wet ? 0.34 : 0.34 + t * 0.28, wet ? 0.43 : 0.24 + t * 0.38);
    }
    for (let y = 0; y < size - 1; y += 1) for (let x = 0; x < size - 1; x += 1) {
      const a = y * size + x, c = a + size; indices.push(a, c, a + 1, a + 1, c, c + 1);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide })));
    scene.add(new THREE.HemisphereLight(0xe5f3ff, 0x202a30, 1.7)); const sun = new THREE.DirectionalLight(0xffe8c4, 2.1); sun.position.set(-400, 650, -300); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(48, 1.5, 1, 5000);
    window.__g10Render = (mode) => { camera.position.set(mode === 'near' ? -420 : 0, mode === 'near' ? 300 : 900, mode === 'near' ? 520 : 1000); camera.lookAt(0, 30, 0); renderer.render(scene, camera); };
    window.__g10Render('near');
    window.__g10Top = () => {
      const ctx = canvas.getContext?.('2d'); return Boolean(ctx);
    };
    return { vertices: positions.length / 3, triangles: indices.length / 3, minHeight: min, maxHeight: max,
      sourceMapSha256: G10_RELIEF_POLICY.sourceMapSha256, sourceWidth: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth,
      sourceHeight: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight, sampleReferencePindexQualityV2Present: typeof sampleReferencePindexQualityV2 === 'function' };
  });
  const capture = async (mode, name) => { await page.evaluate((m) => window.__g10Render(m), mode); const bytes = await page.locator('#terrain-proof').screenshot(); need(bytes.length > 1500, `${mode} PNG too small`); fs.writeFileSync(path.join(OUT_DIR, name), bytes); return sha(bytes); };
  const nearSha = await capture('near', 'g10-relief-near.png');
  const farSha = await capture('far', 'g10-relief-far.png');
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(async () => {
    const { sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    document.body.innerHTML = '<canvas id="world-proof" width="1200" height="800"></canvas>';
    const canvas = document.getElementById('world-proof'), ctx = canvas.getContext('2d'), low = document.createElement('canvas');
    low.width = 384; low.height = 256; const lctx = low.getContext('2d'), image = lctx.createImageData(384, 256);
    const palette = { sea:[35,72,91], lake:[70,119,131], soil:[122,133,84], rock:[112,105,96], snow:[218,225,222] };
    for (let y = 0; y < 256; y += 1) for (let x = 0; x < 384; x += 1) {
      const s = sampleReferencePindexQualityV2((x + .5) / 384, (y + .5) / 256), o = (y * 384 + x) * 4; let r=0,g=0,b=0;
      for (const [name,c] of Object.entries(palette)) { const w=s.surfaceWeights[name] ?? 0; r+=c[0]*w; g+=c[1]*w; b+=c[2]*w; }
      image.data[o]=r; image.data[o+1]=g; image.data[o+2]=b; image.data[o+3]=255;
    }
    lctx.putImageData(image,0,0); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high'; ctx.drawImage(low,0,0,1200,800);
  });
  const topBytes = await page.locator('#world-proof').screenshot(); fs.writeFileSync(path.join(OUT_DIR, 'g10-relief-full-world-topdown.png'), topBytes); const topSha = sha(topBytes);
  need(errors.length === 0, `page errors: ${errors.join(' | ')}`); need(metrics.vertices === 16641 && metrics.triangles === 32768, 'visual mesh topology drift');
  need(metrics.minHeight < 0 && metrics.maxHeight > 0, 'visual relief lost coast/land height span'); need(metrics.sourceMapSha256 === EXPECTED_MAP_SHA, 'map provenance drift');
  need(metrics.sourceWidth === 1536 && metrics.sourceHeight === 1024, 'canonical source dimensions drift'); need(nearSha !== farSha && farSha !== topSha && nearSha !== topSha, 'near/far/top-down evidence must be distinct');
  fs.writeFileSync(path.join(OUT_DIR, 'metrics.json'), `${JSON.stringify({ ...metrics, nearSha, farSha, topSha, visibleGeoCellOverlay: false }, null, 2)}\n`);
  console.log('NW_G10_RELIEF_VISUAL_EVIDENCE_OK');
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
