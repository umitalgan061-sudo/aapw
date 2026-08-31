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
    const groundCollider = { getGroundHeight: () => 5 };
    const make = (speciesId, spawnId, rotationYRadians) => createCreatureBeing({
      speciesId,
      spawnId,
      worldX: 0,
      worldZ: 0,
      groundY: 5,
      rotationYRadians,
      groundCollider,
      playerCollider: null,
      mulberry32,
    });
    const snapshot = (controller) => ({
      x: controller.object3D.position.x,
      y: controller.object3D.position.y,
      z: controller.object3D.position.z,
      yaw: controller.object3D.rotation.y,
      fleeing: controller.isFleeing,
    });
    const horizontalDistance = (before, after) => Math.hypot(after.x - before.x, after.z - before.z);

    // Exact X/Z overlap is a legitimate collision/contact edge case. A flee controller cannot derive
    // a normalized away-vector from a zero-length separation, so it must fall back deterministically
    // to the creature's authored/current facing just like the shipped asset-backed wolf controller.
    const ground = make('kedi', 'exact-overlap-ground', Math.PI / 2);
    const groundBefore = snapshot(ground);
    ground.update(0.1, { x: 0, z: 0 });
    const groundAfter = snapshot(ground);

    const bird = make('tavuk', 'exact-overlap-bird', Math.PI / 2);
    const birdBefore = snapshot(bird);
    bird.update(0.1, { x: 0, z: 0 });
    const birdAfterTakeoff = snapshot(bird);
    for (let i = 0; i < 4; i += 1) bird.update(0.1, { x: 0, z: 0 });
    const birdAfterCruise = snapshot(bird);

    const result = {
      groundBefore,
      groundAfter,
      groundHorizontalDistance: horizontalDistance(groundBefore, groundAfter),
      birdBefore,
      birdAfterTakeoff,
      birdAfterCruise,
      birdTakeoffHorizontalDistance: horizontalDistance(birdBefore, birdAfterTakeoff),
      birdCruiseHorizontalDistance: horizontalDistance(birdBefore, birdAfterCruise),
    };
    ground.dispose();
    bird.dispose();
    return result;
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(proof.groundAfter.fleeing, true, 'ground creature must enter its direct reaction on exact overlap');
  assert.ok(proof.groundHorizontalDistance > 0.01,
    `ground creature must physically separate from an exact-overlap threat instead of reacting in place: ${JSON.stringify(proof)}`);

  assert.equal(proof.birdAfterTakeoff.fleeing, true, 'bird must enter flight reaction on exact overlap');
  assert.ok(proof.birdAfterTakeoff.y > proof.birdBefore.y, 'bird must still climb during exact-overlap takeoff');
  assert.ok(proof.birdTakeoffHorizontalDistance > 0.01,
    `bird takeoff must choose a deterministic non-zero escape heading on exact overlap: ${JSON.stringify(proof)}`);
  assert.ok(proof.birdCruiseHorizontalDistance > proof.birdTakeoffHorizontalDistance,
    `bird must continue translating horizontally after overlap takeoff: ${JSON.stringify(proof)}`);

  console.log('CREATURE_EXACT_OVERLAP_REACTION_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
