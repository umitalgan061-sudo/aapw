#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error('[checkNaturalGeologySurfaceVisualQa] SKIP: Playwright unavailable.');
    process.exit(2);
  }
  const outputDir = path.resolve('artifacts/geographic-asset-material-exact-head');
  fs.mkdirSync(outputDir, { recursive: true });
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 760 }, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/scripts/naturalGeologySurfaceHarness.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const metrics = await page.evaluate(async () => {
      const THREE = await import('three');
      const geology = await import('/src/3d/world/naturalGeology.js');
      const fail = (condition, message) => { if (!condition) throw new Error(message); };
      const WIDTH = 13296.078906418774, DEPTH = 10341.394704992379, SEA = 6;
      const terrain = (x, z) => {
        const nx = x / WIDTH, nz = z / DEPTH;
        return Math.max(SEA + 3, 82 + Math.sin(nx * Math.PI * 3.2) * 41 + Math.sin(nz * Math.PI * 4.4) * 28
          + Math.pow(Math.abs(Math.sin((nx * 0.81 + nz * 0.29) * Math.PI * 16)), 1.55) * 88);
      };
      const source = geology.createNaturalGeology({
        sampleHeightMeters: terrain, seaLevelMeters: SEA, seed: 1337, seats: [], roadEdges: [],
        worldWidthMeters: WIDTH, worldDepthMeters: DEPTH,
      });
      const sourceMesh = source.group.children.find((child) => child?.isInstancedMesh);
      fail(sourceMesh?.material?.isMeshStandardMaterial, 'production geology material unavailable');
      fail(sourceMesh.material.vertexColors === true, 'production geology material lost vertex colors');
      fail(sourceMesh.material.color.equals(new THREE.Color(0xffffff)), 'production geology material base is not neutral white');

      const samples = [
        { id: 'north', kind: 'fractured-scarp', x: -1300, z: -3100, northness: 0.94, southernDryness: 0.01, heightAboveSeaMeters: 440, localReliefMeters: 150, volcanic: false, valyriaInfluence: 0, curvatureMeters: 0.2 },
        { id: 'temperate', kind: 'bedrock', x: -250, z: -200, northness: 0.46, southernDryness: 0.22, heightAboveSeaMeters: 130, localReliefMeters: 65, volcanic: false, valyriaInfluence: 0, curvatureMeters: 0.25 },
        { id: 'south', kind: 'low-outcrop', x: 950, z: 3300, northness: 0.04, southernDryness: 0.97, heightAboveSeaMeters: 190, localReliefMeters: 82, volcanic: false, valyriaInfluence: 0, curvatureMeters: 0.35 },
        { id: 'volcanic', kind: 'fractured-scarp', x: 3600, z: 2500, northness: 0.08, southernDryness: 0.88, heightAboveSeaMeters: 260, localReliefMeters: 160, volcanic: true, valyriaInfluence: 0.94, curvatureMeters: 1.35 },
      ];
      for (const sample of samples) Object.assign(sample, { y: 0, yawRadians: 0, tiltRadians: 0, tiltAxisRadians: 0, scale: { x: 1, y: 1, z: 1 } });

      const canvas = document.getElementById('view');
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(1440, 760, false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x8fa0a9);
      scene.fog = new THREE.Fog(0x8fa0a9, 22, 37);
      const camera = new THREE.PerspectiveCamera(34, 1440 / 760, 0.1, 100);
      camera.position.set(0, 7.5, 25.5);
      camera.lookAt(0, 2.15, 0);
      scene.add(new THREE.HemisphereLight(0xdde8ed, 0x555044, 1.5));
      const sun = new THREE.DirectionalLight(0xffebce, 2.8);
      sun.position.set(-8, 15, 9); sun.castShadow = true; scene.add(sun);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(34, 13), new THREE.MeshStandardMaterial({ color: 0x5c604f, roughness: 0.97, metalness: 0 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

      const staged = [];
      const xs = [-9, -3, 3, 9];
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        const geometry = geology.createNaturalRockPrototypeGeometry(sample.kind);
        const material = sourceMesh.material.clone();
        const mesh = new THREE.InstancedMesh(geometry, material, 1);
        const scaleY = sample.kind === 'fractured-scarp' ? 5.2 : sample.kind === 'low-outcrop' ? 3.7 : 4.5;
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(xs[index], 0.02, 0),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, index * 0.71 - 0.6, 0)),
          new THREE.Vector3(5.0, scaleY, 4.6),
        );
        mesh.setMatrixAt(0, matrix);
        const climateColor = geology.naturalGeologyColorForPlacement(sample);
        mesh.setColorAt(0, climateColor);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh); staged.push({ mesh, sample, climateColor });
      }

      renderer.render(scene, camera);
      const gl = renderer.getContext();
      fail(gl.getError() === gl.NO_ERROR, 'WebGL error after geology render');
      fail(renderer.info.render.calls >= 5 && renderer.info.render.calls <= 7, `unexpected draw calls ${renderer.info.render.calls}`);
      fail(renderer.info.render.triangles > 200, `geology render triangle count too low: ${renderer.info.render.triangles}`);
      const report = staged.map(({ mesh, sample, climateColor }) => {
        const attr = mesh.geometry.getAttribute('color');
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < attr.count; i += 1) {
          min = Math.min(min, attr.getX(i), attr.getY(i), attr.getZ(i));
          max = Math.max(max, attr.getX(i), attr.getY(i), attr.getZ(i));
        }
        return {
          id: sample.id, kind: sample.kind, color: climateColor.toArray(),
          hydratedMultiplier: geology.naturalGeologyHydratedWeatheringMultiplier(sample).toArray(),
          vertexWeatheringRange: [min, max], vertices: mesh.geometry.getAttribute('position').count,
        };
      });
      fail(report[0].color[2] > report[0].color[0], 'north/high sample lost cool exposed geology color');
      fail(report[2].color[0] > report[2].color[2] * 1.45, 'south sample lost ferric geology color');
      fail(report.every((entry) => entry.vertexWeatheringRange[1] - entry.vertexWeatheringRange[0] >= 0.035), 'a rendered geology prototype is visually uniform');
      window.__geologyQa = { renderer, source, geology, ground, staged };
      return { policyId: geology.NATURAL_GEOLOGY_RENDER_POLICY.id, render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }, report };
    });

    assert(pageErrors.length === 0, `page errors: ${JSON.stringify(pageErrors)}`);
    const screenshotPath = path.join(outputDir, 'natural-geology-surface-weathering.png');
    await page.screenshot({ path: screenshotPath });
    fs.writeFileSync(path.join(outputDir, 'natural-geology-surface-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
    await page.evaluate(() => {
      const qa = window.__geologyQa;
      if (!qa) return;
      for (const entry of qa.staged) { entry.mesh.geometry.dispose(); entry.mesh.material.dispose(); }
      qa.ground.geometry.dispose(); qa.ground.material.dispose();
      qa.geology.disposeNaturalGeology(qa.source.group);
      qa.renderer.dispose(); delete window.__geologyQa;
    });
    console.log('[checkNaturalGeologySurfaceVisualQa] PASS', JSON.stringify(metrics));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkNaturalGeologySurfaceVisualQa] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
