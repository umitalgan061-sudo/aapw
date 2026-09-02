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
    const { spawnConfiguredAnimals } = await import('/src/3d/gameplay/animals.js');
    const { KINGDOM_SEATS, mapToWorldXZ } = await import('/src/3d/world/settlements.js');
    const { WORLD_SCALE } = await import('/src/3d/config.js');

    let modelLoadCount = 0;
    class FakeAssetLoader {
      async loadModel(modelUrl) {
        modelLoadCount += 1;
        const group = new THREE.Group();
        const material = new THREE.MeshStandardMaterial({ color: 0x9a8a78, roughness: 0.72 });
        if (modelUrl.includes('fake-wolf')) {
          const tex = new THREE.DataTexture(new Uint8Array([120, 105, 90, 255]), 1, 1, THREE.RGBAFormat);
          tex.needsUpdate = true;
          material.map = tex;
        }
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
        mesh.name = modelUrl.includes('fake-horse') ? 'horse_body' : 'wolf_body';
        group.add(mesh);
        group.animations = [new THREE.AnimationClip('Walk', 1, [])];
        return group;
      }
    }

    const seatWorld = (id) => {
      const seat = KINGDOM_SEATS.find((entry) => entry.id === id);
      const world = mapToWorldXZ(seat.mapX, seat.mapY, WORLD_SCALE.MAP_BOUNDS, WORLD_SCALE.METERS_PER_MAP_UNIT);
      return { x: world.x, z: world.z };
    };
    const north = seatWorld('berkalp');
    const reach = seatWorld('ziya');
    const rejectedPatrolTargetX = north.x + 10;

    const sampledXs = [];
    const sampleGroundY = (x) => {
      sampledXs.push(x);
      if (x === 10) return Number.NaN;
      if (x === 20) throw new Error('synthetic fauna terrain failure');
      return 3;
    };
    const groundCollider = {
      getGroundHeight(x) {
        return Math.abs(x - rejectedPatrolTargetX) < 1e-6 ? Number.NaN : 3;
      },
    };
    const animalConfig = {
      WOLF_MODEL_URL: '/fake-wolf.glb',
      IDLE_CLIP_NAME: 'Idle',
      WALK_CLIP_NAME: 'Walk',
      FLEE_CLIP_NAME: undefined,
      STRIP_CHILD_NAMES: [],
      SPECIES: {
        horse: { modelUrl: '/fake-horse.glb', clips: { idle: 'Idle' }, stripChildNames: [] },
      },
      PATROL_SPEED_MPS: 2,
      PATROL_PAUSE_SECONDS: 0,
      PATROL_TURN_RATE_RADIANS_PER_SECOND: 4,
      FLEE_TRIGGER_RADIUS_METERS: 12,
      FLEE_SPEED_MPS: 4,
      PACK_ALERT_RADIUS_METERS: 20,
      SPAWNS: [
        { id: 'animal-valid-wolf', seatId: 'valid-wolf', offsetXMeters: 0, offsetZMeters: 0 },
        { id: 'animal-valid-horse', seatId: 'valid-horse', offsetXMeters: 0, offsetZMeters: 0, speciesId: 'horse' },
        { id: 'animal-patrol-rejected', seatId: 'patrol-route', offsetXMeters: 0, offsetZMeters: 0, patrol: { toOffsetXMeters: 10, toOffsetZMeters: 0 } },
        { id: 'animal-nan-ground', seatId: 'nan-ground', offsetXMeters: 0, offsetZMeters: 0 },
        { id: 'animal-throw-ground', seatId: 'throw-ground', offsetXMeters: 0, offsetZMeters: 0 },
        { id: 'animal-invalid-world', seatId: 'invalid-world', offsetXMeters: 0, offsetZMeters: 0 },
        { id: 'animal-overflow-world', seatId: 'overflow-world', offsetXMeters: Number.MAX_VALUE, offsetZMeters: 0 },
        { id: 'animal-invalid-species', seatId: 'invalid-species', offsetXMeters: 0, offsetZMeters: 0, speciesId: 'missing' },
      ],
    };
    const seatsById = new Map([
      ['valid-wolf', north],
      ['valid-horse', reach],
      ['patrol-route', north],
      ['nan-ground', { x: 10, z: 0 }],
      ['throw-ground', { x: 20, z: 0 }],
      ['invalid-world', { x: Infinity, z: 0 }],
      ['overflow-world', { x: Number.MAX_VALUE, z: 0 }],
      ['invalid-species', { x: 40, z: 0 }],
    ]);

    const commonArgs = {
      animalConfig,
      seatsById,
      groundCollider,
      playerCollider: { resolveXZ: (x, z) => ({ x, z }) },
    };
    const controllers = await spawnConfiguredAnimals({
      ...commonArgs,
      assetLoader: new FakeAssetLoader(),
      sampleGroundY,
    });
    const rejectedRouteController = controllers.find((controller) => controller.object3D.name === 'animal-patrol-rejected');
    const rejectedRouteBefore = rejectedRouteController
      ? { x: rejectedRouteController.object3D.position.x, y: rejectedRouteController.object3D.position.y, z: rejectedRouteController.object3D.position.z }
      : null;
    rejectedRouteController?.update(1, { x: north.x + 100, z: north.z + 100 }, []);
    const rejectedRouteAfter = rejectedRouteController
      ? { x: rejectedRouteController.object3D.position.x, y: rejectedRouteController.object3D.position.y, z: rejectedRouteController.object3D.position.z }
      : null;
    const summaries = controllers.map((controller) => ({
      name: controller.object3D.name,
      position: { x: controller.object3D.position.x, y: controller.object3D.position.y, z: controller.object3D.position.z },
      materialReadyForWorld: controller.object3D.userData.materialReadyForWorld,
      placement: controller.object3D.userData.faunaWorldPlacement,
      patrolPlacement: controller.object3D.userData.faunaPatrolPlacement,
      manifest: controller.object3D.userData.worldPlacementManifest,
    }));
    for (const controller of controllers) controller.dispose();

    let assetFailurePropagated = false;
    try {
      await spawnConfiguredAnimals({
        ...commonArgs,
        assetLoader: { async loadModel() { throw new Error('synthetic fauna asset failure'); } },
        animalConfig: { ...animalConfig, SPAWNS: [animalConfig.SPAWNS[0]] },
        sampleGroundY: () => 3,
      });
    } catch (error) {
      assetFailurePropagated = error?.message === 'synthetic fauna asset failure';
    }

    return {
      controllerCount: controllers.length,
      summaries,
      modelLoadCount,
      sampledXs,
      assetFailurePropagated,
      rejectedRouteBefore,
      rejectedRouteAfter,
    };
  });

  const faunaConsoleErrors = focusedConsoleErrors.filter((message) => (
    message.includes('gameplay/animals') || message.includes('fake-wolf') || message.includes('fake-horse') || message.includes('CONFIGURED_ANIMAL')
  ));
  assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  assert.equal(faunaConsoleErrors.length, 0, `fauna spawn console errors: ${faunaConsoleErrors.join(' | ')}`);
  assert.equal(proof.controllerCount, 3, `expected three safe configured animals: ${JSON.stringify(proof)}`);
  assert.equal(proof.modelLoadCount, 3, 'unsafe initial spawns must be rejected before model loading');
  assert.equal(proof.assetFailurePropagated, true, 'valid placement must not swallow an actual asset loading failure');

  const wolf = proof.summaries.find((entry) => entry.name === 'animal-valid-wolf');
  const horse = proof.summaries.find((entry) => entry.name === 'animal-valid-horse');
  const rejectedRoute = proof.summaries.find((entry) => entry.name === 'animal-patrol-rejected');
  assert.equal(wolf?.materialReadyForWorld, true);
  assert.equal(horse?.materialReadyForWorld, true);
  assert.equal(wolf?.placement?.materialMode, 'preserve-authored');
  assert.deepEqual(wolf?.placement?.authoredPbrMapSlots, ['map']);
  assert.equal(horse?.placement?.materialMode, 'generated-fallback');
  assert.ok(horse?.placement?.generatedMaterialCount > 0, 'geometry-only horse fixture must receive generated animal materials');
  assert.ok(wolf?.placement?.meshCount > 0 && wolf?.placement?.materialSlotCount > 0);
  assert.ok(horse?.placement?.meshCount > 0 && horse?.placement?.materialSlotCount > 0);
  assert.equal(wolf?.manifest?.validation?.ok, true);
  assert.equal(horse?.manifest?.validation?.ok, true);
  assert.ok(['cold-grassland', 'snow', 'mountain', 'rocky-hills', 'soil', 'rock'].includes(wolf?.placement?.biome));
  assert.ok(['cold-grassland', 'lush-grassland', 'steppe', 'rocky-hills', 'temperate-coast', 'soil', 'rock'].includes(horse?.placement?.biome));
  assert.equal(wolf?.position?.y, 3);
  assert.equal(horse?.position?.y, 3);
  assert.ok(proof.sampledXs.includes(10) && proof.sampledXs.includes(20));
  assert.equal(rejectedRoute?.materialReadyForWorld, true, 'safe spawn must survive an unsafe patrol target');
  assert.equal(rejectedRoute?.patrolPlacement?.enabled, false, 'unsafe patrol target must disable patrol');
  assert.equal(rejectedRoute?.patrolPlacement?.error, 'ground-sample-failed');
  assert.deepEqual(proof.rejectedRouteAfter, proof.rejectedRouteBefore, 'rejected geographic patrol must not move the animal');

  console.log('CONFIGURED_ANIMAL_SPAWN_GROUND_SAFETY_BROWSER_PASS', JSON.stringify({
    ...proof,
    backgroundConsoleErrorCount: focusedConsoleErrors.length - faunaConsoleErrors.length,
  }));
} finally {
  await browser.close();
}
