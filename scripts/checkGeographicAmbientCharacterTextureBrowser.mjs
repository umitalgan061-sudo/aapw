#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'geographic-ambient-character-texture');
const SOURCES = Object.freeze([
  Object.freeze({ id: 'peasant-girl', url: 'assets/models/characters/peasant_girl.fbx' }),
  Object.freeze({ id: 'paladin-j-nordstrom', url: 'assets/models/characters/paladin_j_nordstrom.fbx' }),
  Object.freeze({ id: 'erika-archer', url: 'assets/models/characters/erika_archer.fbx' }),
]);
const fail = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright bulunamadı.');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('response', (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });

  try {
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const result = await page.evaluate(async (sources) => {
      const THREE = await import('three');
      const { FBXLoader } = await import('/src/3d/vendor/three/addons/loaders/FBXLoader.js');
      const { AssetLoader } = await import('/src/3d/assetLoader.js');
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setSize(960, 640, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x111820);
      const camera = new THREE.PerspectiveCamera(55, 960 / 640, 0.1, 2000);
      camera.position.set(4, 2.5, 7);
      camera.lookAt(0, 1.2, 0);
      scene.add(new THREE.HemisphereLight(0xddeeff, 0x223322, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 2.0);
      key.position.set(5, 8, 4);
      scene.add(key);
      const grid = new THREE.GridHelper(12, 12, 0x334455, 0x223344);
      scene.add(grid);
      const loader = new FBXLoader();
      const records = [];

      for (const source of sources) {
        const model = await new Promise((resolve, reject) => loader.load(`/${source.url}`, resolve, undefined, reject));
        AssetLoader.correctMixamoFbxScale(model);
        model.position.set((records.length - 1) * 3.0, 0, 0);
        model.scale.multiplyScalar(0.72);
        scene.add(model);
        const names = [];
        const surfaces = [];
        const textureSizes = [];
        model.traverse((node) => {
          if (!node.isMesh) return;
          names.push(node.name || '(unnamed-mesh)');
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          for (const material of materials) {
            if (!material) continue;
            const maps = [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap].filter(Boolean);
            surfaces.push({ name: material.name || '(unnamed-material)', mapCount: maps.length });
            for (const texture of maps) {
              const width = Number(texture?.image?.width);
              const height = Number(texture?.image?.height);
              if (width > 0 && height > 0) textureSizes.push({ width, height });
            }
          }
        });
        records.push({
          id: source.id,
          source: source.url,
          meshCount: names.length,
          materialSurfaceCount: surfaces.length,
          namedParts: names,
          materialSurfaces: surfaces,
          textureSizes,
          hasAuthoredTexture: textureSizes.length > 0,
        });
      }

      const expectedSemanticTokens = ['skin', 'hair', 'eye', 'cloth', 'coat', 'boot', 'gear'];
      const namedPartCoverage = records.map((record) => ({
        id: record.id,
        matchedTokens: expectedSemanticTokens.filter((token) => record.namedParts.some((name) => name.toLowerCase().includes(token))),
      }));
      renderer.render(scene, camera);
      return { records, namedPartCoverage };
    }, SOURCES);

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'geographic-ambient-texture-proof.json'), `${JSON.stringify(result, null, 2)}\n`);
    await page.screenshot({ path: path.join(OUT, 'geographic-ambient-texture-proof.png'), fullPage: false });
    fail(result.records.every((record) => record.meshCount > 0), 'one or more human assets exposed no renderable mesh');
    fail(result.records.every((record) => record.materialSurfaceCount > 0), 'one or more human assets exposed no material surface');
    fail(result.records.every((record) => record.hasAuthoredTexture), 'one or more human assets has no authored texture map in browser proof');
    fail(httpErrors.length === 0, `HTTP errors: ${httpErrors.join(' | ')}`);
    fail(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    fail(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    console.log(`[checkGeographicAmbientCharacterTextureBrowser] PASS: ${JSON.stringify(result)}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkGeographicAmbientCharacterTextureBrowser] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
