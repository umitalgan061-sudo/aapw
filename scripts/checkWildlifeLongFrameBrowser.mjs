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
    const { createWolf } = await import('/src/3d/gameplay/animals.js');
    const { ANIMAL_CONFIG } = await import('/src/3d/gameplay/animalConfig.js');
    const { AssetLoader } = await import('/src/3d/assetLoader.js');

    const species = ANIMAL_CONFIG.SPECIES.wolf;
    const assetLoader = new AssetLoader();
    const groundCollider = { getGroundHeight: () => 0 };
    const playerCollider = { resolveXZ: (x, z) => ({ x, z }) };

    const fleeingWolf = await createWolf({
      assetLoader,
      modelUrl: species.modelUrl,
      idleClipName: species.clips.idle,
      stripChildNames: species.stripChildNames,
      worldX: 0,
      worldZ: 0,
      groundY: 0,
      groundCollider,
      playerCollider,
      walkClipName: species.clips.walk,
      patrolWaypoints: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
      speedMps: ANIMAL_CONFIG.PATROL_SPEED_MPS,
      pauseSeconds: 0,
      turnRateRadiansPerSecond: ANIMAL_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
      fleeClipName: species.clips.flee,
      fleeTriggerRadiusMeters: ANIMAL_CONFIG.FLEE_TRIGGER_RADIUS_METERS,
      fleeSpeedMps: ANIMAL_CONFIG.FLEE_SPEED_MPS,
      packAlertRadiusMeters: ANIMAL_CONFIG.PACK_ALERT_RADIUS_METERS,
    });

    const nearPlayer = { x: 0, z: -1 };
    const beforeFlee = { x: fleeingWolf.object3D.position.x, z: fleeingWolf.object3D.position.z };
    fleeingWolf.update(3, nearPlayer, []);
    const afterFlee = { x: fleeingWolf.object3D.position.x, z: fleeingWolf.object3D.position.z };
    const fleeDistance = Math.hypot(afterFlee.x - beforeFlee.x, afterFlee.z - beforeFlee.z);
    const fleeState = fleeingWolf.isFleeing;

    fleeingWolf.update(Number.NaN, nearPlayer, []);
    const afterNaN = { x: fleeingWolf.object3D.position.x, z: fleeingWolf.object3D.position.z };
    const nanDistance = Math.hypot(afterNaN.x - afterFlee.x, afterNaN.z - afterFlee.z);
    fleeingWolf.dispose();

    const patrolWolf = await createWolf({
      assetLoader,
      modelUrl: species.modelUrl,
      idleClipName: species.clips.idle,
      stripChildNames: species.stripChildNames,
      worldX: 0,
      worldZ: 0,
      groundY: 0,
      groundCollider,
      playerCollider,
      walkClipName: species.clips.walk,
      patrolWaypoints: [{ x: 0, z: 0 }, { x: 10, z: 0 }],
      speedMps: ANIMAL_CONFIG.PATROL_SPEED_MPS,
      pauseSeconds: 0,
      turnRateRadiansPerSecond: ANIMAL_CONFIG.PATROL_TURN_RATE_RADIANS_PER_SECOND,
    });
    patrolWolf.update(1 / 60, { x: 100, z: 100 }, []);
    const beforePatrol = { x: patrolWolf.object3D.position.x, z: patrolWolf.object3D.position.z };
    patrolWolf.update(3, { x: 100, z: 100 }, []);
    const afterPatrol = { x: patrolWolf.object3D.position.x, z: patrolWolf.object3D.position.z };
    const patrolDistance = Math.hypot(afterPatrol.x - beforePatrol.x, afterPatrol.z - beforePatrol.z);
    patrolWolf.dispose();

    return {
      modelUrl: species.modelUrl,
      fleeDistance,
      fleeState,
      nanDistance,
      patrolDistance,
    };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.match(proof.modelUrl, /assets\/models\/animals\/wolf\/.+\.glb$/i, 'real configured wolf GLB must be used');
  assert.equal(proof.fleeState, true, 'real wolf must classify the nearby player as a flee threat');
  assert.ok(proof.fleeDistance > 0 && proof.fleeDistance <= 0.45 + 1e-6,
    `3 s resume flee displacement escaped the 100 ms budget: ${proof.fleeDistance}`);
  assert.equal(proof.nanDistance, 0, 'NaN delta must not move the shipped wolf runtime');
  assert.ok(proof.patrolDistance > 0 && proof.patrolDistance <= 0.22 + 1e-6,
    `3 s resume patrol displacement escaped the 100 ms budget: ${proof.patrolDistance}`);

  console.log('WILDLIFE_LONG_FRAME_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
