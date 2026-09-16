#!/usr/bin/env node
/** Exact-head Chromium/WebGL proof for natural-geology surface materials. */
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error('[checkNaturalGeologySurfacePbr] SKIP: Playwright is unavailable');
    process.exit(2);
  }
  const outputDir = resolve(process.cwd(), 'artifacts/natural-geology-surface-pbr');
  mkdirSync(outputDir, { recursive: true });
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 620 } });
    const browserErrors = [];
    page.on('pageerror', (error) => browserErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}/scripts/geographicRiverHarness.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createNaturalRockPrototypeGeometry } = await import('/src/3d/world/naturalGeology.js');
      const {
        NATURAL_GEOLOGY_SURFACE_POLICY,
        applyNaturalGeologySurfaceMaterial,
      } = await import('/src/3d/world/naturalGeologySurfaceMaterial.js');
      const fail = (condition, message) => { if (!condition) throw new Error(message); };

      fail(NATURAL_GEOLOGY_SURFACE_POLICY.renderOnly === true, 'surface policy stopped being render-only');
      fail(NATURAL_GEOLOGY_SURFACE_POLICY.canonicalTerrainUnchanged === true, 'terrain authority changed');
      fail(NATURAL_GEOLOGY_SURFACE_POLICY.canonicalHydrologyUnchanged === true, 'hydrology authority changed');
      fail(NATURAL_GEOLOGY_SURFACE_POLICY.canonicalColliderUnchanged === true, 'collider authority changed');

      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1040, 580, false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.width = '1040px';
      renderer.domElement.style.height = '580px';
      document.body.style.margin = '0';
      document.body.style.background = '#0c1116';
      document.body.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x10171d);
      const camera = new THREE.PerspectiveCamera(42, 1040 / 580, 0.1, 80);
      camera.position.set(0, 5.5, 13.5);
      camera.lookAt(0, 1.0, 0);
      scene.add(new THREE.HemisphereLight(0xbfd5e8, 0x283028, 1.7));
      const sun = new THREE.DirectionalLight(0xffe6bf, 3.4);
      sun.position.set(-5, 9, 7);
      scene.add(sun);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(18, 10),
        new THREE.MeshStandardMaterial({ color: 0x283027, roughness: 0.94, metalness: 0 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.15;
      scene.add(floor);

      const samples = [
        { mode: 'rock', kind: 'bedrock', color: 0x67635a, x: -3.5 },
        { mode: 'arid', kind: 'low-outcrop', color: 0x826c4d, x: 0 },
        { mode: 'volcanic', kind: 'fractured-scarp', color: 0x2c2624, x: 3.5 },
      ];
      const cacheKeys = [];
      for (const sample of samples) {
        const material = applyNaturalGeologySurfaceMaterial(
          new THREE.MeshStandardMaterial({ color: sample.color, roughness: 0.92, metalness: 0, flatShading: true }),
          { mode: sample.mode },
        );
        fail(material.userData.naturalGeologySurface?.mode === sample.mode, `${sample.mode} metadata lost`);
        const geometry = createNaturalRockPrototypeGeometry(sample.kind);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(sample.x, sample.mode === 'volcanic' ? 0.85 : 0.55, 0);
        mesh.scale.setScalar(sample.mode === 'volcanic' ? 3.0 : 2.7);
        mesh.rotation.y = sample.x * 0.11 + 0.38;
        scene.add(mesh);
        cacheKeys.push(material.customProgramCacheKey());
      }
      fail(new Set(cacheKeys).size === 3, `surface modes share shader cache keys: ${cacheKeys.join(', ')}`);

      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      const programCount = renderer.info.programs?.length ?? 0;
      fail(programCount >= 4, `expected compiled geology/floor programs, got ${programCount}`);
      const gl = renderer.getContext();
      fail(gl.getError() === gl.NO_ERROR, `WebGL error after geology render: ${gl.getError()}`);

      return {
        renderer: renderer.capabilities.isWebGL2 ? 'webgl2' : 'webgl1',
        programCount,
        policyId: NATURAL_GEOLOGY_SURFACE_POLICY.id,
        modes: samples.map((sample) => sample.mode),
        cacheKeys,
      };
    });

    assert(browserErrors.length === 0, `browser errors: ${browserErrors.join(' | ')}`);
    await page.locator('canvas').screenshot({ path: resolve(outputDir, 'natural-geology-surface-pbr.png') });
    console.log('[checkNaturalGeologySurfacePbr] PASS');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

main().catch((error) => {
  console.error(`[checkNaturalGeologySurfacePbr] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
