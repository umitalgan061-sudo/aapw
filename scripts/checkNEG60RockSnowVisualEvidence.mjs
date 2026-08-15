#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { buildG60Terrain3DRockSnowProbe, measureG60Terrain3DRockSnow } from '../godot/terrain-authoring/geocells/ne/g60_rock_snow.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((value) => value.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/ne-g60-rock-snow-visual');
const probe = buildG60Terrain3DRockSnowProbe();
const metrics = measureG60Terrain3DRockSnow();
const requireOk = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
requireOk(metrics.canonicalSea === 96 && metrics.canonicalLand === 0, 'G60 must remain 96/96 sea');
requireOk(metrics.maxRockWeight === 0 && metrics.maxSnowWeight === 0, 'terrestrial overlay leaked before rendering');

const playwright = devServerHelper.loadPlaywright();
requireOk(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT, { recursive: true });
const server = await devServerHelper.startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const hashes = {};
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const local = await page.evaluate(async (source) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    document.body.innerHTML = '<canvas id="proof" width="960" height="640"></canvas>';
    document.body.style.margin = '0';
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#proof'), antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x071722);
    const camera = new THREE.PerspectiveCamera(48, 1.5, 1, 5000);
    const positions = [], colors = [], indices = []; let maxOverlay = 0, minHeight = Infinity, maxHeight = -Infinity;
    for (let y = 0; y < 65; y += 1) for (let x = 0; x < 65; x += 1) {
      const s = source.rows[y][x]; maxOverlay = Math.max(maxOverlay, s[0], s[1], s[2], s[4]);
      minHeight = Math.min(minHeight, s[3]); maxHeight = Math.max(maxHeight, s[3]);
      positions.push((x / 64 - 0.5) * 1200, s[3] * 8, (y / 64 - 0.5) * 760);
      const shade = 0.96 + (1 - s[8]) * 0.12; colors.push(s[5] * shade, s[6] * shade, s[7] * shade);
    }
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
      const a = y * 65 + x, b = a + 1, c = a + 65, d = c + 1; indices.push(a, c, b, b, c, d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, side: THREE.DoubleSide });
    scene.add(new THREE.Mesh(geometry, material)); scene.add(new THREE.HemisphereLight(0xd8efff, 0x10222a, 2));
    const sun = new THREE.DirectionalLight(0xffefd4, 2.2); sun.position.set(-420, 720, -360); scene.add(sun);
    window.__g60RockSnow = { render(kind) { camera.position.set(kind === 'near' ? -330 : 0, kind === 'near' ? 220 : 930, kind === 'near' ? 470 : 1280); camera.lookAt(0, -40, 0); renderer.render(scene, camera); }, dispose() { geometry.dispose(); material.dispose(); renderer.dispose(); } };
    window.__g60RockSnow.render('near');
    return { vertices: positions.length / 3, triangles: indices.length / 3, maxOverlay, minHeight, maxHeight };
  }, probe);
  requireOk(local.vertices === 4225 && local.triangles === 8192, 'local proof mesh dimensions drifted');
  requireOk(local.maxOverlay === 0 && local.maxHeight === -8 && local.minHeight === -8, 'local proof invented Rock/Snow or relief');
  for (const kind of ['near', 'far']) {
    await page.evaluate((value) => window.__g60RockSnow.render(value), kind);
    const png = await page.locator('#proof').screenshot(); requireOk(png.length > 1024, `${kind} PNG unexpectedly small`);
    fs.writeFileSync(path.join(OUT, `g60-rock-snow-${kind}.png`), png); hashes[kind] = sha256(png);
  }
  await page.evaluate(() => window.__g60RockSnow.dispose());

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdown = await page.evaluate(async () => {
    const { sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    document.body.innerHTML = '<canvas id="world" width="1200" height="800"></canvas>';
    const canvas = document.querySelector('#world'); const ctx = canvas.getContext('2d', { alpha: false });
    const low = document.createElement('canvas'); low.width = 600; low.height = 400;
    const lctx = low.getContext('2d', { alpha: false }); const image = lctx.createImageData(600, 400);
    const palette = { sea:[41,77,93], lake:[79,127,134], soil:[125,135,88], rock:[117,108,96], snow:[216,223,220] };
    let transitionEdges = 0, previous = null;
    for (let y = 0; y < 400; y += 1) { const row = [];
      for (let x = 0; x < 600; x += 1) {
        const s = sampleReferencePindexQualityV2((x + 0.5) / 600, (y + 0.5) / 400); row.push(s.dominantSurface);
        if (x && row[x - 1] !== row[x]) transitionEdges += 1; if (previous && previous[x] !== row[x]) transitionEdges += 1;
        let r=0,g=0,b=0; for (const [name, color] of Object.entries(palette)) { const w=s.surfaceWeights[name]; r+=color[0]*w; g+=color[1]*w; b+=color[2]*w; }
        image.data.set([Math.round(r),Math.round(g),Math.round(b),255], (y * 600 + x) * 4);
      } previous = row;
    }
    lctx.putImageData(image, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.filter = 'blur(4px)'; ctx.drawImage(low, 0, 0, 1200, 800); ctx.filter = 'none';
    const pixels = ctx.getImageData(0, 0, 1200, 800).data; let maxAdjacentChannelDelta = 0;
    const compare = (a,b) => { for (let c=0;c<3;c+=1) maxAdjacentChannelDelta=Math.max(maxAdjacentChannelDelta,Math.abs(pixels[a+c]-pixels[b+c])); };
    for (let y=0;y<800;y+=1) for (let x=0;x<1200;x+=1) { const i=(y*1200+x)*4; if(x)compare(i,i-4); if(y)compare(i,i-4800); }
    return { outputResolution:[1200,800], contextResolution:[600,400], transitionEdges, g60PatchAlpha:0, gridOverlay:false, maxAdjacentChannelDelta };
  });
  requireOk(topdown.transitionEdges > 100, 'full-world geographic transitions disappeared');
  requireOk(topdown.g60PatchAlpha === 0 && topdown.gridOverlay === false, 'G60 square/grid overlay appeared');
  requireOk(topdown.maxAdjacentChannelDelta <= 16, `full-world hard edge detected: ${topdown.maxAdjacentChannelDelta}`);
  const worldPng = await page.locator('#world').screenshot(); requireOk(worldPng.length > 4096, 'full-world PNG unexpectedly small');
  fs.writeFileSync(path.join(OUT, 'g60-rock-snow-full-world.png'), worldPng); hashes.fullWorld = sha256(worldPng);
  requireOk(new Set(Object.values(hashes)).size === 3, 'near/far/full-world evidence must be distinct');
  requireOk(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
  const output = { sourceMapSha256: probe.sourceMapSha256, surfaceMetrics: metrics, local, topdown, sha256: hashes };
  fs.writeFileSync(path.join(OUT, 'g60-rock-snow-visual-metrics.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(`G60_ROCK_SNOW_VISUAL_METRICS=${JSON.stringify(output)}`); console.log('NE_G60_ROCK_SNOW_VISUAL_EVIDENCE_OK');
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
