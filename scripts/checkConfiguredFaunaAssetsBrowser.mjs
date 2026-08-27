#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const proof = await page.evaluate(async () => {
    const { ANIMAL_CONFIG } = await import('/src/3d/gameplay/animalConfig.js');
    const { AssetLoader } = await import('/src/3d/assetLoader.js');
    const { EventBus } = await import('/src/3d/eventBus.js');
    const { EVENTS } = await import('/src/3d/config.js');

    const events = new EventBus();
    const assetErrors = [];
    events.on(EVENTS.ASSET_ERROR, (payload) => assetErrors.push({
      url: payload?.url ?? null,
      type: payload?.type ?? null,
    }));
    const assetLoader = new AssetLoader({ events });
    const speciesReports = [];

    for (const [speciesId, species] of Object.entries(ANIMAL_CONFIG.SPECIES)) {
      const model = await assetLoader.loadModel(species.modelUrl, { fallbackColor: 0x5a5148, fallbackSize: 1.2 });
      const animationNames = (model.animations ?? []).map((clip) => clip.name);
      const configuredClips = Object.entries(species.clips ?? {})
        .filter(([, clipName]) => Boolean(clipName))
        .map(([role, clipName]) => ({ role, clipName, present: animationNames.includes(clipName) }));

      let meshCount = 0;
      let skinnedMeshCount = 0;
      let materialSlotCount = 0;
      let meshMissingMaterialCount = 0;
      const materialNames = new Set();
      model.traverse((node) => {
        if (!node.isMesh) return;
        meshCount += 1;
        if (node.isSkinnedMesh) skinnedMeshCount += 1;
        const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
        const validMaterials = materials.filter(Boolean);
        if (validMaterials.length === 0) meshMissingMaterialCount += 1;
        materialSlotCount += validMaterials.length;
        for (const material of validMaterials) materialNames.add(material?.name || material?.type || 'unnamed');
      });

      speciesReports.push({
        speciesId,
        modelUrl: species.modelUrl,
        placeholder: model.userData?.isPlaceholder === true,
        meshCount,
        skinnedMeshCount,
        materialSlotCount,
        meshMissingMaterialCount,
        materialNames: [...materialNames].sort(),
        animationCount: animationNames.length,
        configuredClips,
      });
      AssetLoader.disposeObject3D(model);
    }

    events.clear();
    return { assetErrors, speciesReports };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(proof.assetErrors.length, 0, `configured fauna asset errors: ${JSON.stringify(proof.assetErrors)}`);
  assert.ok(proof.speciesReports.length >= 10, `expected the shipped multi-species fauna roster, got ${proof.speciesReports.length}`);

  for (const report of proof.speciesReports) {
    assert.match(report.modelUrl, /^assets\/models\/animals\/.+\.glb$/i, `${report.speciesId}: model must be a shipped animal GLB`);
    assert.equal(report.placeholder, false, `${report.speciesId}: real asset load fell back to placeholder`);
    assert.ok(report.meshCount > 0, `${report.speciesId}: loaded asset has no mesh`);
    assert.equal(report.meshMissingMaterialCount, 0, `${report.speciesId}: ${report.meshMissingMaterialCount} mesh(es) have no material assignment`);
    assert.ok(report.materialSlotCount > 0, `${report.speciesId}: loaded asset has no material slots`);
    assert.ok(report.animationCount > 0, `${report.speciesId}: configured fauna asset has no animation clips`);
    for (const clip of report.configuredClips) {
      assert.equal(clip.present, true, `${report.speciesId}: configured ${clip.role} clip "${clip.clipName}" is absent from the real GLB`);
    }
  }

  console.log('CONFIGURED_FAUNA_ASSETS_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
