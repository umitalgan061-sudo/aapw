#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'artifacts', 'terrain-polish-iteration-008');
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

const PREVIEW_HTML = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terrain Polish Iteration 008 Visual Proof</title>
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101418;color:#fff;font:700 18px system-ui,sans-serif}
#stage{position:fixed;inset:0}
.badge{position:fixed;top:20px;padding:10px 16px;border-radius:10px;background:rgba(0,0,0,.72);letter-spacing:.04em;z-index:2}
#before{left:18%}#after{right:16%}
#note{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);padding:9px 14px;border-radius:9px;background:rgba(0,0,0,.72);font-weight:600;font-size:14px;z-index:2}
</style>
<script type="importmap">{"imports":{"three":"/src/3d/vendor/three/three.module.js","three/addons/":"/src/3d/vendor/three/addons/"}}</script>
</head>
<body>
<div id="stage"></div><div id="before" class="badge">ÖNCE — procedural terrain</div><div id="after" class="badge">SONRA — Pindex polish</div><div id="note">Aynı seed • aynı yükseklik • yalnız semantik renk + mikro yüzey detayı</div>
</body></html>`;

function createServer() {
  const server = http.createServer((req, res) => {
    const clean = decodeURIComponent(req.url.split('?')[0]);
    if (clean === '/__terrain_polish_008_preview__') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PREVIEW_HTML);
      return;
    }
    const file = path.join(ROOT, clean === '/' ? 'game3d.html' : clean.replace(/^\//, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('Not found');
      return;
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
      applyRuntimePindexTerrainPolishToMesh,
      RUNTIME_PINDEX_TERRAIN_POLISH_POLICY,
    } = await import('/src/3d/world/worldReferenceSurfaceTerrainVisual.js');

    const options = { chunkX: 0, chunkZ: 0, size: 500, segments: 32, seed: 1337 };
    const beforeMesh = createTerrainChunk(options);
    const afterMesh = createTerrainChunk(options);
    const repeatMesh = createTerrainChunk(options);
    const beforePositions = Array.from(afterMesh.geometry.getAttribute('position').array);
    const beforeColors = Array.from(afterMesh.geometry.getAttribute('color').array);
    const summary = applyRuntimePindexTerrainPolishToMesh(afterMesh);
    const afterPositions = Array.from(afterMesh.geometry.getAttribute('position').array);
    const afterColors = Array.from(afterMesh.geometry.getAttribute('color').array);
    const repeatSummary = applyRuntimePindexTerrainPolishToMesh(repeatMesh);
    const repeatColors = Array.from(repeatMesh.geometry.getAttribute('color').array);

    let changedVertices = 0;
    let sumDelta = 0;
    let maxDelta = 0;
    for (let index = 0; index < beforeColors.length; index += 3) {
      const dr = afterColors[index] - beforeColors[index];
      const dg = afterColors[index + 1] - beforeColors[index + 1];
      const db = afterColors[index + 2] - beforeColors[index + 2];
      const delta = Math.hypot(dr, dg, db);
      if (delta > 1e-8) changedVertices += 1;
      sumDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
    }
    const heightUnchanged = beforePositions.length === afterPositions.length &&
      beforePositions.every((value, index) => value === afterPositions[index]);
    const deterministic = afterColors.length === repeatColors.length &&
      afterColors.every((value, index) => value === repeatColors[index]);
    const idempotentBefore = Array.from(afterMesh.geometry.getAttribute('color').array);
    const secondSummary = applyRuntimePindexTerrainPolishToMesh(afterMesh);
    const idempotentAfter = Array.from(afterMesh.geometry.getAttribute('color').array);
    const idempotent = idempotentBefore.every((value, index) => value === idempotentAfter[index]);

    beforeMesh.position.x = -330;
    afterMesh.position.x = 330;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101418);
    scene.add(beforeMesh, afterMesh);
    const hemi = new THREE.HemisphereLight(0xe7efff, 0x25301f, 2.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d2, 2.8);
    sun.position.set(-300, 500, 250);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 3000);
    camera.position.set(0, 500, 900);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('stage').appendChild(renderer.domElement);
    renderer.render(scene, camera);

    window.__terrainPolish008Cleanup = () => {
      scene.remove(beforeMesh, afterMesh);
      disposeTerrainChunk(beforeMesh);
      disposeTerrainChunk(afterMesh);
      disposeTerrainChunk(repeatMesh);
      renderer.dispose();
      renderer.domElement.remove();
    };

    return {
      policyId: RUNTIME_PINDEX_TERRAIN_POLISH_POLICY.id,
      vertexCount: summary.vertexCount,
      summaryChangedVertices: summary.changedVertices,
      measuredChangedVertices: changedVertices,
      detailTouchedVertices: summary.detailTouchedVertices,
      activePindexes: summary.activePindexes,
      surfaceCounts: summary.counts,
      detailPolicyIds: summary.detailPolicyIds,
      meanColorDelta: sumDelta / (beforeColors.length / 3),
      maxColorDelta: maxDelta,
      heightUnchanged,
      deterministic,
      idempotent,
      idempotentPolicyStable: secondSummary.policyId === summary.policyId,
      repeatPolicyStable: repeatSummary.policyId === summary.policyId,
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
    await page.goto(`http://127.0.0.1:${server.address().port}/__terrain_polish_008_preview__`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const proof = await buildProof(page);
    assert(proof.policyId.includes('iteration-008-visible-pindex-runtime'), 'Iteration #08 policy did not load');
    assert(proof.vertexCount > 0, 'No terrain vertices were tested');
    assert(proof.summaryChangedVertices > 0 && proof.measuredChangedVertices > 0, 'Visible terrain color did not change');
    assert(proof.detailTouchedVertices > 0, 'Prepared pindex micro-detail did not touch runtime terrain');
    assert(proof.activePindexes.length > 0, 'No pindex was classified for runtime terrain');
    assert(proof.heightUnchanged, 'Terrain geometry/height changed unexpectedly');
    assert(proof.deterministic, 'Same seed/chunk did not reproduce identical polished colors');
    assert(proof.idempotent && proof.idempotentPolicyStable, 'Repeated polish application changed the same mesh twice');
    assert(proof.repeatPolicyStable, 'Repeated deterministic chunk used a different policy');
    assert(proof.meanColorDelta > 0.01, `Visual delta too small: ${proof.meanColorDelta}`);
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);
    await page.screenshot({ path: path.join(OUT, 'before-after.png'), fullPage: true });
    fs.writeFileSync(path.join(OUT, 'proof.json'), JSON.stringify({ ...proof, consoleErrors: errors.length }, null, 2) + '\n');
    await page.evaluate(() => window.__terrainPolish008Cleanup?.());
    console.log(`[checkTerrainPolishIteration08Browser] PASS ${JSON.stringify(proof)}`);
    await context.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkTerrainPolishIteration08Browser] FAIL: ${error.stack || error}`);
  process.exitCode = 1;
});
