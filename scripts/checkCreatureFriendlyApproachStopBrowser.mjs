#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  const proof = await page.evaluate(async () => {
    const { createCreatureBeing } = await import('/src/3d/gameplay/creatureBrain.js');
    const { mulberry32 } = await import('/src/3d/world/terrain.js');
    const createDog = (spawnId, playerCollider = null) => createCreatureBeing({
      speciesId: 'kopek',
      spawnId,
      worldX: 0,
      worldZ: 0,
      groundY: 5,
      rotationYRadians: Math.PI / 2,
      groundCollider: { getGroundHeight: () => 5 },
      playerCollider,
      mulberry32,
    });
    const player = { x: 3, z: 0 };

    const dog = createDog('friendly-stop-boundary');
    const before = Math.hypot(dog.object3D.position.x - player.x, dog.object3D.position.z - player.z);
    dog.update(0.25, player);
    const after = Math.hypot(dog.object3D.position.x - player.x, dog.object3D.position.z - player.z);
    const position = { x: dog.object3D.position.x, y: dog.object3D.position.y, z: dog.object3D.position.z };
    dog.dispose();

    const exactStopDog = createDog('friendly-stop-stable');
    exactStopDog.object3D.position.x = 0.5;
    exactStopDog.update(0.25, player);
    const exactStopDistance = Math.hypot(
      exactStopDog.object3D.position.x - player.x,
      exactStopDog.object3D.position.z - player.z,
    );
    exactStopDog.dispose();

    // A world collider is allowed to correct a candidate X/Z. The friendly stop contract must still
    // hold after that correction; otherwise obstacle resolution can push a dog through personal space.
    let colliderCalls = 0;
    const colliderDog = createDog('friendly-stop-after-collider', {
      resolveXZ: (x, z) => ({ x: ++colliderCalls === 1 ? x + 0.5 : x, z }),
    });
    colliderDog.update(0.25, player);
    const afterCollider = Math.hypot(
      colliderDog.object3D.position.x - player.x,
      colliderDog.object3D.position.z - player.z,
    );
    const rejectedPositionX = colliderDog.object3D.position.x;
    colliderDog.update(0.25, player);
    const recoveredDistance = Math.hypot(
      colliderDog.object3D.position.x - player.x,
      colliderDog.object3D.position.z - player.z,
    );
    const colliderPosition = {
      x: colliderDog.object3D.position.x,
      y: colliderDog.object3D.position.y,
      z: colliderDog.object3D.position.z,
    };
    colliderDog.dispose();
    return { before, after, position, exactStopDistance, afterCollider, rejectedPositionX, recoveredDistance, colliderCalls, colliderPosition };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('\n')}`);
  assert.ok(proof.before > 2.5, `precondition failed: ${proof.before}`);
  assert.ok(proof.after >= 2.5 - 1e-6, `friendly approach crossed stop distance: ${proof.after}`);
  assert.ok(Math.abs(proof.after - 2.5) <= 1e-6, `friendly approach should clamp exactly to stop distance: ${proof.after}`);
  assert.ok(Object.values(proof.position).every(Number.isFinite), 'friendly approach published a non-finite transform');
  assert.ok(Math.abs(proof.exactStopDistance - 2.5) <= 1e-6, `friendly creature drifted while already at stop distance: ${proof.exactStopDistance}`);
  assert.ok(proof.afterCollider >= 2.5 - 1e-6, `collider correction crossed friendly stop distance: ${proof.afterCollider}`);
  assert.equal(proof.rejectedPositionX, 0, 'rejected collider correction should not partially publish movement');
  assert.ok(Math.abs(proof.recoveredDistance - 2.5) <= 1e-6, `friendly approach did not recover after collider rejection: ${proof.recoveredDistance}`);
  assert.equal(proof.colliderCalls, 2, 'friendly approach should retry collider resolution on the next valid tick');
  assert.ok(Object.values(proof.colliderPosition).every(Number.isFinite), 'collider-corrected approach published a non-finite transform');
  console.log('Creature friendly approach stop browser proof PASS', proof);
} finally {
  await browser.close();
}
