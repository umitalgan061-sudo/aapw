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
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

const PREVIEW = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#11161a;color:#fff;font:700 18px system-ui}
#stage{position:fixed;inset:0}.badge{position:fixed;top:18px;padding:10px 16px;border-radius:10px;background:#000b;z-index:2}
#old{left:17%}#new{right:15%}#note{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#000b;padding:9px 14px;border-radius:9px;font-size:14px;z-index:2}
</style><script type="importmap">{"imports":{"three":"/src/3d/vendor/three/three.module.js","three/addons/":"/src/3d/vendor/three/addons/"}}</script></head>
<body><div id="stage"></div><div id="old" class="badge">ITERATION #08</div><div id="new" class="badge">PINDEX QUALITY V2</div><div id="note">Aynı seed + aynı yükseklik • yumuşak biome/surface sınırları • relief + PBR mikro detay</div></body></html>`;

function createServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/__pindex_quality_v2__') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PREVIEW);
      return;
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
    const {
      REFERENCE_PINDEX_QUALITY_V2_POLICY,
      sampleReferencePindexQualityV2,
    } = await import('/src/3d/world/worldReferenceSurfacePindexes.js');
    const {
      applyRuntimePindexTerrainPolishToMesh,
      applyRuntimePindexTerrainQualityV2ToMesh,
      RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY,
    } = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');

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
    for (let pindex = 1; pindex <= 10; pindex += 1) {
      allPindexes.push(sampleReferencePindexQualityV2((pindex - 0.5) / 10, 0.5).pindex);
    }

    let maxPindexSeamAmplitudeDelta = 0;
    let maxPindexSeamSurfaceDelta = 0;
    for (let boundary = 1; boundary < 10; boundary += 1) {
      const x = boundary / 10;
      const left = sampleReferencePindexQualityV2(x - 1e-7, 0.53);
      const right = sampleReferencePindexQualityV2(x + 1e-7, 0.53);
      maxPindexSeamAmplitudeDelta = Math.max(maxPindexSeamAmplitudeDelta, Math.abs(left.microAmplitude - right.microAmplitude));
      const surfaceDelta = Object.keys(left.surfaceWeights).reduce((sum, key) => sum + Math.abs(left.surfaceWeights[key] - right.surfaceWeights[key]), 0);
      maxPindexSeamSurfaceDelta = Math.max(maxPindexSeamSurfaceDelta, surfaceDelta);
    }

    const biomeChecks = [
      ['desert', 0.180, 0.665],
      ['steppe', 0.545, 0.535],
      ['mountain', 0.700, 0.530],
      ['jungle', 0.555, 0.900],
      ['cold-grassland', 0.175, 0.285],
    ].map(([kind, x, y]) => {
      const sample = sampleReferencePindexQualityV2(x, y);
      return { kind, influence: sample.biomeInfluence, kindWeight: sample.biomeKindWeights[kind] || 0, pindex: sample.pindex };
    });
    const p10 = sampleReferencePindexQualityV2(0.95, 0.55);
    const relief = sampleReferencePindexQualityV2(0.705, 0.50);

    const options = { chunkX: -7, chunkZ: 5, size: 500, segments: 48, seed: 1337 };
    const oldMesh = createTerrainChunk(options);
    const qualityMesh = createTerrainChunk(options);
    const repeatMesh = createTerrainChunk(options);
    const positionsBefore = Array.from(qualityMesh.geometry.getAttribute('position').array);
    applyRuntimePindexTerrainPolishToMesh(oldMesh);
    const oldColors = Array.from(oldMesh.geometry.getAttribute('color').array);
    const summary = applyRuntimePindexTerrainQualityV2ToMesh(qualityMesh);
    const positionsAfter = Array.from(qualityMesh.geometry.getAttribute('position').array);
    const qualityColors = Array.from(qualityMesh.geometry.getAttribute('color').array);
    const repeatSummary = applyRuntimePindexTerrainQualityV2ToMesh(repeatMesh);
    const repeatColors = Array.from(repeatMesh.geometry.getAttribute('color').array);

    let changedVertices = 0;
    let sumDelta = 0;
    let maxDelta = 0;
    for (let i = 0; i < oldColors.length; i += 3) {
      const delta = Math.hypot(qualityColors[i] - oldColors[i], qualityColors[i + 1] - oldColors[i + 1], qualityColors[i + 2] - oldColors[i + 2]);
      if (delta > 1e-8) changedVertices += 1;
      sumDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
    }
    const heightUnchanged = positionsBefore.length === positionsAfter.length && positionsBefore.every((value, index) => value === positionsAfter[index]);
    const deterministic = qualityColors.length === repeatColors.length && qualityColors.every((value, index) => value === repeatColors[index]);
    const idempotentColors = Array.from(qualityMesh.geometry.getAttribute('color').array);
    const secondSummary = applyRuntimePindexTerrainQualityV2ToMesh(qualityMesh);
    const idempotent = idempotentColors.every((value, index) => value === qualityMesh.geometry.getAttribute('color').array[index]);

    const seamA = createTerrainChunk({ chunkX: 0, chunkZ: 0, size: 500, segments: 32, seed: 1337 });
    const seamB = createTerrainChunk({ chunkX: 1, chunkZ: 0, size: 500, segments: 32, seed: 1337 });
    applyRuntimePindexTerrainQualityV2ToMesh(seamA);
    applyRuntimePindexTerrainQualityV2ToMesh(seamB);
    function edgeMap(mesh, worldX) {
      const position = mesh.geometry.getAttribute('position');
      const color = mesh.geometry.getAttribute('color');
      const result = new Map();
      for (let i = 0; i < position.count; i += 1) {
        const x = mesh.position.x + position.getX(i);
        if (Math.abs(x - worldX) > 1e-6) continue;
        const z = mesh.position.z + position.getZ(i);
        result.set(z.toFixed(6), [color.getX(i), color.getY(i), color.getZ(i), position.getY(i)]);
      }
      return result;
    }
    const edgeA = edgeMap(seamA, 250);
    const edgeB = edgeMap(seamB, 250);
    let maxChunkSeamColorDelta = 0;
    let maxChunkSeamHeightDelta = 0;
    for (const [key, a] of edgeA) {
      const b = edgeB.get(key);
      if (!b) continue;
      maxChunkSeamColorDelta = Math.max(maxChunkSeamColorDelta, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      maxChunkSeamHeightDelta = Math.max(maxChunkSeamHeightDelta, Math.abs(a[3] - b[3]));
    }

    oldMesh.position.set(-330, 0, 0);
    qualityMesh.position.set(330, 0, 0);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x11161a);
    scene.add(oldMesh, qualityMesh);
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x283024, 2.2));
    const sun = new THREE.DirectionalLight(0xffefd0, 3.0);
    sun.position.set(-250, 500, 300); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 3000);
    camera.position.set(0, 480, 900); camera.lookAt(0, 15, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('stage').appendChild(renderer.domElement);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    const programs = renderer.info.programs?.length || 0;

    window.__pindexQualityCleanup = () => {
      for (const mesh of [oldMesh, qualityMesh, repeatMesh, seamA, seamB]) disposeTerrainChunk(mesh);
      renderer.dispose(); renderer.domElement.remove();
    };

    return {
      samplingPolicyId: REFERENCE_PINDEX_QUALITY_V2_POLICY.id,
      runtimePolicyId: RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id,
      allPindexes,
      p10: { pindex: p10.pindex, dominantSurface: p10.dominantSurface, microAmplitude: p10.microAmplitude },
      reliefInfluence: relief.reliefInfluence,
      biomeChecks,
      maxWeightError,
      blendedSamples,
      maxPindexSeamAmplitudeDelta,
      maxPindexSeamSurfaceDelta,
      vertexCount: summary.vertexCount,
      changedVertices,
      meanColorDelta: sumDelta / summary.vertexCount,
      maxColorDelta: maxDelta,
      heightUnchanged,
      deterministic,
      idempotent,
      idempotentPolicyStable: secondSummary.policyId === summary.policyId,
      repeatPolicyStable: repeatSummary.policyId === summary.policyId,
      softenedBoundaryVertices: summary.softenedBoundaryVertices,
      biomeVertices: summary.biomeVertices,
      reliefVertices: summary.reliefVertices,
      elevationRockVertices: summary.elevationRockVertices,
      activeBiomeKinds: summary.activeBiomeKinds,
      pindexVertexCounts: summary.pindexVertexCounts,
      maxChunkSeamColorDelta,
      maxChunkSeamHeightDelta,
      chunkSeamSamples: edgeA.size,
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
    assert(proof.allPindexes.join(',') === '1,2,3,4,5,6,7,8,9,10', `P01..P10 coverage failed: ${proof.allPindexes}`);
    assert(proof.p10.pindex === 10, 'Pindex-10 is not covered by Quality V2');
    assert(proof.maxWeightError < 1e-5, `Surface weights are not normalized: ${proof.maxWeightError}`);
    assert(proof.blendedSamples > 300, `Too few softened semantic samples: ${proof.blendedSamples}`);
    assert(proof.maxPindexSeamAmplitudeDelta < 1e-5, `Pindex profile seam detected: ${proof.maxPindexSeamAmplitudeDelta}`);
    assert(proof.maxPindexSeamSurfaceDelta < 0.001, `Pindex surface seam detected: ${proof.maxPindexSeamSurfaceDelta}`);
    for (const biome of proof.biomeChecks) assert(biome.influence > 0.5 && biome.kindWeight > 0.5, `Biome anchor weak: ${JSON.stringify(biome)}`);
    assert(proof.reliefInfluence > 0.8, `Bone Mountains relief chain weak: ${proof.reliefInfluence}`);
    assert(proof.changedVertices === proof.vertexCount, `Quality pass did not change every tested vertex: ${proof.changedVertices}/${proof.vertexCount}`);
    assert(proof.meanColorDelta > 0.025, `Quality visual delta too small: ${proof.meanColorDelta}`);
    assert(proof.heightUnchanged, 'Quality V2 changed terrain position/height data');
    assert(proof.deterministic && proof.repeatPolicyStable, 'Quality V2 is not deterministic across identical chunks');
    assert(proof.idempotent && proof.idempotentPolicyStable, 'Quality V2 is not idempotent');
    assert(proof.chunkSeamSamples >= 30, `Insufficient chunk seam samples: ${proof.chunkSeamSamples}`);
    assert(proof.maxChunkSeamColorDelta < 1e-6, `Visible chunk color seam detected: ${proof.maxChunkSeamColorDelta}`);
    assert(proof.maxChunkSeamHeightDelta < 1e-9, `Chunk boundary height drift detected: ${proof.maxChunkSeamHeightDelta}`);
    assert(proof.shaderInstalled && proof.shaderPrograms > 0, 'PBR micro-detail shader did not compile/install');
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
