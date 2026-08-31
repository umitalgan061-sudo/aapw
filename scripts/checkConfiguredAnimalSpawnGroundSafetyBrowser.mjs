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
  const focusedConsoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  page.on('console', (message) => {
    if (message.type() === 'error') focusedConsoleErrors.push(message.text());
  });

  const proof = await page.evaluate(async () => {
    const THREE = await import('three');
    const {
      resolveConfiguredAnimalSpawnGround,
      spawnConfiguredAnimals,
    } = await import('/src/3d/gameplay/animals.js');

    let modelLoadCount = 0;
    class FakeAssetLoader {
      async loadModel() {
        modelLoadCount += 1;
        const group = new THREE.Group();
        group.animations = [];
        return group;
      }
    }

    const sampledXs = [];
    const sampleGroundY = (x) => {
      sampledXs.push(x);
      if (x === 10) return Number.NaN;
      if (x === 20) throw new Error('synthetic fauna terrain failure');
      return 3;
    };
    const animalConfig = {
      WOLF_MODEL_URL: '/fake-wolf.glb',
      IDLE_CLIP_NAME: 'Idle',
      WALK_CLIP_NAME: undefined,
      FLEE_CLIP_NAME: undefined,
      STRIP_CHILD_NAMES: [],
      SPECIES: {},
      PATROL_SPEED_MPS: 2,
      PATROL_PAUSE_SECONDS: 0,
      PATROL_TURN_RATE_RADIANS_PER_SECOND: 4,
      FLEE_TRIGGER_RADIUS_METERS: 12,
      FLEE_SPEED_MPS: 4,
      PACK_ALERT_RADIUS_METERS: 20,
      SPAWNS: [
        { id: 'animal-valid', seatId: 'valid', offsetXMeters: 0, offsetZMeters: 0 },
        { id: 'animal-nan-ground', seatId: 'nan-ground', offsetXMeters: 0, offsetZMeters: 0 },
        { id: 'animal-throw-ground', seatId: 'throw-ground', offsetXMeters: 0, offsetZMeters: 0 },
        { id: 'animal-invalid-world', seatId: 'invalid-world', offsetXMeters: 0, offsetZMeters: 0 },
        { id: 'animal-invalid-species', seatId: 'invalid-species', offsetXMeters: 0, offsetZMeters: 0, speciesId: 'missing' },
      ],
    };
    const seatsById = new Map([
      ['valid', { x: 0, z: 0 }],
      ['nan-ground', { x: 10, z: 0 }],
      ['throw-ground', { x: 20, z: 0 }],
      ['invalid-world', { x: Infinity, z: 0 }],
      ['invalid-species', { x: 40, z: 0 }],
    ]);

    const controllers = await spawnConfiguredAnimals({
      assetLoader: new FakeAssetLoader(),
      animalConfig,
      seatsById,
      sampleGroundY,
      groundCollider: { getGroundHeight: () => 3 },
      playerCollider: { resolveXZ: (x, z) => ({ x, z }) },
    });
    const valid = controllers[0];
    const validPosition = valid?.object3D.position.clone();
    const validName = valid?.object3D.name;
    for (const controller of controllers) controller.dispose();

    let overflowSampled = false;
    const overflow = resolveConfiguredAnimalSpawnGround({
      spawn: { offsetXMeters: Number.MAX_VALUE, offsetZMeters: 0 },
      seat: { x: Number.MAX_VALUE, z: 0 },
      sampleGroundY: () => {
        overflowSampled = true;
        return 0;
      },
    });

    return {
      controllerCount: controllers.length,
      validName,
      validPosition: validPosition ? { x: validPosition.x, y: validPosition.y, z: validPosition.z } : null,
      modelLoadCount,
      sampledXs,
      overflowReason: overflow.reason,
      overflowSampled,
    };
  });

  const faunaConsoleErrors = focusedConsoleErrors.filter((message) => (
    message.includes('gameplay/animals')
    || message.includes('fake-wolf')
    || message.includes('CONFIGURED_ANIMAL')
  ));
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(faunaConsoleErrors.length, 0, `fauna spawn console errors: ${faunaConsoleErrors.join(' | ')}`);
  assert.equal(proof.controllerCount, 1, `expected one safe configured animal: ${JSON.stringify(proof)}`);
  assert.equal(proof.validName, 'animal-valid');
  assert.deepEqual(proof.validPosition, { x: 0, y: 3, z: 0 });
  assert.equal(proof.modelLoadCount, 1, 'unsafe spawns must be rejected before model loading');
  assert.deepEqual(proof.sampledXs, [0, 10, 20], 'invalid world/species entries must be rejected before terrain sampling');
  assert.equal(proof.overflowReason, 'non-finite-position', 'coordinate overflow must fail closed');
  assert.equal(proof.overflowSampled, false, 'non-finite coordinates must be rejected before terrain sampling');

  console.log('CONFIGURED_ANIMAL_SPAWN_GROUND_SAFETY_BROWSER_PASS', JSON.stringify({
    ...proof,
    backgroundConsoleErrorCount: focusedConsoleErrors.length - faunaConsoleErrors.length,
  }));
} finally {
  await browser.close();
}
