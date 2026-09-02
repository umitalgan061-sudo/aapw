#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import serverHelper from './devServerHelper.js';

const { startStaticServer, loadPlaywright } = serverHelper;
const playwright = loadPlaywright();
if (!playwright?.chromium) {
  console.error('[checkCastleAuthoredMaterialVisualQa] Playwright unavailable.');
  process.exit(2);
}

const OUT = 'artifacts/castle-authored-material-visual-qa';
const VIEWPORT = Object.freeze({ width: 1200, height: 760 });
await mkdir(OUT, { recursive: true });
const server = await startStaticServer();
const browser = await playwright.chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const browserErrors = [];
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });

try {
  await page.goto(`${server.baseUrl}/castle-authored-material-visual-qa.html`, { waitUntil: 'networkidle', timeout: 30000 });
  const result = await page.evaluate(async ({ viewport }) => {
    const THREE = await import('three');
    const { AssetLoader } = await import('./src/3d/assetLoader.js');
    const { spawnRealCastleModels } = await import('./src/3d/world/settlements.js');

    const loader = new AssetLoader();
    const group = await spawnRealCastleModels({
      assetLoader: loader,
      seats: [{ id: 'twin', name: 'Twin Lannister', x: 0, z: 0, groundY: 0 }],
      seed: 1337,
    });
    const pivot = group.getObjectByName('castle-twin');
    if (!pivot) throw new Error('twin gatehouse was not placed');
    const treatment = pivot.userData.castleMaterialTreatment;
    if (!treatment?.authoredMapsPreserved || treatment.authoredMaterialSlots < 1) {
      throw new Error(`authored PBR material was not preserved: ${JSON.stringify(treatment)}`);
    }

    const materialReport = [];
    pivot.traverse((node) => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materialReport.push({
          mesh: node.name,
          material: material?.name ?? '',
          source: material?.userData?.castleMaterialSource ?? null,
          authoredMapsPreserved: material?.userData?.authoredMapsPreserved === true,
          map: Boolean(material?.map?.isTexture),
          normalMap: Boolean(material?.normalMap?.isTexture),
          roughnessMap: Boolean(material?.roughnessMap?.isTexture),
          metalnessMap: Boolean(material?.metalnessMap?.isTexture),
          roughness: material?.roughness ?? null,
          metalness: material?.metalness ?? null,
        });
      }
    });
    if (!materialReport.some((entry) => entry.source === 'authored-pbr')) {
      throw new Error(`no rendered mesh retained authored-pbr material: ${JSON.stringify(materialReport)}`);
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xb9c4ca);
    scene.add(new THREE.HemisphereLight(0xeaf2f5, 0x4d4a43, 1.7));
    const sun = new THREE.DirectionalLight(0xffedcf, 3.0);
    sun.position.set(38, 62, 34);
    sun.castShadow = true;
    scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0x756f62, roughness: 0.96, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.add(pivot);

    pivot.position.set(0, 0, 0);
    pivot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(pivot);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(viewport.width, viewport.height, false);
    renderer.shadowMap.enabled = true;
    if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (THREE.ACESFilmicToneMapping !== undefined) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    document.getElementById('qa-root').appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(38, viewport.width / viewport.height, 0.1, 500);
    const reach = Math.max(size.x, size.z, 20);
    camera.position.set(reach * 1.15, Math.max(12, size.y * 0.55), reach * 1.2);
    camera.lookAt(center.x, Math.max(3, size.y * 0.36), center.z);
    renderer.render(scene, camera);

    return {
      treatment,
      materialReport,
      bounds: { size: size.toArray(), center: center.toArray() },
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
    };
  }, { viewport: VIEWPORT });

  await page.screenshot({ path: `${OUT}/twin-gatehouse-authored-pbr.png`, fullPage: false });
  assert.equal(browserErrors.length, 0, `browser errors: ${browserErrors.join(' | ')}`);
  assert(result.treatment.authoredMaterialSlots > 0, 'Twin gatehouse must retain authored material slots');
  assert(result.materialReport.some((entry) => entry.source === 'authored-pbr'), 'rendered Twin mesh must use authored PBR');
  await writeFile(`${OUT}/report.json`, `${JSON.stringify({ ...result, browserErrors }, null, 2)}\n`);
  console.log('[checkCastleAuthoredMaterialVisualQa] PASS', JSON.stringify({
    treatment: result.treatment,
    authoredMaterials: result.materialReport.filter((entry) => entry.source === 'authored-pbr').length,
    triangles: result.triangles,
  }));
} finally {
  await browser.close();
  await server.close();
}
