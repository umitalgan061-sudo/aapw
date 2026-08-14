#!/usr/bin/env node
/** Run192: visual-evidence correction for the already-approved Run191 medieval stone bridge V2. */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.cwd();
const HARNESS_URL = '/scripts/fixtures/run191-bridge-harness.html';
const CORE_FIXTURE = path.join(ROOT, 'scripts', 'fixtures', 'run191-stone-bridges.json');
const OUT_DIR = path.join(ROOT, 'artifacts', 'run192-stone-bridge-visual-evidence');
const OUT_REPORT = path.join(OUT_DIR, 'proof.json');
const EXPECTED_CORE_CHECKSUM = '13fadc3dbc3d3554c583215883614a56b5e9ee406ae74d66e335fd56fe4cf7f4';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function loadPlaywright() {
  for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(id); } catch (_) { /* next */ }
  }
  return null;
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const clean = decodeURIComponent(req.url.split('?')[0]);
      const relative = clean === '/' ? 'index.html' : clean.replace(/^\//, '');
      const file = path.join(ROOT, relative);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('Not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    } catch (error) {
      res.writeHead(500); res.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function renderScene(page, bridge, mode) {
  return page.evaluate(async ({ bridge, mode }) => {
    const THREE = await import('three');
    const art = await import('/src/3d/world/worldReferenceStoneBridgeMedievalArtV2.js');
    const canvas = document.getElementById('run191-canvas');
    const width = 1600;
    const height = 900;
    canvas.width = width;
    canvas.height = height;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb8c4c8);
    const group = art.createCanonicalStoneBridgeMedievalArtV2({ bridges: [bridge] });
    for (const child of group.children) child.frustumCulled = false;
    scene.add(group);

    const dx = bridge.endX - bridge.startX;
    const dz = bridge.endZ - bridge.startZ;
    const length = Math.hypot(dx, dz) || 1;
    const ax = dx / length;
    const az = dz / length;
    const sx = -az;
    const sz = ax;
    const archBaseY = bridge.deckY - 0.6 - bridge.archRiseMeters;

    const waterLength = mode === 'detail' ? Math.max(650, bridge.structuralSpanMeters + 100) : Math.max(4300, bridge.structuralSpanMeters + 500);
    const waterWidth = mode === 'detail' ? 190 : 520;
    const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x497f92, roughness: 0.4, metalness: 0 });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(waterLength, waterWidth), waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.rotation.z = -bridge.yawRadians;
    water.position.set(bridge.centerX, archBaseY - 1.6, bridge.centerZ);
    scene.add(water);

    const bankMaterial = new THREE.MeshStandardMaterial({ color: 0x6c7354, roughness: 1, metalness: 0 });
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(waterLength + 500, waterWidth + 700), bankMaterial);
    bank.rotation.x = -Math.PI / 2;
    bank.rotation.z = -bridge.yawRadians;
    bank.position.set(bridge.centerX, archBaseY - 2.4, bridge.centerZ);
    scene.add(bank);

    const ambient = new THREE.AmbientLight(0xffffff, 1.25);
    const hemi = new THREE.HemisphereLight(0xffecd1, 0x46545d, 1.35);
    const key = new THREE.DirectionalLight(0xffd6a1, 2.4);
    key.position.set(bridge.centerX + sx * 260 - ax * 180, bridge.deckY + 360, bridge.centerZ + sz * 260 - az * 180);
    const fill = new THREE.DirectionalLight(0xd7e8ff, 0.8);
    fill.position.set(bridge.centerX - sx * 180 + ax * 100, bridge.deckY + 180, bridge.centerZ - sz * 180 + az * 100);
    scene.add(ambient, hemi, key, fill);

    const camera = new THREE.PerspectiveCamera(mode === 'detail' ? 36 : 44, width / height, 0.1, 20000);
    if (mode === 'detail') {
      const along = Math.min(bridge.structuralSpanMeters * 0.32, 120);
      const lookX = bridge.startX + ax * along;
      const lookZ = bridge.startZ + az * along;
      camera.position.set(lookX + sx * 27 - ax * 5, bridge.deckY + 9, lookZ + sz * 27 - az * 5);
      camera.lookAt(lookX + ax * 4, bridge.deckY - bridge.archRiseMeters * 0.42, lookZ + az * 4);
    } else {
      const lookAlong = Math.min(bridge.structuralSpanMeters * 0.30, 940);
      const lookX = bridge.startX + ax * lookAlong;
      const lookZ = bridge.startZ + az * lookAlong;
      camera.position.set(bridge.startX + sx * 92 - ax * 35, bridge.deckY + 40, bridge.startZ + sz * 92 - az * 35);
      camera.lookAt(lookX, bridge.deckY - bridge.archRiseMeters * 0.34, lookZ);
    }

    renderer.render(scene, camera);

    const predicted = { drawCalls: 0, triangles: 0, instances: 0 };
    for (const child of group.children) {
      if (!child.isInstancedMesh || child.count <= 0) continue;
      const trianglesPerInstance = child.geometry.index ? child.geometry.index.count / 3 : child.geometry.getAttribute('position').count / 3;
      predicted.drawCalls += 1;
      predicted.triangles += trianglesPerInstance * child.count;
      predicted.instances += child.count;
    }

    const gl = renderer.getContext();
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let luminanceSum = 0;
    let darkPixels = 0;
    let warmStonePixels = 0;
    let warmMortarContrastPixels = 0;
    const pixelCount = pixels.length / 4;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      luminanceSum += luminance;
      if (luminance < 35) darkPixels += 1;
      if (r > 82 && r > g * 1.035 && g > b * 1.035 && b < 190) warmStonePixels += 1;
      if (r > 72 && r < 180 && g > 58 && g < 165 && b < 125 && r - b > 22) warmMortarContrastPixels += 1;
    }

    const texture = group.children.map((child) => child.material?.map).find(Boolean);
    const textureCanvas = texture?.image;
    let textureRange = null;
    if (textureCanvas) {
      const ctx = textureCanvas.getContext('2d');
      const data = ctx.getImageData(0, 0, textureCanvas.width, textureCanvas.height).data;
      let min = 255;
      let max = 0;
      for (let index = 0; index < data.length; index += 16) {
        const lum = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
        min = Math.min(min, lum);
        max = Math.max(max, lum);
      }
      textureRange = { min: Math.round(min), max: Math.round(max), range: Math.round(max - min), width: textureCanvas.width, height: textureCanvas.height };
    }

    const geometrySet = new Set(group.children.map((child) => child.geometry).filter(Boolean));
    const materialSet = new Set(group.children.map((child) => child.material).filter(Boolean));
    const textureSet = new Set([...materialSet].map((material) => material.map).filter(Boolean));
    let geometryDisposals = 0;
    let materialDisposals = 0;
    let textureDisposals = 0;
    for (const geometry of geometrySet) geometry.addEventListener('dispose', () => { geometryDisposals += 1; });
    for (const material of materialSet) material.addEventListener('dispose', () => { materialDisposals += 1; });
    for (const item of textureSet) item.addEventListener('dispose', () => { textureDisposals += 1; });

    window.__run192Cleanup = () => {
      art.disposeCanonicalStoneBridgeMedievalArtV2(group);
      water.geometry.dispose();
      bank.geometry.dispose();
      waterMaterial.dispose();
      bankMaterial.dispose();
      renderer.dispose();
      return {
        children: group.children.length,
        geometryDisposals,
        materialDisposals,
        textureDisposals,
        expectedGeometries: geometrySet.size,
        expectedMaterials: materialSet.size,
        expectedTextures: textureSet.size,
      };
    };

    return {
      bridgeId: bridge.id,
      archCount: bridge.archCount,
      mode,
      predicted,
      actualSceneDrawCalls: renderer.info.render.calls,
      readability: {
        averageLuminance: Math.round((luminanceSum / pixelCount) * 100) / 100,
        darkPixelRatio: Math.round((darkPixels / pixelCount) * 100000) / 100000,
        warmStonePixelRatio: Math.round((warmStonePixels / pixelCount) * 100000) / 100000,
        warmMortarContrastPixelRatio: Math.round((warmMortarContrastPixels / pixelCount) * 100000) / 100000,
        textureRange,
      },
    };
  }, { bridge, mode });
}

