#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'terrain-pindex-quality-v2');
const assert = (value, message) => { if (!value) throw new Error(message); };

function playwright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch {}
  }
  return null;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}

const PREVIEW = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#11161a;color:#fff;font:700 18px system-ui}
#stage{position:fixed;inset:0}.badge{position:fixed;top:18px;padding:10px 16px;border-radius:10px;background:#000c;z-index:2}
#old{left:17%}#new{right:14%}#note{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#000c;padding:9px 14px;border-radius:9px;font-size:14px;z-index:2;white-space:nowrap}
</style><script type="importmap">{"imports":{"three":"/src/3d/vendor/three/three.module.js","three/addons/":"/src/3d/vendor/three/addons/"}}</script></head>
<body><div id="stage"></div><div id="old" class="badge">ITERATION #08</div><div id="new" class="badge">PINDEX QUALITY V2</div><div id="note">Aynı seed + aynı height + aynı CPU vertex rengi • fark GPU biome / relief / PBR shading</div></body></html>`;

function createServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/__pindex_quality_v2__') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PREVIEW); return;
    }
    const file = path.join(ROOT, clean === '/' ? 'game3d.html' : clean.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'content-type': contentType(file) });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function buildProof(page) {
  return page.evaluate(async () => {
    const THREE = await import('three');
    const { createTerrainChunk, disposeTerrainChunk } = await import('/src/3d/world/terrain.js');
    const pindexModule = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    const visualImportStart = performance.now();
    const visualModule = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');
    const visualImportMs = performance.now() - visualImportStart;
    const { REFERENCE_PINDEX_QUALITY_V2_POLICY, sampleReferencePindexQualityV2 } = pindexModule;
    const {
      applyRuntimePindexTerrainPolishToMesh,
      applyRuntimePindexTerrainQualityV2ToMesh,
      RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY,
    } = visualModule;

    const sumWeights = (sample) => Object.values(sample.surfaceWeights).reduce((sum, value) => sum + value, 0);
    const allPindexes = [];
    let maxWeightError = 0;
    let blendedSamples = 0;
    for (let yi = 0; yi <= 64; yi += 1) {
      for (let xi = 0; xi <= 96; xi += 1) {
        const sample = sampleReferencePindexQualityV2(xi / 96, yi / 64);
        maxWeightError = Math.max(maxWeightError, Math.abs(1 - sumWeights(sample)));
        if (sample.boundaryBlend > 0.05) blendedSamples += 1;
      }
    }
    for (let pindex = 1; pindex <= 10; pindex += 1) allPindexes.push(sampleReferencePindexQualityV2((pindex - 0.5) / 10, 0.5).pindex);

    let maxPindexSeamAmplitudeDelta = 0;
    let maxPindexSeamSurfaceDelta = 0;
    for (let boundary = 1; boundary < 10; boundary += 1) {
      const x = boundary / 10;
      const left = sampleReferencePindexQualityV2(x - 1e-7, 0.53);
      const right = sampleReferencePindexQualityV2(x + 1e-7, 0.53);
      maxPindexSeamAmplitudeDelta = Math.max(maxPindexSeamAmplitudeDelta, Math.abs(left.microAmplitude - right.microAmplitude));
      maxPindexSeamSurfaceDelta = Math.max(maxPindexSeamSurfaceDelta, Object.keys(left.surfaceWeights).reduce((sum, key) => sum + Math.abs(left.surfaceWeights[key] - right.surfaceWeights[key]), 0));
    }

    const biomeChecks = [
      ['desert', 0.180, 0.665], ['steppe', 0.545, 0.535], ['mountain', 0.700, 0.530],
      ['jungle', 0.555, 0.900], ['cold-grassland', 0.175, 0.285], ['arid', 0.925, 0.555],
    ].map(([kind, x, y]) => {
      const sample = sampleReferencePindexQualityV2(x, y);
      return { kind, influence: sample.biomeInfluence, kindWeight: sample.biomeKindWeights[kind] || 0, pindex: sample.pindex };
    });
    const p10 = sampleReferencePindexQualityV2(0.95, 0.55);
    const relief = sampleReferencePindexQualityV2(0.705, 0.50);
    const deterministicSampleA = sampleReferencePindexQualityV2(0.71325, 0.5275);
    const deterministicSampleB = sampleReferencePindexQualityV2(0.71325, 0.5275);
    const samplerDeterministic = JSON.stringify(deterministicSampleA) === JSON.stringify(deterministicSampleB);

    const options = { chunkX: -7, chunkZ: 5, size: 500, segments: 48, seed: 1337 };
    const oldMesh = createTerrainChunk(options);
    const qualityMesh = createTerrainChunk(options);
    const positionsBefore = Array.from(qualityMesh.geometry.getAttribute('position').array);
    applyRuntimePindexTerrainPolishToMesh(oldMesh);
    const oldColors = Array.from(oldMesh.geometry.getAttribute('color').array);
    const qualityApplyStart = performance.now();
    const summary = applyRuntimePindexTerrainQualityV2ToMesh(qualityMesh);
    const qualityApplyMs = performance.now() - qualityApplyStart;
    const positionsAfter = Array.from(qualityMesh.geometry.getAttribute('position').array);
    const qualityColors = Array.from(qualityMesh.geometry.getAttribute('color').array);
    const secondSummary = applyRuntimePindexTerrainQualityV2ToMesh(qualityMesh);
    const heightUnchanged = positionsBefore.length === positionsAfter.length && positionsBefore.every((value, index) => value === positionsAfter[index]);
    const cpuColorArraysEqual = oldColors.length === qualityColors.length && oldColors.every((value, index) => value === qualityColors[index]);
    const idempotent = secondSummary === summary;

    function sceneFor(mesh) {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x11161a);
      scene.add(mesh);
      scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x283024, 2.2));
      const sun = new THREE.DirectionalLight(0xffefd0, 3.0);
      sun.position.set(mesh.position.x - 250, 500, mesh.position.z + 300); scene.add(sun);
      return scene;
    }
    const oldScene = sceneFor(oldMesh);
    const qualityScene = sceneFor(qualityMesh);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);
    camera.position.set(qualityMesh.position.x, 420, qualityMesh.position.z + 550);
    camera.lookAt(qualityMesh.position.x, 18, qualityMesh.position.z);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(1440, 900, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.compile(oldScene, camera);
    renderer.compile(qualityScene, camera);

    const targetSize = 384;
    const targetOld = new THREE.WebGLRenderTarget(targetSize, targetSize);
    const targetQuality = new THREE.WebGLRenderTarget(targetSize, targetSize);
    const targetRepeat = new THREE.WebGLRenderTarget(targetSize, targetSize);
    const oldPixels = new Uint8Array(targetSize * targetSize * 4);
    const qualityPixels = new Uint8Array(oldPixels.length);
    const repeatPixels = new Uint8Array(oldPixels.length);
    renderer.setRenderTarget(targetOld); renderer.render(oldScene, camera); renderer.readRenderTargetPixels(targetOld, 0, 0, targetSize, targetSize, oldPixels);
    renderer.setRenderTarget(targetQuality); renderer.render(qualityScene, camera); renderer.readRenderTargetPixels(targetQuality, 0, 0, targetSize, targetSize, qualityPixels);
    renderer.setRenderTarget(targetRepeat); renderer.render(qualityScene, camera); renderer.readRenderTargetPixels(targetRepeat, 0, 0, targetSize, targetSize, repeatPixels);
    renderer.setRenderTarget(null);

    let visualDeltaSum = 0;
    let visualChangedPixels = 0;
    for (let i = 0; i < oldPixels.length; i += 4) {
      const delta = (Math.abs(oldPixels[i] - qualityPixels[i]) + Math.abs(oldPixels[i + 1] - qualityPixels[i + 1]) + Math.abs(oldPixels[i + 2] - qualityPixels[i + 2])) / 3;
      visualDeltaSum += delta;
      if (delta > 3) visualChangedPixels += 1;
    }
    const visualMeanPixelDelta = visualDeltaSum / (oldPixels.length / 4);
    const gpuDeterministic = qualityPixels.every((value, index) => value === repeatPixels[index]);

    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = (innerWidth * 0.5) / innerHeight; camera.updateProjectionMatrix();
    renderer.setScissorTest(true); renderer.setViewport(0, 0, innerWidth * 0.5, innerHeight); renderer.setScissor(0, 0, innerWidth * 0.5, innerHeight); renderer.render(oldScene, camera);
    renderer.setViewport(innerWidth * 0.5, 0, innerWidth * 0.5, innerHeight); renderer.setScissor(innerWidth * 0.5, 0, innerWidth * 0.5, innerHeight); renderer.render(qualityScene, camera);
    renderer.setScissorTest(false);
    document.getElementById('stage').appendChild(renderer.domElement);

    const programs = renderer.info.programs?.length || 0;
    window.__pindexQualityCleanup = () => {
      disposeTerrainChunk(oldMesh); disposeTerrainChunk(qualityMesh);
      targetOld.dispose(); targetQuality.dispose(); targetRepeat.dispose();
      renderer.dispose(); renderer.domElement.remove();
    };
    return {
      samplingPolicyId: REFERENCE_PINDEX_QUALITY_V2_POLICY.id,
      runtimePolicyId: RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id,
      atlasResolution: summary.atlasResolution,
      allPindexes,
      p10: { pindex: p10.pindex, dominantSurface: p10.dominantSurface, microAmplitude: p10.microAmplitude },
      reliefInfluence: relief.reliefInfluence,
      biomeChecks,
      maxWeightError,
      blendedSamples,
      maxPindexSeamAmplitudeDelta,
      maxPindexSeamSurfaceDelta,
      heightUnchanged,
      cpuColorArraysEqual,
      cpuVertexPassesAdded: summary.cpuVertexPassesAdded,
      samplerDeterministic,
      gpuDeterministic,
      idempotent,
      qualityApplyMs,
      visualImportMs,
      visualMeanPixelDelta,
      visualChangedPixels,
      visualChangedRatio: visualChangedPixels / (targetSize * targetSize),
      shaderPrograms: programs,
      shaderInstalled: qualityMesh.material.userData.runtimePindexQualityV2Shader === RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id,
    };
  });
}

