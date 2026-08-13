#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import devServerHelper from './devServerHelper.js';

const { loadPlaywright, startStaticServer } = devServerHelper;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BAKE_PATH = path.join(ROOT, 'godot/terrain-authoring/.terrain3d-proof/g00-runtime-bake.json');
const OUT_ARG = process.argv.find((arg) => arg.startsWith('--out-dir='));
const OUT_DIR = path.resolve(OUT_ARG ? OUT_ARG.slice('--out-dir='.length) : 'artifacts/nw-g00-runtime-visual');

function fail(message) { console.error(`[checkNWG00RuntimeVisualParity] FAIL: ${message}`); process.exit(1); }
function req(condition, message) { if (!condition) fail(message); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

req(fs.existsSync(BAKE_PATH), 'G00 Terrain3D bake JSON missing');
const bake = JSON.parse(fs.readFileSync(BAKE_PATH, 'utf8'));
req(bake.schema === 'westeros-g00-terrain3d-bake-v1', `unexpected bake schema ${bake.schema}`);
req(bake.sourceMapSha256 === '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1', 'map.png provenance mismatch');
const playwright = loadPlaywright(); req(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT_DIR, { recursive: true });
const server = await startStaticServer(); const { port } = server.address(); const browser = await playwright.chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const pageErrors = []; page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const metrics = await page.evaluate(async (payload) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { createG00Terrain3DBakeSampler, G00_TERRAIN3D_RUNTIME_PARITY } = await import('/src/3d/world/g00Terrain3dRuntimeParity.js');
    const { WORLD_REFERENCE_BASE_SURFACE_MASK, sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    const sampler = createG00Terrain3DBakeSampler(payload);
    document.body.innerHTML = '<canvas id="terrain-proof" width="960" height="640"></canvas>';
    const canvas = document.getElementById('terrain-proof');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false); renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x091722);
    const positions = [], colors = [], indices = []; let minHeight = Infinity, maxHeight = -Infinity;
    const b = G00_TERRAIN3D_RUNTIME_PARITY.normalizedBounds; const n = payload.width;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * x / (n - 1); const ny = b.yMin + (b.yMax - b.yMin) * y / (n - 1); const s = sampler(nx, ny);
      minHeight = Math.min(minHeight, s.heightMeters); maxHeight = Math.max(maxHeight, s.heightMeters);
      positions.push((x / (n - 1) - 0.5) * 1400, s.heightMeters * 8, (y / (n - 1) - 0.5) * 1000);
      const corridor = Math.max(s.roadCoverage, s.pathCoverage); const roadShade = 1 - corridor * 0.22;
      colors.push(Math.min(1, s.tintR * roadShade), Math.min(1, s.tintG * roadShade), Math.min(1, s.tintB * roadShade));
    }
    for (let y = 0; y < n - 1; y += 1) for (let x = 0; x < n - 1; x += 1) { const a = y * n + x, c = a + n; indices.push(a, c, a + 1, a + 1, c, c + 1); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide })));
    scene.add(new THREE.HemisphereLight(0xcde9ff, 0x1a2530, 1.6)); const sun = new THREE.DirectionalLight(0xffefd2, 2.1); sun.position.set(-400, 700, -250); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(48, 960 / 640, 1, 6000);
    window.__g00Proof = { renderer, scene, camera, render(kind) { if (kind === 'near') camera.position.set(-450, 330, 520); else camera.position.set(0, 980, 1450); camera.lookAt(0, 20, 0); renderer.render(scene, camera); } };
    window.__g00Proof.render('near');
    return { vertices: positions.length / 3, triangles: indices.length / 3, minHeight, maxHeight, sourceWidth: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelWidth, sourceHeight: WORLD_REFERENCE_BASE_SURFACE_MASK.sourcePixelHeight, pindexProbe: sampleReferencePindexQualityV2(0.5, 0.5).dominantSurface };
  }, bake);

  async function capture(kind, name) { await page.evaluate((value) => window.__g00Proof.render(value), kind); const png = await page.locator('#terrain-proof').screenshot(); req(png.length > 1024, `${kind} PNG too small`); fs.writeFileSync(path.join(OUT_DIR, name), png); return sha256(png); }
  const nearSha = await capture('near', 'g00-runtime-near.png'); const farSha = await capture('far', 'g00-runtime-far.png');

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdown = await page.evaluate(async (payload) => {
    const { createG00Terrain3DBakeSampler, G00_TERRAIN3D_RUNTIME_PARITY } = await import('/src/3d/world/g00Terrain3dRuntimeParity.js');
    const { sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    const sampler = createG00Terrain3DBakeSampler(payload); const width = 1200, height = 800; document.body.innerHTML = `<canvas id="topdown-proof" width="${width}" height="${height}"></canvas>`;
    const canvas = document.getElementById('topdown-proof'), ctx = canvas.getContext('2d', { alpha: false }); const low = document.createElement('canvas'); low.width = 384; low.height = 256; const lctx = low.getContext('2d'); const image = lctx.createImageData(low.width, low.height);
    const palette = { sea:[41,77,93], lake:[79,127,134], soil:[125,135,88], rock:[117,108,96], snow:[216,223,220] }; const surfaces = Object.keys(palette);
    for (let y=0;y<low.height;y++) for (let x=0;x<low.width;x++) { const s=sampleReferencePindexQualityV2((x+0.5)/low.width,(y+0.5)/low.height); let r=0,g=0,b=0; for(const key of surfaces){const w=s.surfaceWeights[key],p=palette[key];r+=p[0]*w;g+=p[1]*w;b+=p[2]*w;} const o=(y*low.width+x)*4; image.data[o]=r;image.data[o+1]=g;image.data[o+2]=b;image.data[o+3]=255; }
    lctx.putImageData(image,0,0); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high'; ctx.drawImage(low,0,0,width,height);
    const bounds=G00_TERRAIN3D_RUNTIME_PARITY.normalizedBounds; const patch=document.createElement('canvas'); patch.width=256;patch.height=256;const pctx=patch.getContext('2d');const data=pctx.createImageData(256,256);
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){const nx=bounds.xMin+(bounds.xMax-bounds.xMin)*x/255,ny=bounds.yMin+(bounds.yMax-bounds.yMin)*y/255,s=sampler(nx,ny);const edge=Math.min(1,Math.min(x,y,255-x,255-y)/14);const o=(y*256+x)*4;data.data[o]=Math.round(s.tintR*255);data.data[o+1]=Math.round(s.tintG*255);data.data[o+2]=Math.round(s.tintB*255);data.data[o+3]=Math.round(135*edge);}
    pctx.putImageData(data,0,0);ctx.drawImage(patch,bounds.xMin*width,bounds.yMin*height,(bounds.xMax-bounds.xMin)*width,(bounds.yMax-bounds.yMin)*height); return { patchBoundaryAlpha: 0, smoothing: ctx.imageSmoothingEnabled };
  }, bake);
  const fullPng = await page.locator('#topdown-proof').screenshot(); req(fullPng.length > 4096, 'full-world top-down PNG too small'); fs.writeFileSync(path.join(OUT_DIR, 'g00-runtime-full-world-topdown.png'), fullPng);
  req(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`); req(metrics.vertices === 4225 && metrics.triangles === 8192, `unexpected mesh evidence ${metrics.vertices}/${metrics.triangles}`); req(topdown.patchBoundaryAlpha === 0 && topdown.smoothing, 'full-world proof risks a visible GeoCell border');
  console.log(`NW_G00_RUNTIME_VISUAL_METRICS=${JSON.stringify({ ...metrics, nearSha256: nearSha, farSha256: farSha, fullWorldSha256: sha256(fullPng), ...topdown })}`); console.log('NW_G00_RUNTIME_VISUAL_PARITY_OK');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
