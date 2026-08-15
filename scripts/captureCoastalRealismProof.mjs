import fs from 'node:fs';
import { startStaticServer, loadPlaywright } from './devServerHelper.js';

const OUT = 'artifacts/coastal-realism-final-capture';
fs.mkdirSync(OUT, { recursive: true });

const playwright = loadPlaywright();
if (!playwright) throw new Error('Playwright unavailable');
const server = await startStaticServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (error) => errors.push(`page:${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console:${message.text()}`); });

try {
  await page.goto(`${baseUrl}/scripts/fixtures/sw-g07-runtime-visual-harness.html`, { waitUntil: 'load', timeout: 30000 });
  const proof = await page.evaluate(async () => {
    const importMap = document.createElement('script');
    importMap.type = 'importmap';
    importMap.textContent = JSON.stringify({ imports: {
      three: '/src/3d/vendor/three/three.module.js',
      'three/addons/': '/src/3d/vendor/three/addons/',
    } });
    document.head.append(importMap);
    document.body.innerHTML = '<canvas id="capture"></canvas>';
    Object.assign(document.documentElement.style, { margin: '0', width: '100%', height: '100%' });
    Object.assign(document.body.style, { margin: '0', width: '100%', height: '100%', overflow: 'hidden' });
    const canvas = document.getElementById('capture');
    Object.assign(canvas.style, { width: '100vw', height: '100vh', display: 'block' });

    const THREE = await import('/src/3d/vendor/three/three.module.js');
    const { createScene } = await import('/src/3d/sceneManager.js');
    const { WORLD_DEFAULTS, WORLD_SCALE } = await import('/src/3d/config.js');
    const { createHeightSampler } = await import('/src/3d/world/terrain.js');
    const { sampleWorldReferenceCoastalProfile } = await import('/src/3d/world/worldReferenceCoastalRelief.js');
    const { sampleWorldReferenceMountainReliefMeters } = await import('/src/3d/world/worldReferenceMountainRelief.js');

    const state = createScene(canvas);
    state.controls.enabled = false;
    state.scene.fog = null;
    state.sky.visible = true;
    state.stars.visible = false;
    state.renderer.setPixelRatio(1);
    state.renderer.setSize(1536, 1024, false);
    state.chunkManager.loadSquare(0, 0, 12);
    const sampleHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);

    const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS * 0.5;
    const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS * 0.5;
    const candidates = [];
    for (let z = -halfDepth; z <= halfDepth; z += 150) {
      for (let x = -halfWidth; x <= halfWidth; x += 150) {
        const profile = sampleWorldReferenceCoastalProfile(x, z);
        if (!profile.insideReference || profile.dryLandWeight < 0.85) continue;
        if (profile.landDistanceMeters < 300 || profile.landDistanceMeters > 650) continue;
        if (sampleWorldReferenceMountainReliefMeters(x, z) >= 8) continue;
        const height = sampleHeight(x, z);
        if (height < 120) candidates.push({ x, z, height, distance: profile.landDistanceMeters });
      }
    }
    const directions = [[1,0],[-1,0],[0,1],[0,-1],[.707,.707],[.707,-.707],[-.707,.707],[-.707,-.707]];
    let coastView = null;
    for (const candidate of candidates.sort((a,b) => Math.abs(a.distance-450)-Math.abs(b.distance-450))) {
      for (const [dx, dz] of directions) {
        const probe = sampleWorldReferenceCoastalProfile(candidate.x + dx * 800, candidate.z + dz * 800);
        if (probe.insideReference && probe.surface === 'sea' && probe.dryLandWeight < 0.2) {
          coastView = { ...candidate, waterDx: dx, waterDz: dz };
          break;
        }
      }
      if (coastView) break;
    }
    if (!coastView) throw new Error('No coast-facing proof anchor');
    window.__capture = { THREE, state, WORLD_SCALE, sampleHeight, coastView };
    return { terrainMeshCount: state.chunkManager.loaded.size, coastView };
  });

  await page.evaluate(() => {
    const { THREE, state, WORLD_SCALE } = window.__capture;
    const aspect = 1536 / 1024;
    const halfWidth = Math.max(WORLD_SCALE.WORLD_WIDTH_METERS / 2, WORLD_SCALE.WORLD_DEPTH_METERS * aspect / 2) * 1.025;
    const halfHeight = halfWidth / aspect;
    state.water.geometry.computeBoundingBox();
    const extent = state.water.geometry.boundingBox.max.x - state.water.geometry.boundingBox.min.x;
    const coverage = Math.max(halfWidth * 2, halfHeight * 2) * 1.04;
    state.water.scale.set(coverage / extent, 1, coverage / extent);
    state.water.position.set(0, state.water.position.y, 0);
    const depthTexture = new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    depthTexture.needsUpdate = true;
    state.water.material.uniforms.uDepthMap.value = depthTexture;
    state.water.material.uniforms.uDepthFieldExtentMeters.value = 1;
    state.water.material.uniforms.uSwellStrength.value = 0;
    const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 1, 30000);
    camera.up.set(0, 0, -1);
    camera.position.set(0, 13000, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    state.renderer.render(state.scene, camera);
  });
  await page.screenshot({ path: `${OUT}/01-uzak-dik-ustten.png` });

  await page.evaluate(() => {
    const { THREE, state, coastView, sampleHeight } = window.__capture;
    const inlandX = coastView.x - coastView.waterDx * 650;
    const inlandZ = coastView.z - coastView.waterDz * 650;
    const lookY = sampleHeight(inlandX, inlandZ) + 40;
    state.water.scale.set(1, 1, 1);
    const cameraX = coastView.x + coastView.waterDx * 1200;
    const cameraZ = coastView.z + coastView.waterDz * 1200;
    state.water.position.set(cameraX, state.water.position.y, cameraZ);
    const camera = new THREE.PerspectiveCamera(46, 1536 / 1024, 1, 22000);
    camera.position.set(cameraX, Math.max(380, coastView.height + 430), cameraZ);
    camera.lookAt(inlandX, lookY, inlandZ);
    camera.updateProjectionMatrix();
    state.renderer.render(state.scene, camera);
  });
  await page.screenshot({ path: `${OUT}/02-yakin-egik-gercek-gokyuzu.png` });
  fs.writeFileSync(`${OUT}/capture.json`, JSON.stringify({ ...proof, browserErrors: errors }, null, 2));
  if (errors.length) throw new Error(`Browser errors: ${JSON.stringify(errors.slice(0, 10))}`);
  console.log('COASTAL_REALISM_CAPTURE_OK', JSON.stringify(proof));
} finally {
  await page.close();
  await browser.close();
  server.close();
}
