#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import devServerHelper from './devServerHelper.js';
import { buildG71Terrain3DBiomeSource, measureG71Terrain3DBiome } from '../godot/terrain-authoring/geocells/ne/g71_biome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv.find((value) => value.startsWith('--out-dir='));
const OUT = path.resolve(ROOT, arg ? arg.slice(10) : 'artifacts/ne-g71-biome-visual');
const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const source = buildG71Terrain3DBiomeSource();
const metrics = measureG71Terrain3DBiome();
const { loadPlaywright, startStaticServer } = devServerHelper;
const requireOk = (ok, message) => { if (!ok) throw new Error(message); };
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

requireOk(source.sourceMapSha256 === MAP_SHA, 'map.png provenance drifted');
requireOk(metrics.canonicalSea === 96 && metrics.canonicalLand === 0, 'G71 must remain canonical open sea');
requireOk(metrics.denseNonSeaSamples === 0, 'G71 visual source invented non-sea semantics');
requireOk(metrics.maxAdjacentColorDelta === 0 && metrics.maxAdjacentRoughnessDelta === 0, 'G71 developed a grid-visible material step');

const playwright = loadPlaywright();
requireOk(Boolean(playwright), 'Playwright is required');
fs.mkdirSync(OUT, { recursive: true });
const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const hashes = {};
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const perspective = await page.evaluate(async (biome) => {
    const THREE = await import('/src/3d/vendor/three/three.module.js');
    document.body.innerHTML = '<canvas id="proof" width="960" height="640"></canvas>';
    document.body.style.margin = '0';
    const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('#proof'), antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640, false);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x071722);
    const camera = new THREE.PerspectiveCamera(48, 1.5, 1, 5000);
    const positions = [], colors = [], indices = [];
    for (let y = 0; y < biome.height; y += 1) for (let x = 0; x < biome.width; x += 1) {
      const i = y * biome.width + x, u = x / (biome.width - 1), v = y / (biome.height - 1);
      positions.push((u - 0.5) * 1200, biome.heights[i] * 8, (v - 0.5) * 760);
      colors.push(biome.colorR[i], biome.colorG[i], biome.colorB[i]);
    }
    for (let y = 0; y < biome.height - 1; y += 1) for (let x = 0; x < biome.width - 1; x += 1) {
      const a = y * biome.width + x, b = a + 1, c = a + biome.width, d = c + 1;
      indices.push(a,c,b,b,c,d);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:0.86, metalness:0, side:THREE.DoubleSide });
    scene.add(new THREE.Mesh(geometry, material));
    scene.add(new THREE.HemisphereLight(0xd8efff, 0x10222a, 2));
    const sun = new THREE.DirectionalLight(0xffefd4, 2.2); sun.position.set(-420,720,-360); scene.add(sun);
    window.__g71 = { render(kind) { camera.position.set(kind === 'near' ? -330 : 0, kind === 'near' ? 220 : 930, kind === 'near' ? 470 : 1280); camera.lookAt(0,-40,0); renderer.render(scene,camera); }, dispose(){ geometry.dispose(); material.dispose(); renderer.dispose(); } };
    window.__g71.render('near');
    return { vertices:positions.length/3, triangles:indices.length/3, visibleGeoCellGrid:false };
  }, source);
  for (const kind of ['near','far']) {
    await page.evaluate((value) => window.__g71.render(value), kind);
    const png = await page.locator('#proof').screenshot();
    requireOk(png.length > 1024, `${kind} PNG unexpectedly small`);
    fs.writeFileSync(path.join(OUT, `g71-biome-${kind}.png`), png); hashes[kind] = sha256(png);
  }
  await page.evaluate(() => window.__g71.dispose());

  await page.setViewportSize({ width: 1200, height: 800 });
  const topdown = await page.evaluate(async () => {
    const { sampleReferencePindexQualityV2 } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    document.body.innerHTML = '<canvas id="world" width="1200" height="800"></canvas>';
    const canvas = document.querySelector('#world'), ctx = canvas.getContext('2d', { alpha:false });
    const low = document.createElement('canvas'); low.width = 600; low.height = 400;
    const lctx = low.getContext('2d', { alpha:false }), image = lctx.createImageData(low.width, low.height);
    const palette = { sea:[41,77,93], lake:[79,127,134], soil:[125,135,88], rock:[117,108,96], snow:[216,223,220] };
    let transitions = 0, previous = null;
    for (let y=0;y<low.height;y+=1) {
      const row=[];
      for (let x=0;x<low.width;x+=1) {
        const sample=sampleReferencePindexQualityV2((x+0.5)/low.width,(y+0.5)/low.height); row.push(sample.dominantSurface);
        if (x && row[x-1] !== row[x]) transitions += 1; if (previous && previous[x] !== row[x]) transitions += 1;
        let r=0,g=0,b=0; for (const key of Object.keys(palette)) { const w=sample.surfaceWeights[key]; r+=palette[key][0]*w; g+=palette[key][1]*w; b+=palette[key][2]*w; }
        const i=(y*low.width+x)*4; image.data.set([Math.round(r),Math.round(g),Math.round(b),255],i);
      }
      previous=row;
    }
    lctx.putImageData(image,0,0); ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high'; ctx.drawImage(low,0,0,1200,800);
    return { outputResolution:[1200,800], contextResolution:[600,400], transitionEdges:transitions, gridOverlay:false, g71PatchAlpha:0 };
  });
  const worldPng = await page.locator('#world').screenshot();
  requireOk(worldPng.length > 4096, 'full-world PNG unexpectedly small');
  requireOk(topdown.transitionEdges > 100, 'map.png-like world silhouette lost geographic transitions');
  requireOk(topdown.gridOverlay === false && topdown.g71PatchAlpha === 0, 'full-world proof exposed a G71/grid overlay');
  fs.writeFileSync(path.join(OUT, 'g71-biome-full-world.png'), worldPng); hashes.fullWorld = sha256(worldPng);
  requireOk(pageErrors.length === 0, `browser page errors: ${pageErrors.join(' | ')}`);
  const evidence = { mapSha256:MAP_SHA, sourceChecksum:source.sourceChecksum, sourceMetrics:metrics, perspective, topdown, sha256:hashes };
  fs.writeFileSync(path.join(OUT,'g71-biome-visual-metrics.json'), `${JSON.stringify(evidence,null,2)}\n`);
  console.log(`G71_BIOME_VISUAL_METRICS=${JSON.stringify(evidence)}`);
  console.log('NE_G71_BIOME_VISUAL_EVIDENCE_OK');
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
