#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Run167 owns whole-page startup/browser health. This focused proof records console errors only
  // after the shipped page is established so unrelated asynchronous world bootstrap asset noise
  // cannot masquerade as a configured-fauna controller failure.
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const proof = await page.evaluate(async () => {
    const { ANIMAL_CONFIG } = await import('/src/3d/gameplay/animalConfig.js');
    const { createWolf } = await import('/src/3d/gameplay/animals.js');
    const { AssetLoader } = await import('/src/3d/assetLoader.js');
    const { EventBus } = await import('/src/3d/eventBus.js');
    const { EVENTS } = await import('/src/3d/config.js');

    const events = new EventBus();
    const assetErrors = [];
    events.on(EVENTS.ASSET_ERROR, (payload) => assetErrors.push(payload?.url ?? 'unknown'));
    const assetLoader = new AssetLoader({ events });
    const groundCollider = { getGroundHeight: () => 0 };
    const reports = [];

    for (const [speciesId, species] of Object.entries(ANIMAL_CONFIG.SPECIES)) {
      const canPatrol = Boolean(species.clips?.walk);
      const canFlee = Boolean(species.clips?.flee);
      const controller = await createWolf({
        assetLoader,
        modelUrl: species.modelUrl,
        idleClipName: species.clips?.idle,
        stripChildNames: species.stripChildNames ?? [],
        worldX: 0,
        worldZ: 0,
        groundY: 0,
        rotationYRadians: 0,
        name: `runtime-proof-${speciesId}`,
        groundCollider,
        walkClipName: canPatrol ? species.clips.walk : undefined,
        patrolWaypoints: canPatrol ? [{ x: 4, z: 0 }, { x: 0, z: 0 }] : undefined,
        speedMps: ANIMAL_CONFIG.PATROL_SPEED_MPS,
        pauseSeconds: 0,
        turnRateRadiansPerSecond: ANIMAL_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
        fleeClipName: canFlee ? species.clips.flee : undefined,
        fleeTriggerRadiusMeters: canFlee ? 3 : undefined,
        fleeSpeedMps: ANIMAL_CONFIG.FLEE_SPEED_MPS,
      });

      const startX = controller.object3D.position.x;
      const startZ = controller.object3D.position.z;
      controller.update(3, { x: 100, z: 100 }, []);
      const patrolMove = Math.hypot(
        controller.object3D.position.x - startX,
        controller.object3D.position.z - startZ,
      );

      let fleeMove = 0;
      let fleeDistanceGain = 0;
      let fleePhase = null;
      if (canFlee) {
        controller.object3D.position.set(0, 0, 0);
        const player = { x: 1, z: 0 };
        const before = Math.hypot(
          controller.object3D.position.x - player.x,
          controller.object3D.position.z - player.z,
        );
        controller.update(3, player, []);
        const after = Math.hypot(
          controller.object3D.position.x - player.x,
          controller.object3D.position.z - player.z,
        );
        fleeMove = Math.hypot(controller.object3D.position.x, controller.object3D.position.z);
        fleeDistanceGain = after - before;
        fleePhase = controller.object3D.userData?.wildlifeFlee?.phase ?? null;
      }

      reports.push({
        speciesId,
        placeholder: controller.object3D.userData?.isPlaceholder === true,
        canPatrol,
        canFlee,
        patrolMove,
        fleeMove,
        fleeDistanceGain,
        fleePhase,
        finiteTransform: [
          controller.object3D.position.x,
          controller.object3D.position.y,
          controller.object3D.position.z,
        ].every(Number.isFinite),
      });
      controller.dispose();
    }

    events.clear();
    return { assetErrors, reports };
  });

  const evidence = { pageErrors, consoleErrors, ...proof };
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/configured-fauna-runtime.json', `${JSON.stringify(evidence, null, 2)}\n`);

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(consoleErrors.length, 0, `fauna proof console errors: ${consoleErrors.join(' | ')}`);
  assert.equal(proof.assetErrors.length, 0, `fauna runtime asset errors: ${proof.assetErrors.join(', ')}`);
  assert.ok(proof.reports.length >= 10, `expected multi-species runtime roster, got ${proof.reports.length}`);

  for (const report of proof.reports) {
    assert.equal(report.placeholder, false, `${report.speciesId}: runtime controller used a placeholder asset`);
    assert.equal(report.finiteTransform, true, `${report.speciesId}: controller produced a non-finite transform`);
    if (report.canPatrol) {
      assert.ok(report.patrolMove > 0.15, `${report.speciesId}: patrol did not advance`);
      assert.ok(report.patrolMove <= 0.23, `${report.speciesId}: 3s resume frame exceeded bounded 100ms patrol budget (${report.patrolMove})`);
    } else {
      assert.equal(report.patrolMove, 0, `${report.speciesId}: clip-limited species moved without a walk clip`);
    }
    if (report.canFlee) {
      assert.ok(report.fleeMove > 0.35, `${report.speciesId}: threat did not trigger flee movement`);
      assert.ok(report.fleeMove <= 0.46, `${report.speciesId}: 3s resume frame exceeded bounded 100ms flee budget (${report.fleeMove})`);
      assert.ok(report.fleeDistanceGain > 0.35, `${report.speciesId}: flee did not increase player separation`);
      assert.equal(report.fleePhase, 'flee', `${report.speciesId}: telemetry did not enter direct flee phase`);
    }
  }

  console.log('CONFIGURED_FAUNA_RUNTIME_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
