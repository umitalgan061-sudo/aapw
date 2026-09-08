#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'geographic-fauna-texture');
const SOURCES = Object.freeze([
  Object.freeze({ id: 'white-horse', url: 'assets/models/animals/white_horse_bEdE4rmZy9.glb', loader: 'gltf' }),
  Object.freeze({ id: 'wolf', url: 'assets/models/animals/wolf/Wolf-Blender-2.82a.glb', loader: 'gltf' }),
  Object.freeze({ id: 'dragon', url: 'assets/models/creatures/dragon/Dragon_Baked_Actions_fbx_7.4_binary.fbx', loader: 'fbx' }),
]);
const fail = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) throw new Error('Playwright bulunamadı.');
  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
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
      const { GLTFLoader } = await import('/src/3d/vendor/three/addons/loaders/GLTFLoader.js');
      const { FBXLoader } = await import('/src/3d/vendor/three/addons/loaders/FBXLoader.js');
      const records = [];
      const load = (loader, url) => new Promise((resolve, reject) => loader.load(`/${url}`, resolve, undefined, reject));

      for (const source of sources) {
        const object = source.loader === 'gltf'
          ? (await load(new GLTFLoader(), source.url)).scene
          : await load(new FBXLoader(), source.url);
        object.position.set((records.length - 1) * 3, 0, 0);
        const names = [];
        const materials = [];
        const textureSizes = [];
        object.traverse((node) => {
          if (!node.isMesh) return;
          names.push(node.name || '(unnamed)');
          for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
            if (!material) continue;
            const maps = [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap].filter(Boolean);
            materials.push({ name: material.name || '(unnamed-material)', mapCount: maps.length });
            for (const texture of maps) {
              const width = Number(texture?.image?.width);
              const height = Number(texture?.image?.height);
              if (width > 0 && height > 0) textureSizes.push({ width, height });
            }
          }
        });
        records.push({ id: source.id, source: source.url, meshCount: names.length, materialCount: materials.length, namedParts: names, materials, textureSizes, hasTexture: textureSizes.length > 0 });
      }

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0f151a);
      records.forEach((record) => { void record; });
      return records;
    }, SOURCES);

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'geographic-fauna-texture-proof.json'), `${JSON.stringify(result, null, 2)}\n`);
    fail(result.every((record) => record.meshCount > 0), 'fauna/creature/dragon asset exposed no renderable mesh');
    fail(result.every((record) => record.materialCount > 0), 'fauna/creature/dragon asset exposed no material surface');
    fail(result.every((record) => record.hasTexture), 'fauna/creature/dragon asset exposed no authored texture maps');
    fail(httpErrors.length === 0, `HTTP errors: ${httpErrors.join(' | ')}`);
    fail(consoleErrors.length === 0, `Console errors: ${consoleErrors.join(' | ')}`);
    fail(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`);
    console.log(`[checkGeographicFaunaTextureBrowser] PASS: ${JSON.stringify(result)}`);
  } finally {
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkGeographicFaunaTextureBrowser] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
