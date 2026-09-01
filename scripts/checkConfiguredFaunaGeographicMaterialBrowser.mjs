#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const proof = await page.evaluate(async () => {
    const { ANIMAL_CONFIG } = await import('/src/3d/gameplay/animalConfig.js');
    const { spawnConfiguredAnimals } = await import('/src/3d/gameplay/animals.js');
    const { AssetLoader } = await import('/src/3d/assetLoader.js');
    const { EventBus } = await import('/src/3d/eventBus.js');
    const { EVENTS, SETTLEMENT_CONFIG, WORLD_DEFAULTS, WORLD_SCALE } = await import('/src/3d/config.js');
    const { KINGDOM_SEATS, computeSettlementFlattenPads, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
    const { createHeightSampler } = await import('/src/3d/world/terrain.js');

    const events = new EventBus();
    const assetErrors = [];
    events.on(EVENTS.ASSET_ERROR, (payload) => assetErrors.push(payload?.url ?? 'unknown'));
    const assetLoader = new AssetLoader({ events });
    const rawHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
    const flattenPads = computeSettlementFlattenPads({
      sampleHeightMeters: rawHeight,
      seaLevelMeters: WORLD_DEFAULTS.WATER_LEVEL_METERS,
      minGroundClearanceMeters: SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS,
      mapBounds: WORLD_SCALE.MAP_BOUNDS,
      metersPerMapUnit: WORLD_SCALE.METERS_PER_MAP_UNIT,
    });
    const gameplayHeight = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED, undefined, flattenPads);
    const seatsById = new Map(KINGDOM_SEATS.map((seat) => {
      const world = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
      return [seat.id, { ...seat, x: world.x, z: world.z }];
    }));
    const wolfSpawn = ANIMAL_CONFIG.SPAWNS.find((spawn) => (spawn.speciesId ?? 'wolf') === 'wolf');
    const config = { ...ANIMAL_CONFIG, SPAWNS: [wolfSpawn] };
    const groundCollider = { getGroundHeight: gameplayHeight };
    const controllers = await spawnConfiguredAnimals({
      assetLoader,
      animalConfig: config,
      seatsById,
      sampleGroundY: gameplayHeight,
      groundCollider,
      playerCollider: { resolveXZ: (x, z) => ({ x, z }) },
    });
    const controller = controllers[0];
    if (!controller) return { assetErrors, missingController: true };

    const root = controller.object3D;
    const textureSizes = [];
    const paletteIds = new Set();
    root.traverse((node) => {
      if (!node?.isMesh) return;
      for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
        if (material?.userData?.paletteId) paletteIds.add(material.userData.paletteId);
        for (const field of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
          const texture = material?.[field];
          if (!texture?.isTexture) continue;
          const image = texture.image ?? texture.source?.data;
          textureSizes.push({ field, width: image?.width ?? null, height: image?.height ?? null });
        }
      }
    });

    const start = performance.now();
    for (let i = 0; i < 120; i += 1) controller.update(1 / 60, { x: root.position.x + 100, z: root.position.z + 100 }, []);
    const elapsedMs = performance.now() - start;
    const result = {
      assetErrors,
      missingController: false,
      placeholder: root.userData?.isPlaceholder === true,
      finiteTransform: [root.position.x, root.position.y, root.position.z].every(Number.isFinite),
      placement: root.userData.faunaWorldPlacement,
      manifest: root.userData.worldPlacementManifest,
      materialReadyForWorld: root.userData.materialReadyForWorld,
      textureSizes,
      paletteIds: [...paletteIds].sort(),
      tickBudget: { ticks: 120, elapsedMs, averageMs: elapsedMs / 120 },
    };
    controller.dispose();
    events.clear();
    return result;
  });

  const faunaConsoleErrors = consoleErrors.filter((message) => message.includes('animals/') || message.includes('gameplay/animals'));
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(faunaConsoleErrors.length, 0, `fauna console errors: ${faunaConsoleErrors.join(' | ')}`);
  assert.deepEqual(proof.assetErrors, [], `real wolf asset failed to load: ${proof.assetErrors.join(', ')}`);
  assert.equal(proof.missingController, false, 'canonical habitat gate rejected the configured wolf');
  assert.equal(proof.placeholder, false, 'real wolf resolved to placeholder');
  assert.equal(proof.finiteTransform, true, 'real wolf transform became non-finite');
  assert.equal(proof.materialReadyForWorld, true, 'real wolf bypassed shared world placement');
  assert.equal(proof.manifest?.validation?.ok, true, `material validation failed: ${JSON.stringify(proof.manifest?.validation)}`);
  assert.ok(proof.placement?.meshCount > 0 && proof.placement?.materialSlotCount > 0, 'real wolf has no material-bearing mesh slots');
  assert.ok(proof.placement?.baseSurface !== 'sea' && proof.placement?.baseSurface !== 'lake', `wolf spawned on ${proof.placement?.baseSurface}`);
  assert.ok(proof.placement?.slopeDegrees <= 38, `wolf slope ${proof.placement?.slopeDegrees}° exceeds habitat policy`);
  assert.ok(['cold-grassland', 'snow', 'mountain', 'rocky-hills', 'soil', 'rock'].includes(proof.placement?.biome), `wolf biome ${proof.placement?.biome} is not habitat-compatible`);
  assert.ok(
    proof.placement?.materialMode === 'preserve-authored' || proof.placement?.generatedMaterialCount > 0,
    'real wolf has neither preserved authored PBR nor generated figure-kit material',
  );
  if (proof.placement?.materialMode === 'preserve-authored') {
    assert.ok(proof.placement.authoredPbrMapSlots.length > 0, 'preserve mode recorded no authored PBR slots');
    assert.ok(proof.textureSizes.length > 0, 'authored PBR textures were not decoded in Chromium');
  } else {
    assert.ok(proof.paletteIds.length > 0, 'generated fallback recorded no animal palette distribution');
  }
  assert.ok(proof.tickBudget.averageMs < 2, `single-wolf AI tick average ${proof.tickBudget.averageMs.toFixed(3)}ms exceeds 2ms proof budget`);

  console.log('CONFIGURED_FAUNA_GEOGRAPHIC_MATERIAL_BROWSER_PASS', JSON.stringify({
    placement: proof.placement,
    textureSizes: proof.textureSizes,
    paletteIds: proof.paletteIds,
    tickBudget: proof.tickBudget,
  }));
} finally {
  await browser.close();
}