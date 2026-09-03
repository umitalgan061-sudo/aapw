#!/usr/bin/env node
/**
 * Browser/WebGL regression for the Valyria fortress weathering shader.
 *
 * This intentionally compiles the real MeshStandardMaterial mutation in Chromium rather than
 * treating source inspection as proof. Both an ordinary Mesh and an InstancedMesh are rendered so
 * the two vertex paths touched by the weathering world-space varying are exercised.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
void ROOT;

const playwright = loadPlaywright();
if (!playwright) {
  console.error('[checkValyriaCastleWeatheringBrowser] FAIL: Playwright is unavailable.');
  process.exit(2);
}

const server = await startStaticServer();
const { port } = server.address();
const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  screen: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Westeros-ValyriaShader-MobileCompile/1.0',
});
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(String(error)));

try {
  // Use the repository's intentionally empty same-origin FBX directory index instead of `/`.
  // Loading `/` boots the complete application and can fail this focused shader compile proof on
  // unrelated scene/LFS/runtime errors before the Valyria material is even exercised. The blank
  // same-origin document still gives ESM imports access to the shipped repository paths below.
  await page.goto(`http://127.0.0.1:${port}/assets/models/fbx/index.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { applyValyriaCastleWeathering, VALYRIA_CASTLE_WEATHERING_POLICY } = await import('/src/3d/world/valyriaCastleWeathering.js');

    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    renderer.setPixelRatio(1);
    renderer.setSize(256, 256, false);
    document.body.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x596979);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 3.2, 8);
    camera.lookAt(0, 1, 0);
    scene.add(new THREE.HemisphereLight(0xc8d5df, 0x302a27, 2.0));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(4, 8, 5);
    scene.add(sun);

    const geometry = new THREE.BoxGeometry(1.8, 3.0, 1.8, 2, 3, 2);
    const makeMaterial = (seed) => {
      const material = new THREE.MeshStandardMaterial({
        color: 0x706762,
        roughness: 0.78,
        metalness: 0.02,
      });
      applyValyriaCastleWeathering(material, {
        seatId: VALYRIA_CASTLE_WEATHERING_POLICY.targetSeatId,
        groundY: -1.5,
        footprintMeters: 46,
        seed,
      });
      return material;
    };

    const material = makeMaterial(0x56414c59);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = -1.6;
    scene.add(mesh);

    const instancedMaterial = makeMaterial(0x56414c5a);
    const instanced = new THREE.InstancedMesh(geometry, instancedMaterial, 2);
    const matrix = new THREE.Matrix4();
    matrix.makeTranslation(1.2, 0, 0);
    instanced.setMatrixAt(0, matrix);
    matrix.makeTranslation(3.2, 0.2, -0.3);
    matrix.multiply(new THREE.Matrix4().makeScale(0.8, 1.1, 0.8));
    instanced.setMatrixAt(1, matrix);
    instanced.instanceMatrix.needsUpdate = true;
    scene.add(instanced);

    renderer.compile(scene, camera);
    renderer.render(scene, camera);

    const gl = renderer.getContext();
    const glError = gl.getError();
    const programs = (renderer.info.programs ?? []).map((program) => ({
      runnable: program.diagnostics?.runnable ?? null,
      programLog: program.diagnostics?.programLog ?? '',
      vertexLog: program.diagnostics?.vertexShader?.log ?? '',
      fragmentLog: program.diagnostics?.fragmentShader?.log ?? '',
    }));
    const brokenPrograms = programs.filter((program) =>
      program.runnable === false || program.programLog || program.vertexLog || program.fragmentLog
    );

    const metadata = [material, instancedMaterial].map((entry) => entry.userData?.valyriaCastleWeathering ?? null);
    const pixel = new Uint8Array(4);
    gl.readPixels(128, 128, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    renderer.dispose();
    geometry.dispose();
    material.dispose();
    instancedMaterial.dispose();
    renderer.domElement.remove();

    return {
      glError,
      noErrorConstant: gl.NO_ERROR,
      programCount: programs.length,
      brokenPrograms,
      metadata,
      centerPixel: Array.from(pixel),
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      touchPoints: navigator.maxTouchPoints,
    };
  });

  if (!result.coarsePointer || result.touchPoints < 1) {
    throw new Error(`mobile profile inactive: ${JSON.stringify(result)}`);
  }
  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`browser errors: ${JSON.stringify({ consoleErrors, pageErrors })}`);
  }
  if (result.glError !== result.noErrorConstant) {
    throw new Error(`WebGL error after compile/render: ${result.glError}`);
  }
  if (result.programCount < 2) {
    throw new Error(`expected mesh + instanced shader programs, got ${result.programCount}`);
  }
  if (result.brokenPrograms.length) {
    throw new Error(`shader diagnostics reported failure: ${JSON.stringify(result.brokenPrograms)}`);
  }
  if (result.metadata.some((entry) => !entry?.active || !entry?.worldSpace || !entry?.multiScale)) {
    throw new Error(`weathering metadata missing: ${JSON.stringify(result.metadata)}`);
  }
  if (result.centerPixel[3] !== 255) {
    throw new Error(`render target did not produce an opaque frame: ${JSON.stringify(result.centerPixel)}`);
  }

  console.log(`[checkValyriaCastleWeatheringBrowser] sample ${JSON.stringify(result)}`);
  console.log('[checkValyriaCastleWeatheringBrowser] PASS: real mobile Chromium compiled and rendered Mesh + InstancedMesh weathering shaders.');
} finally {
  await context.close();
  await browser.close();
  server.close();
}
