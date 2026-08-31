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
    const dog = createCreatureBeing({
      speciesId: 'kopek',
      spawnId: 'friendly-stop-boundary',
      worldX: 0,
      worldZ: 0,
      groundY: 5,
      rotationYRadians: Math.PI / 2,
      groundCollider: { getGroundHeight: () => 5 },
      playerCollider: null,
      mulberry32,
    });
    const player = { x: 3, z: 0 };
    const before = Math.hypot(dog.object3D.position.x - player.x, dog.object3D.position.z - player.z);
    dog.update(0.25, player);
    const after = Math.hypot(dog.object3D.position.x - player.x, dog.object3D.position.z - player.z);
    const position = { x: dog.object3D.position.x, y: dog.object3D.position.y, z: dog.object3D.position.z };
    dog.dispose();
    return { before, after, position };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join('\n')}`);
  assert.ok(proof.before > 2.5, `precondition failed: ${proof.before}`);
  assert.ok(proof.after >= 2.5 - 1e-6, `friendly approach crossed stop distance: ${proof.after}`);
  assert.ok(Math.abs(proof.after - 2.5) <= 1e-6, `friendly approach should clamp exactly to stop distance: ${proof.after}`);
  assert.ok(Object.values(proof.position).every(Number.isFinite), 'friendly approach published a non-finite transform');
  console.log('Creature friendly approach stop browser proof PASS', proof);
} finally {
  await browser.close();
}
