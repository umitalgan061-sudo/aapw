#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, loadPlaywright } = require('./devServerHelper.js');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'artifacts', 'run216-game-night-readability');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error('[checkGameNightReadabilityVisual] SKIP: Playwright is not available.');
    process.exit(2);
  }

  const server = await startStaticServer();
  const { port } = server.address();
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error));

  try {
    await page.goto(`http://127.0.0.1:${port}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createDayNightLighting, updateDayNightLighting, disposeDayNightLighting } = await import('/src/3d/lighting.js');

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x07101c);
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(4.5, 3.2, 6.5);
      camera.lookAt(0, 0.7, 0);

      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(256, 256, false);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const groundGeometry = new THREE.PlaneGeometry(12, 12);
      const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x465346, roughness: 0.95 });
      const ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);

      const towerGeometry = new THREE.BoxGeometry(1.6, 2.8, 1.6);
      const towerMaterial = new THREE.MeshStandardMaterial({ color: 0x81786c, roughness: 0.82 });
      const tower = new THREE.Mesh(towerGeometry, towerMaterial);
      tower.position.set(-0.8, 1.4, 0);
      scene.add(tower);

      const subjectGeometry = new THREE.SphereGeometry(0.8, 32, 16);
      const subjectMaterial = new THREE.MeshStandardMaterial({ color: 0x75869a, roughness: 0.7 });
      const subject = new THREE.Mesh(subjectGeometry, subjectMaterial);
      subject.position.set(1.1, 0.8, 0.35);
      scene.add(subject);

      const lights = createDayNightLighting(scene);
      const readability = lights.hemisphere.children.find((child) => child.userData?.gameNightReadability === true);
      if (!readability?.isHemisphereLight) throw new Error('Gameplay night readability fill light was not created.');

      const measure = () => {
        renderer.render(scene, camera);
        const pixels = new Uint8Array(256 * 256 * 4);
        const gl = renderer.getContext();
        gl.readPixels(0, 0, 256, 256, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let sum = 0;
        let count = 0;
        for (let y = 56; y < 200; y += 2) {
          for (let x = 56; x < 200; x += 2) {
            const index = (y * 256 + x) * 4;
            const r = pixels[index];
            const g = pixels[index + 1];
            const b = pixels[index + 2];
            sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
            count += 1;
          }
        }
        return sum / Math.max(1, count);
      };

      const midnight = updateDayNightLighting(lights, 0, 100, 0);
      const midnightFillIntensity = readability.intensity;
      const readableLuma = measure();
      const readablePng = canvas.toDataURL('image/png');

      readability.intensity = 0;
      const legacyDarkLuma = measure();

      const noon = updateDayNightLighting(lights, 50, 100, 0);
      const noonFillIntensity = readability.intensity;

      const snapshot = {
        midnightNightFactor: midnight.nightFactor,
        midnightSunIntensity: lights.sun.intensity,
        canonicalMidnightHemisphereIntensity: 0.25,
        midnightFillIntensity,
        noonNightFactor: noon.nightFactor,
        noonFillIntensity,
        readableLuma,
        legacyDarkLuma,
        readabilityGain: readableLuma / Math.max(0.001, legacyDarkLuma),
        sceneTopLevelLights: scene.children.filter((child) => child.isLight).length,
        readabilityParentIsCanonicalHemisphere: readability.parent === lights.hemisphere,
        readablePng
      };

      disposeDayNightLighting(scene, lights);
      scene.remove(ground, tower, subject);
      groundGeometry.dispose();
      groundMaterial.dispose();
      towerGeometry.dispose();
      towerMaterial.dispose();
      subjectGeometry.dispose();
      subjectMaterial.dispose();
      renderer.dispose();
      return snapshot;
    });

    assert(result.midnightNightFactor === 1, `Midnight nightFactor drifted: ${result.midnightNightFactor}`);
    assert(Math.abs(result.midnightFillIntensity - 1.05) < 1e-9, `Midnight readability intensity drifted: ${result.midnightFillIntensity}`);
    assert(result.noonNightFactor === 0, `Noon nightFactor drifted: ${result.noonNightFactor}`);
    assert(Math.abs(result.noonFillIntensity - 0.08) < 1e-9, `Noon readability floor drifted: ${result.noonFillIntensity}`);
    assert(result.midnightFillIntensity > result.noonFillIntensity * 10, 'Readability fill is not strongly night-weighted.');
    assert(result.readabilityParentIsCanonicalHemisphere, 'Readability fill escaped the canonical lighting dispose tree.');
    assert(result.sceneTopLevelLights === 2, `Public top-level light shape drifted: ${result.sceneTopLevelLights}`);
    assert(result.readableLuma > result.legacyDarkLuma + 8, `Midnight scene did not gain enough visible luminance: ${result.legacyDarkLuma.toFixed(2)} -> ${result.readableLuma.toFixed(2)}`);
    assert(result.readabilityGain > 1.25, `Midnight readability gain too small: ${result.readabilityGain.toFixed(2)}x`);
    assert(errors.length === 0, `Console/page errors: ${errors.join(' | ')}`);

    fs.mkdirSync(OUT, { recursive: true });
    const png = result.readablePng.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(OUT, 'gameplay-midnight-readability.png'), Buffer.from(png, 'base64'));
    console.log(`[checkGameNightReadabilityVisual] PASS: midnight fill ${result.midnightFillIntensity.toFixed(2)}, noon fill ${result.noonFillIntensity.toFixed(2)}, synthetic gameplay luminance ${result.legacyDarkLuma.toFixed(2)} -> ${result.readableLuma.toFixed(2)} (${result.readabilityGain.toFixed(2)}x), canonical day/night factors unchanged.`);
  } finally {
    await page.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(`[checkGameNightReadabilityVisual] FAIL: ${error?.stack || error}`);
  process.exit(1);
});