async function renderEvidence(page, bridge, mode, filename) {
  const metrics = await renderScene(page, bridge, mode);
  await page.screenshot({ path: path.join(OUT_DIR, filename) });
  const dispose = await page.evaluate(() => window.__run192Cleanup());
  return { ...metrics, dispose };
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright unavailable');
  const core = JSON.parse(fs.readFileSync(CORE_FIXTURE, 'utf8'));
  assert(core.checksum === EXPECTED_CORE_CHECKSUM, `Run191 core fixture drifted: ${core.checksum}`);
  assert(core.policy === 'stone-arch-bridge', 'owner bridge policy drifted');
  assert(core.bridges.length === 7 && core.totalArchCount === 177, 'Run191 bridge topology drifted');
  const detailBridge = core.bridges.find((bridge) => bridge.id === 'robin->berkalp#1');
  const longBridge = core.bridges.find((bridge) => bridge.id === 'umit->doran#1');
  assert(detailBridge?.archCount === 14, 'detail bridge fixture mismatch');
  assert(longBridge?.archCount === 87, 'long bridge fixture mismatch');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    const url = `http://127.0.0.1:${server.address().port}${HARNESS_URL}`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const detail = await renderEvidence(page, detailBridge, 'detail', 'medieval-masonry-closeup.png');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const long = await renderEvidence(page, longBridge, 'perspective', 'medieval-87arch-perspective.png');

    for (const result of [detail, long]) {
      assert(result.predicted.drawCalls === 5, `${result.mode} bridge draw calls drifted: ${result.predicted.drawCalls}`);
      assert(result.actualSceneDrawCalls === 7, `${result.mode} scene draw calls drifted: ${result.actualSceneDrawCalls}`);
      assert(result.readability.averageLuminance > 70, `${result.mode} image too dark: ${result.readability.averageLuminance}`);
      assert(result.readability.darkPixelRatio < 0.22, `${result.mode} dark-pixel ratio too high: ${result.readability.darkPixelRatio}`);
      assert(result.readability.textureRange?.width === 512 && result.readability.textureRange?.height === 512, `${result.mode} masonry texture resolution mismatch`);
      assert(result.readability.textureRange.range > 70, `${result.mode} masonry texture contrast too low: ${result.readability.textureRange.range}`);
      assert(result.dispose.children === 0, `${result.mode} bridge group did not teardown`);
      assert(result.dispose.geometryDisposals === result.dispose.expectedGeometries, `${result.mode} geometry disposal mismatch`);
      assert(result.dispose.materialDisposals === result.dispose.expectedMaterials, `${result.mode} material disposal mismatch`);
      assert(result.dispose.textureDisposals === result.dispose.expectedTextures, `${result.mode} texture disposal mismatch`);
    }
    assert(detail.readability.warmStonePixelRatio > 0.015, `detail warm masonry not visible enough: ${detail.readability.warmStonePixelRatio}`);
    assert(long.readability.warmStonePixelRatio > 0.002, `perspective warm masonry not visible enough: ${long.readability.warmStonePixelRatio}`);
    assert(detail.readability.warmMortarContrastPixelRatio > 0.01, `detail stone/mortar contrast not visible enough: ${detail.readability.warmMortarContrastPixelRatio}`);
    assert(long.readability.warmMortarContrastPixelRatio > 0.001, `perspective stone/mortar contrast not visible enough: ${long.readability.warmMortarContrastPixelRatio}`);
    assert(errors.length === 0, `console/page errors: ${errors.join(' | ')}`);

    const images = ['medieval-masonry-closeup.png', 'medieval-87arch-perspective.png'];
    for (const name of images) {
      const file = path.join(OUT_DIR, name);
      assert(fs.statSync(file).size > 30000, `${name} is unexpectedly small/blank: ${fs.statSync(file).size} bytes`);
    }

    const report = {
      version: 'run192-medieval-stone-bridge-visual-evidence-v1',
      baseRenderer: 'worldReferenceStoneBridgeMedievalArtV2.js',
      coreChecksum: core.checksum,
      ownerPolicy: core.policy,
      topology: { affectedEdges: core.affectedEdges.length, bridgeCount: core.bridges.length, totalArches: core.totalArchCount },
      detail,
      long,
      images,
    };
    fs.writeFileSync(OUT_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[checkCanonicalStoneBridgeVisualEvidenceRun192] PASS: checksum ${core.checksum}; detail warm=${detail.readability.warmStonePixelRatio}, long warm=${long.readability.warmStonePixelRatio}; 2x 1600x900 evidence; V2 renderer unchanged.`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error('[checkCanonicalStoneBridgeVisualEvidenceRun192] FAIL:', error);
  process.exitCode = 1;
});
