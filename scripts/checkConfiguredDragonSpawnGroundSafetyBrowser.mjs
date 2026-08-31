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
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto(`${baseUrl}/game3d.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const proof = await page.evaluate(async () => {
    const THREE = await import('three');
    const {
      resolveConfiguredDragonSpawnCenter,
      spawnConfiguredDragons,
    } = await import('/src/3d/gameplay/dragonSpawns.js');

    let modelLoadCount = 0;
    class FakeAssetLoader {
      async loadFBXModel() {
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
      if (x === 20) throw new Error('synthetic dragon terrain failure');
      return 5;
    };
    const dragonConfig = {
      MODEL_URL: '/fake-dragon.fbx',
      TEXTURES_RESOURCE_PATH: '/fake-textures/',
      SCALE: 1,
      FLY_CLIP_NAME: 'Fly',
      SPAWNS: [
        { id: 'dragon-valid', seatId: 'valid', altitudeMeters: 12, circleRadiusMeters: 4, speedMps: 2, bankAngleRadians: 0 },
        { id: 'dragon-nan-ground', seatId: 'nan-ground', altitudeMeters: 12, circleRadiusMeters: 4, speedMps: 2, bankAngleRadians: 0 },
        { id: 'dragon-throw-ground', seatId: 'throw-ground', altitudeMeters: 12, circleRadiusMeters: 4, speedMps: 2, bankAngleRadians: 0 },
        { id: 'dragon-invalid-seat', seatId: 'invalid-seat', altitudeMeters: 12, circleRadiusMeters: 4, speedMps: 2, bankAngleRadians: 0 },
        { id: 'dragon-invalid-altitude', seatId: 'invalid-altitude', altitudeMeters: Infinity, circleRadiusMeters: 4, speedMps: 2, bankAngleRadians: 0 },
      ],
    };
    const seatsById = new Map([
      ['valid', { x: 0, z: 0 }],
      ['nan-ground', { x: 10, z: 0 }],
      ['throw-ground', { x: 20, z: 0 }],
      ['invalid-seat', { x: Infinity, z: 0 }],
      ['invalid-altitude', { x: 30, z: 0 }],
    ]);

    const controllers = await spawnConfiguredDragons({
      assetLoader: new FakeAssetLoader(),
      dragonConfig,
      seatsById,
      sampleGroundY,
    });
    const valid = controllers[0];
    const validPosition = valid?.object3D.position.clone();
    const validName = valid?.object3D.name;
    for (const controller of controllers) controller.dispose();

    const overflow = resolveConfiguredDragonSpawnCenter({
      spawn: { altitudeMeters: Number.MAX_VALUE },
      seat: { x: 1, z: 2 },
      sampleGroundY: () => Number.MAX_VALUE,
    });

    return {
      controllerCount: controllers.length,
      validName,
      validPosition: validPosition ? { x: validPosition.x, y: validPosition.y, z: validPosition.z } : null,
      modelLoadCount,
      sampledXs,
      overflowReason: overflow.reason,
    };
  });

  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`);
  assert.equal(proof.controllerCount, 1, `expected one safe configured dragon: ${JSON.stringify(proof)}`);
  assert.equal(proof.validName, 'dragon-valid');
  assert.deepEqual(proof.validPosition, { x: 0, y: 17, z: 4 });
  assert.equal(proof.modelLoadCount, 1, 'unsafe spawns must be rejected before model loading');
  assert.deepEqual(proof.sampledXs, [0, 10, 20], 'invalid seat/altitude must be rejected before terrain sampling');
  assert.equal(proof.overflowReason, 'non-finite-center', 'finite operands that overflow must fail closed');

  console.log('CONFIGURED_DRAGON_SPAWN_GROUND_SAFETY_BROWSER_PASS', JSON.stringify(proof));
} finally {
  await browser.close();
}