async function main() {
  const pw = playwright();
  if (!pw) throw new Error('Playwright unavailable');
  fs.mkdirSync(OUT, { recursive: true });
  const server = await createServer();
  const browser = await pw.chromium.launch({ headless: true });
  const errors = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/__pindex_quality_v2__`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const proof = await buildProof(page);
    assert(proof.runtimePolicyId.endsWith('-v2'), `Unexpected runtime policy: ${proof.runtimePolicyId}`);
    assert(proof.atlasResolution.join('x') === '192x128', `Atlas resolution drift: ${proof.atlasResolution}`);
    assert(proof.allPindexes.join(',') === '1,2,3,4,5,6,7,8,9,10', `P01..P10 coverage failed: ${proof.allPindexes}`);
    assert(proof.p10.pindex === 10, 'Pindex-10 is not covered');
    assert(proof.maxWeightError < 1e-5, `Surface weights not normalized: ${proof.maxWeightError}`);
    assert(proof.blendedSamples > 300, `Too few softened semantic samples: ${proof.blendedSamples}`);
    assert(proof.maxPindexSeamAmplitudeDelta < 1e-5, `Pindex profile seam: ${proof.maxPindexSeamAmplitudeDelta}`);
    assert(proof.maxPindexSeamSurfaceDelta < 0.001, `Pindex surface seam: ${proof.maxPindexSeamSurfaceDelta}`);
    for (const biome of proof.biomeChecks) assert(biome.influence > 0.5 && biome.kindWeight > 0.5, `Biome anchor weak: ${JSON.stringify(biome)}`);
    assert(proof.reliefInfluence > 0.8, `Relief chain weak: ${proof.reliefInfluence}`);
    assert(proof.heightUnchanged, 'Quality V2 changed terrain geometry/height');
    assert(proof.cpuColorArraysEqual, 'Quality V2 unexpectedly added a second CPU vertex-color rewrite');
    assert(proof.cpuVertexPassesAdded === 0, `Unexpected V2 CPU vertex passes: ${proof.cpuVertexPassesAdded}`);
    assert(proof.samplerDeterministic && proof.gpuDeterministic, 'Sampler/GPU output is not deterministic');
    assert(proof.idempotent, 'Quality V2 mesh application is not idempotent');
    assert(proof.visualMeanPixelDelta > 1.0, `Rendered visual delta too small: ${proof.visualMeanPixelDelta}`);
    assert(proof.visualChangedRatio > 0.08, `Too few rendered pixels changed: ${proof.visualChangedRatio}`);
    assert(proof.shaderInstalled && proof.shaderPrograms > 0, 'PBR quality shader did not compile/install');
    assert(proof.visualImportMs < 2000, `Atlas build/import unexpectedly slow: ${proof.visualImportMs}ms`);
    assert(proof.qualityApplyMs < 1000, `Single-chunk quality application unexpectedly slow: ${proof.qualityApplyMs}ms`);
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, 'iteration08-vs-quality-v2.png'), fullPage: true });
    fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify({ ...proof, consoleErrors: errors.length }, null, 2) + '\n');
    await page.evaluate(() => window.__pindexQualityCleanup?.());
    console.log(`[checkTerrainPindexQualityV2Browser] PASS ${JSON.stringify(proof)}`);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkTerrainPindexQualityV2Browser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
